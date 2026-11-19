/**
 * payment.concurrency.test.js — Concurrency & Race-Condition Tests for Payments
 *
 * Verifies real PostgreSQL transactional concurrency and lock ordering:
 *
 * Test 1 — Two simultaneous payment requests for the same booking:
 *   - Two concurrent HTTP requests via Promise.all on independent connections
 *   - Hierarchical row locks serialize the requests cleanly without deadlock (40P01)
 *   - Both requests return HTTP 200 (one confirms, one receives idempotent receipt)
 *   - Exactly one SUCCESS payment row created in database
 *   - Exactly one PNR generated and shared by both responses
 *   - All seat allocations transitioned to ACTIVE with zero duplicates
 *
 * Test 2 — Payment versus hold-expiration cleanup:
 *   - Outcome A: Payment wins — booking confirmed, allocations ACTIVE, exactly one
 *     SUCCESS payment, unique PNR; subsequent expiry cleanup does NOT cancel confirmed booking
 *   - Outcome B: Expiration wins — booking CANCELLED, allocations RELEASED, passengers
 *     CANCELLED, zero SUCCESS payments, PNR remains NULL, payment returns HTTP 400/410
 *   - Critical Timing Scenario: Payment transaction begins before expiry, blocks on
 *     row lock until after the 10-minute deadline, acquires lock, live clock_timestamp()
 *     detects expiry, releases holds, marks booking CANCELLED, and returns HTTP 410
 */

'use strict';

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const request = require('supertest');
const app = require('../src/app');
const pool = require('../src/config/db');
const paymentService = require('../src/modules/payments/payment.service');
const bookingRepository = require('../src/modules/bookings/booking.repository');
const { generateToken } = require('../src/utils/token');

describe('Payment Concurrency & Race Condition Tests (Real PostgreSQL)', () => {
  const TEST_PREFIX = 'test.pconcur.';
  const generateEmail = (suffix) => `${TEST_PREFIX}${Date.now()}.${suffix}@example.com`;

  let userA;
  let cookieA;
  let trainExpId;
  let stnNdlsId, stnCnbId;
  let testSeats = [];
  const testJourneyDate = '2026-12-29';

  const createdBookingIds = [];

  const cleanupTestData = async () => {
    if (createdBookingIds.length > 0) {
      await pool.query('DELETE FROM payments WHERE booking_id = ANY($1)', [createdBookingIds]);
      await pool.query(
        'DELETE FROM seat_allocations WHERE booking_passenger_id IN (SELECT id FROM booking_passengers WHERE booking_id = ANY($1))',
        [createdBookingIds]
      );
      await pool.query('DELETE FROM booking_passengers WHERE booking_id = ANY($1)', [createdBookingIds]);
      await pool.query('DELETE FROM bookings WHERE id = ANY($1)', [createdBookingIds]);
      createdBookingIds.length = 0;
    }

    await pool.query('DELETE FROM seat_allocations WHERE journey_date = $1', [testJourneyDate]);
    await pool.query(
      'DELETE FROM passenger_profiles WHERE user_id IN (SELECT id FROM users WHERE email LIKE $1)',
      [`${TEST_PREFIX}%`]
    );
    await pool.query('DELETE FROM users WHERE email LIKE $1', [`${TEST_PREFIX}%`]);
  };

  beforeAll(async () => {
    await cleanupTestData();

    // 1. Create test user
    const userARes = await pool.query(
      "INSERT INTO users (name, email, password_hash, role) VALUES ('Concurrency User A', $1, 'hash_a', 'USER') RETURNING id, name, email",
      [generateEmail('usera')]
    );
    userA = userARes.rows[0];
    cookieA = `smartrail_token=${generateToken(userA.id)}`;

    // 2. Discover seed stations (NDLS -> CNB)
    const stnRes = await pool.query(
      "SELECT id, code FROM stations WHERE code IN ('NDLS', 'CNB') ORDER BY code ASC"
    );
    stnNdlsId = Number(stnRes.rows.find((s) => s.code === 'NDLS').id);
    stnCnbId = Number(stnRes.rows.find((s) => s.code === 'CNB').id);

    // 3. Discover seed train (DEMO-EXP-01)
    const trainRes = await pool.query(
      "SELECT id FROM trains WHERE train_number = 'DEMO-EXP-01'"
    );
    trainExpId = Number(trainRes.rows[0].id);

    // 4. Discover candidate seats for class '3A'
    const seatsRes = await pool.query(`
      SELECT s.id, s.seat_number, s.berth_type, s.rac_capable, c.coach_number, c.coach_type
      FROM seats s
      JOIN coaches c ON c.id = s.coach_id
      WHERE c.train_id = $1 AND c.class_code = '3A'
      ORDER BY s.id ASC
      LIMIT 6
    `, [trainExpId]);
    testSeats = seatsRes.rows;
  });

  afterAll(async () => {
    await cleanupTestData();
  });

  /**
   * Helper to create a provisional booking with valid passengers and HELD allocations.
   */
  async function createProvisionalBooking({
    userId = userA.id,
    passengers = [{ status: 'CONFIRMED' }],
    backdatedMinutes = 0,
    bookingStatus = 'PENDING_PAYMENT',
  } = {}) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const createdAt = backdatedMinutes > 0
        ? new Date(Date.now() - backdatedMinutes * 60 * 1000)
        : new Date();

      const totalAmount = passengers.length * 450;

      const bookingRes = await client.query(`
        INSERT INTO bookings (
          user_id, train_id, journey_date, source_station_id, destination_station_id,
          class_code, status, total_amount, pnr, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, '3A', $6, $7, NULL, $8, $8)
        RETURNING id, status, total_amount, created_at;
      `, [userId, trainExpId, testJourneyDate, stnNdlsId, stnCnbId, bookingStatus, totalAmount, createdAt]);

      const booking = bookingRes.rows[0];
      booking.id = Number(booking.id);
      createdBookingIds.push(booking.id);

      const createdPassengers = [];
      const createdAllocations = [];

      for (let i = 0; i < passengers.length; i++) {
        const pDef = passengers[i];
        const passRes = await client.query(`
          INSERT INTO booking_passengers (
            booking_id, name_snapshot, age_snapshot, gender_snapshot, passenger_status
          )
          VALUES ($1, $2, $3, 'M', $4)
          RETURNING id, passenger_status;
        `, [booking.id, `Passenger ${i + 1}`, 28 + i, pDef.status]);

        const passenger = passRes.rows[0];
        createdPassengers.push(passenger);

        const seat = testSeats[i % testSeats.length];
        const isRac = pDef.status === 'RAC';
        const allocType = isRac ? 'RAC' : 'CONFIRMED';
        const racSlot = isRac ? (pDef.racSlot || 1) : null;
        const allocStatus = pDef.allocStatus || 'HELD';

        const allocRes = await client.query(`
          INSERT INTO seat_allocations (
            booking_passenger_id, seat_id, journey_date, from_stop_order, to_stop_order,
            allocation_type, rac_slot, status, allocated_at
          )
          VALUES ($1, $2, $3, 1, 2, $4, $5, $6, $7)
          RETURNING id, status, allocation_type, rac_slot, seat_id;
        `, [passenger.id, seat.id, testJourneyDate, allocType, racSlot, allocStatus, createdAt]);

        createdAllocations.push(allocRes.rows[0]);
      }

      await client.query('COMMIT');
      return { booking, passengers: createdPassengers, allocations: createdAllocations };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  // ===========================================================================
  // Test 1 — Two simultaneous payments for the same booking
  // ===========================================================================
  describe('Test 1 — Simultaneous Payments for Same Booking', () => {
    test('1.1. two concurrent payment requests resolve cleanly to HTTP 200 with 1 SUCCESS record and identical PNR', async () => {
      const { booking, allocations } = await createProvisionalBooking({
        userId: userA.id,
        passengers: [{ status: 'CONFIRMED' }],
      });

      // Submit two HTTP requests simultaneously using independent connections through Express app
      const [res1, res2] = await Promise.all([
        request(app)
          .post('/api/payments/process')
          .set('Cookie', [cookieA])
          .send({ bookingId: booking.id }),
        request(app)
          .post('/api/payments/process')
          .set('Cookie', [cookieA])
          .send({ bookingId: booking.id }),
      ]);

      // Assert both return HTTP 200
      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);

      // Verify that one request completed initial payment and the other received the idempotent replay
      const idempotentResults = [res1.body.isIdempotent, res2.body.isIdempotent].sort();
      expect(idempotentResults).toEqual([false, true]);

      // Both responses must contain the identical PNR and booking ID
      expect(res1.body.booking.id).toBe(booking.id);
      expect(res2.body.booking.id).toBe(booking.id);
      expect(res1.body.booking.pnr).toBe(res2.body.booking.pnr);
      expect(res1.body.booking.pnr).toMatch(/^SR[0-9A-Z]{8}$/);

      // Database verification: exactly ONE payment record in database with status SUCCESS
      const dbPayments = await pool.query('SELECT * FROM payments WHERE booking_id = $1', [booking.id]);
      expect(dbPayments.rows).toHaveLength(1);
      expect(dbPayments.rows[0].status).toBe('SUCCESS');
      expect(Number(dbPayments.rows[0].amount)).toBe(450);

      // Exactly ONE booking record with status CONFIRMED and matching PNR
      const dbBooking = await pool.query('SELECT * FROM bookings WHERE id = $1', [booking.id]);
      expect(dbBooking.rows).toHaveLength(1);
      expect(dbBooking.rows[0].status).toBe('CONFIRMED');
      expect(dbBooking.rows[0].pnr).toBe(res1.body.booking.pnr);

      // All seat allocations transitioned to ACTIVE
      const dbAlloc = await pool.query('SELECT * FROM seat_allocations WHERE id = $1', [allocations[0].id]);
      expect(dbAlloc.rows[0].status).toBe('ACTIVE');
    });
  });

  // ===========================================================================
  // Test 2 — Payment versus hold-expiration cleanup
  // ===========================================================================
  describe('Test 2 — Payment versus Expiration Cleanup Race', () => {
    test('2.1. Outcome A (Payment wins): confirmed booking and ACTIVE allocations are never cancelled by subsequent expiry cleanup', async () => {
      // 1. Create a provisional booking well within the 10-minute hold window
      const { booking, allocations } = await createProvisionalBooking({
        userId: userA.id,
        passengers: [{ status: 'CONFIRMED' }],
        backdatedMinutes: 3, // Valid, unexpired
      });

      // 2. Process payment on connection A
      const paymentResult = await paymentService.processPayment(userA.id, {
        bookingId: booking.id,
      });

      expect(paymentResult.success).toBe(true);
      expect(paymentResult.statusCode).toBe(200);
      expect(paymentResult.booking.status).toBe('CONFIRMED');

      // 3. Immediately run expiry cleanup on an independent connection B
      const clientB = await pool.connect();
      let cleanupResult;
      try {
        await clientB.query('BEGIN');
        cleanupResult = await bookingRepository.releaseExpiredHolds(clientB);
        await clientB.query('COMMIT');
      } finally {
        clientB.release();
      }

      // 4. Verify that expiry cleanup did NOT touch the confirmed booking
      const dbBooking = await pool.query('SELECT * FROM bookings WHERE id = $1', [booking.id]);
      expect(dbBooking.rows[0].status).toBe('CONFIRMED');
      expect(dbBooking.rows[0].pnr).toBe(paymentResult.booking.pnr);

      const dbAlloc = await pool.query('SELECT * FROM seat_allocations WHERE id = $1', [allocations[0].id]);
      expect(dbAlloc.rows[0].status).toBe('ACTIVE');

      const dbPayments = await pool.query('SELECT * FROM payments WHERE booking_id = $1', [booking.id]);
      expect(dbPayments.rows).toHaveLength(1);
      expect(dbPayments.rows[0].status).toBe('SUCCESS');
    });

    test('2.2. Outcome B (Expiration wins): expired hold cancelled by cleanup blocks subsequent payment with clean rejection', async () => {
      // 1. Create a booking that is past the 10-minute expiration window
      const { booking, allocations } = await createProvisionalBooking({
        userId: userA.id,
        passengers: [{ status: 'CONFIRMED' }],
        backdatedMinutes: 12, // Expired hold
      });

      // 2. Expiry cleanup executes first on independent connection B
      const clientB = await pool.connect();
      try {
        await clientB.query('BEGIN');
        await bookingRepository.releaseExpiredHolds(clientB);
        await clientB.query('COMMIT');
      } finally {
        clientB.release();
      }

      // 3. Attempt payment on connection A through HTTP endpoint
      const res = await request(app)
        .post('/api/payments/process')
        .set('Cookie', [cookieA])
        .send({ bookingId: booking.id });

      // Payment is rejected because booking is already CANCELLED
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('BOOKING_ALREADY_CANCELLED');

      // Database verification: booking CANCELLED, allocations RELEASED, zero SUCCESS payments, PNR remains NULL
      const dbBooking = await pool.query('SELECT * FROM bookings WHERE id = $1', [booking.id]);
      expect(dbBooking.rows[0].status).toBe('CANCELLED');
      expect(dbBooking.rows[0].pnr).toBeNull();

      const dbAlloc = await pool.query('SELECT * FROM seat_allocations WHERE id = $1', [allocations[0].id]);
      expect(dbAlloc.rows[0].status).toBe('RELEASED');

      const dbPayments = await pool.query('SELECT * FROM payments WHERE booking_id = $1', [booking.id]);
      expect(dbPayments.rows).toHaveLength(0);
    });

    test('2.3. Critical Timing Scenario: payment waits for row lock until after 10-minute deadline, clock_timestamp() detects expiry upon acquiring lock, and cancels booking safely', async () => {
      // 1. Create a provisional booking initially backdated near the boundary
      const { booking, allocations } = await createProvisionalBooking({
        userId: userA.id,
        passengers: [{ status: 'CONFIRMED' }],
        backdatedMinutes: 8,
      });

      // 2. Connection B locks the seat allocations row first to force the payment service to wait
      const connBlocker = await pool.connect();
      await connBlocker.query('BEGIN');
      await connBlocker.query(
        'SELECT sa.id FROM seat_allocations sa WHERE sa.id = $1 FOR UPDATE',
        [allocations[0].id]
      );

      // 3. Launch payment processing on Connection A in background
      // Because connBlocker holds the row lock on sa.id, paymentService will block in PostgreSQL
      let paymentError = null;
      let paymentResult = null;
      const paymentPromise = (async () => {
        try {
          paymentResult = await paymentService.processPayment(userA.id, {
            bookingId: booking.id,
          });
        } catch (err) {
          paymentError = err;
        }
      })();

      // 4. While payment service is blocked waiting for the row lock:
      // Update the booking's created_at to 15 minutes ago (simulating that the deadline passed while waiting)
      // Note: bookings row is not locked yet, so this update commits cleanly
      await pool.query(
        "UPDATE bookings SET created_at = NOW() - INTERVAL '15 minutes' WHERE id = $1",
        [booking.id]
      );

      // 5. Release connBlocker so payment service unblocks and acquires the row locks
      await connBlocker.query('COMMIT');
      connBlocker.release();

      // 6. Await payment service completion
      await paymentPromise;

      // 7. Verify payment was safely rejected with HTTP 410 BOOKING_HOLD_EXPIRED
      expect(paymentResult).toBeNull();
      expect(paymentError).toBeDefined();
      expect(paymentError.statusCode).toBe(410);
      expect(paymentError.code).toBe('BOOKING_HOLD_EXPIRED');

      // 8. Database verification:
      // The service must have safely cancelled the booking and released allocations
      const dbBooking = await pool.query('SELECT * FROM bookings WHERE id = $1', [booking.id]);
      expect(dbBooking.rows[0].status).toBe('CANCELLED');
      expect(dbBooking.rows[0].pnr).toBeNull();

      const dbAlloc = await pool.query('SELECT * FROM seat_allocations WHERE id = $1', [allocations[0].id]);
      expect(dbAlloc.rows[0].status).toBe('RELEASED');

      const dbPayments = await pool.query('SELECT * FROM payments WHERE booking_id = $1', [booking.id]);
      expect(dbPayments.rows).toHaveLength(0);
    });
  });

  // ===========================================================================
  // Test 3 — Seed Integrity Check
  // ===========================================================================
  describe('Test 3 — Development Seed Integrity', () => {
    test('3.1. development seed row counts must remain completely intact', async () => {
      const stations = await pool.query('SELECT COUNT(*) FROM stations');
      const trains = await pool.query('SELECT COUNT(*) FROM trains');
      const trainStops = await pool.query('SELECT COUNT(*) FROM train_stops');
      const coaches = await pool.query('SELECT COUNT(*) FROM coaches');
      const seats = await pool.query('SELECT COUNT(*) FROM seats');
      const foodItems = await pool.query('SELECT COUNT(*) FROM food_menu_items');

      expect(Number(stations.rows[0].count)).toBe(5);
      expect(Number(trains.rows[0].count)).toBe(2);
      expect(Number(trainStops.rows[0].count)).toBe(9);
      expect(Number(coaches.rows[0].count)).toBe(4);
      expect(Number(seats.rows[0].count)).toBe(276);
      expect(Number(foodItems.rows[0].count)).toBe(11);
    });
  });
});
