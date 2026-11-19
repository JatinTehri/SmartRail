/**
 * payment.process.test.js — HTTP Integration Tests for POST /api/payments/process
 *
 * Verifies end-to-end HTTP integration through Express app:
 *   1. Authentication & Authorization:
 *      - Rejects unauthenticated requests with HTTP 401 UNAUTHORIZED
 *      - Rejects tampered/invalid tokens with HTTP 401 UNAUTHORIZED
 *      - Enforces booking ownership with HTTP 403 FORBIDDEN
 *   2. Request Payload Validation:
 *      - Rejects missing/invalid bookingId with HTTP 400 VALIDATION_ERROR
 *      - Rejects invalid paymentMethod with HTTP 400 VALIDATION_ERROR
 *      - Rejects non-boolean simulateFailure with HTTP 400 VALIDATION_ERROR
 *      - Strictly rejects client-supplied authority fields (userId, user_id, amount, status, pnr) with HTTP 400
 *   3. Successful Payment & Booking Confirmation:
 *      - HTTP 200 OK with status CONFIRMED, 10-char alphanumeric PNR, ACTIVE seat allocations, SUCCESS payment
 *      - Verifies default paymentMethod 'MOCK_UPI' and custom paymentMethod 'CREDIT_CARD'
 *      - Verifies physical database state (bookings, seat_allocations, payments)
 *   4. Simulated Payment Failure & Retry Policy:
 *      - HTTP 402 Payment Required with FAILED payment record
 *      - Booking remains PENDING_PAYMENT, allocations remain HELD
 *      - Successful payment retry on the same booking transitions it to CONFIRMED with ACTIVE allocations
 *   5. Expired Booking Hold Handling:
 *      - HTTP 410 Gone when booking hold exceeds 10 minutes (> clock_timestamp())
 *      - Releases held seat allocations (RELEASED) and marks booking CANCELLED
 *   6. Booking Status & Idempotency:
 *      - Rejects cancelled booking with HTTP 400 BOOKING_ALREADY_CANCELLED
 *      - Rejects non-existent booking with HTTP 404 BOOKING_NOT_FOUND
 *      - Replays on already-confirmed booking return HTTP 200 with isIdempotent: true without duplicate payment
 *   7. Route Mounting Scope:
 *      - Confirms POST /api/payments/process is active
 *      - Confirms POST /api/payments (or /api/payments/) returns HTTP 404 (no unauthorized route aliases)
 *   8. Seed Integrity:
 *      - Verifies development seed database rows remain completely untouched
 */

'use strict';

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const request = require('supertest');
const app = require('../src/app');
const pool = require('../src/config/db');
const { generateToken } = require('../src/utils/token');

describe('POST /api/payments/process (HTTP Integration)', () => {
  const TEST_PREFIX = 'test.pprocess.';
  const generateEmail = (suffix) => `${TEST_PREFIX}${Date.now()}.${suffix}@example.com`;

  let userA, userB;
  let cookieA, cookieB;
  let trainExpId;
  let stnNdlsId, stnCnbId;
  let testSeats = [];
  const testJourneyDate = '2026-12-28';

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

    // 1. Create two test users (User A: legitimate owner, User B: unauthorized attacker)
    const userARes = await pool.query(
      "INSERT INTO users (name, email, password_hash, role) VALUES ('Payment HTTP User A', $1, 'hash_a', 'USER') RETURNING id, name, email",
      [generateEmail('usera')]
    );
    userA = userARes.rows[0];
    cookieA = `smartrail_token=${generateToken(userA.id)}`;

    const userBRes = await pool.query(
      "INSERT INTO users (name, email, password_hash, role) VALUES ('Payment HTTP User B', $1, 'hash_b', 'USER') RETURNING id, name, email",
      [generateEmail('userb')]
    );
    userB = userBRes.rows[0];
    cookieB = `smartrail_token=${generateToken(userB.id)}`;

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
  // 1. Authentication & Authorization
  // ===========================================================================
  describe('1. Authentication & Authorization', () => {
    test('1.1. rejects unauthenticated request (missing cookie) with HTTP 401', async () => {
      const { booking } = await createProvisionalBooking();

      const res = await request(app)
        .post('/api/payments/process')
        .send({ bookingId: booking.id });

      expect(res.status).toBe(401);
      expect(res.body.error).toBeDefined();
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    test('1.2. rejects tampered/invalid token with HTTP 401', async () => {
      const { booking } = await createProvisionalBooking();

      const res = await request(app)
        .post('/api/payments/process')
        .set('Cookie', ['smartrail_token=tampered.invalid.jwt.token'])
        .send({ bookingId: booking.id });

      expect(res.status).toBe(401);
      expect(res.body.error).toBeDefined();
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    test('1.3. rejects payment when User B attempts to pay for User A booking with HTTP 403', async () => {
      const { booking } = await createProvisionalBooking({ userId: userA.id });

      const res = await request(app)
        .post('/api/payments/process')
        .set('Cookie', [cookieB])
        .send({ bookingId: booking.id });

      expect(res.status).toBe(403);
      expect(res.body.error).toBeDefined();
      expect(res.body.error.code).toBe('FORBIDDEN');
    });
  });

  // ===========================================================================
  // 2. Request Payload Validation
  // ===========================================================================
  describe('2. Request Payload Validation', () => {
    test('2.1. rejects missing bookingId with HTTP 400 VALIDATION_ERROR', async () => {
      const res = await request(app)
        .post('/api/payments/process')
        .set('Cookie', [cookieA])
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.message).toMatch(/bookingId.*required/i);
    });

    test('2.2. rejects non-numeric or negative bookingId with HTTP 400 VALIDATION_ERROR', async () => {
      const res = await request(app)
        .post('/api/payments/process')
        .set('Cookie', [cookieA])
        .send({ bookingId: -5 });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.message).toMatch(/positive integer/i);
    });

    test('2.3. rejects invalid paymentMethod with HTTP 400 VALIDATION_ERROR', async () => {
      const { booking } = await createProvisionalBooking();

      const res = await request(app)
        .post('/api/payments/process')
        .set('Cookie', [cookieA])
        .send({ bookingId: booking.id, paymentMethod: 'CRYPTO_WALLET' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.message).toMatch(/Invalid payment method/i);
    });

    test('2.4. rejects non-boolean simulateFailure with HTTP 400 VALIDATION_ERROR', async () => {
      const { booking } = await createProvisionalBooking();

      const res = await request(app)
        .post('/api/payments/process')
        .set('Cookie', [cookieA])
        .send({ bookingId: booking.id, simulateFailure: 'true' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.message).toMatch(/simulateFailure must be a boolean/i);
    });

    test.each(['userId', 'user_id', 'amount', 'status', 'pnr'])(
      '2.5. strictly rejects client-supplied authority field "%s" with HTTP 400',
      async (field) => {
        const { booking } = await createProvisionalBooking();

        const payload = {
          bookingId: booking.id,
          [field]: 'tampered_value',
        };

        const res = await request(app)
          .post('/api/payments/process')
          .set('Cookie', [cookieA])
          .send(payload);

        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
        expect(res.body.error.message).toContain(`authority field "${field}" is not permitted`);
      }
    );
  });

  // ===========================================================================
  // 3. Successful Payment & Booking Confirmation
  // ===========================================================================
  describe('3. Successful Payment & Booking Confirmation', () => {
    test('3.1. confirms provisional booking with default MOCK_UPI payment method (HTTP 200)', async () => {
      const { booking, passengers, allocations } = await createProvisionalBooking({
        userId: userA.id,
        passengers: [{ status: 'CONFIRMED' }],
      });

      const res = await request(app)
        .post('/api/payments/process')
        .set('Cookie', [cookieA])
        .send({ bookingId: booking.id });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.statusCode).toBe(200);
      expect(res.body.isIdempotent).toBe(false);
      expect(res.body.message).toContain('Payment successful and booking confirmed');

      // Payment object assertions
      expect(res.body.payment).toBeDefined();
      expect(res.body.payment.status).toBe('SUCCESS');
      expect(res.body.payment.payment_method).toBe('MOCK_UPI');
      expect(Number(res.body.payment.amount)).toBe(450);
      expect(res.body.payment.transaction_reference).toMatch(/^TXN_MOCK_[a-f0-9-]+$/);

      // Booking object assertions
      expect(res.body.booking).toBeDefined();
      expect(res.body.booking.id).toBe(booking.id);
      expect(res.body.booking.status).toBe('CONFIRMED');
      expect(res.body.booking.pnr).toMatch(/^SR[0-9A-Z]{8}$/);
      expect(res.body.booking.trainId).toBe(trainExpId);

      // Passengers list assertions
      expect(Array.isArray(res.body.passengers)).toBe(true);
      expect(res.body.passengers).toHaveLength(1);
      const passenger = res.body.passengers[0];
      expect(passenger.passengerStatus).toBe('CONFIRMED');
      expect(passenger.allocationStatus).toBe('ACTIVE');
      expect(passenger.seatNumber).toBeDefined();
      expect(passenger.coachNumber).toBeDefined();

      // Database verification
      const dbBooking = await pool.query('SELECT * FROM bookings WHERE id = $1', [booking.id]);
      expect(dbBooking.rows[0].status).toBe('CONFIRMED');
      expect(dbBooking.rows[0].pnr).toBe(res.body.booking.pnr);

      const dbAlloc = await pool.query('SELECT * FROM seat_allocations WHERE id = $1', [allocations[0].id]);
      expect(dbAlloc.rows[0].status).toBe('ACTIVE');

      const dbPayments = await pool.query('SELECT * FROM payments WHERE booking_id = $1', [booking.id]);
      expect(dbPayments.rows).toHaveLength(1);
      expect(dbPayments.rows[0].status).toBe('SUCCESS');
      expect(dbPayments.rows[0].payment_method).toBe('MOCK_UPI');
      expect(Number(dbPayments.rows[0].amount)).toBe(450);
      expect(dbPayments.rows[0].transaction_reference).toBe(res.body.payment.transaction_reference);
    });

    test('3.2. confirms provisional booking with explicit CREDIT_CARD payment method (HTTP 200)', async () => {
      const { booking } = await createProvisionalBooking({
        userId: userA.id,
        passengers: [{ status: 'CONFIRMED' }],
      });

      const res = await request(app)
        .post('/api/payments/process')
        .set('Cookie', [cookieA])
        .send({ bookingId: booking.id, paymentMethod: 'credit_card' }); // Tests case normalization

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.payment.payment_method).toBe('CREDIT_CARD');

      const dbPayments = await pool.query('SELECT * FROM payments WHERE booking_id = $1', [booking.id]);
      expect(dbPayments.rows[0].payment_method).toBe('CREDIT_CARD');
    });
  });

  // ===========================================================================
  // 4. Simulated Payment Failure & Retry Policy
  // ===========================================================================
  describe('4. Simulated Payment Failure & Retry Policy', () => {
    test('4.1. records FAILED payment, leaves booking PENDING_PAYMENT, leaves holds HELD (HTTP 402)', async () => {
      const { booking, allocations } = await createProvisionalBooking({
        userId: userA.id,
        passengers: [{ status: 'CONFIRMED' }],
      });

      const res = await request(app)
        .post('/api/payments/process')
        .set('Cookie', [cookieA])
        .send({ bookingId: booking.id, simulateFailure: true });

      expect(res.status).toBe(402);
      expect(res.body.success).toBe(false);
      expect(res.body.statusCode).toBe(402);
      expect(res.body.message).toContain('Payment simulation failed');

      // Payment object assertions
      expect(res.body.payment).toBeDefined();
      expect(res.body.payment.status).toBe('FAILED');
      expect(res.body.payment.transaction_reference).toMatch(/^TXN_FAIL_[a-f0-9-]+$/);

      // Booking object assertions
      expect(res.body.booking.status).toBe('PENDING_PAYMENT');

      // Database verification
      const dbBooking = await pool.query('SELECT * FROM bookings WHERE id = $1', [booking.id]);
      expect(dbBooking.rows[0].status).toBe('PENDING_PAYMENT');
      expect(dbBooking.rows[0].pnr).toBeNull();

      const dbAlloc = await pool.query('SELECT * FROM seat_allocations WHERE id = $1', [allocations[0].id]);
      expect(dbAlloc.rows[0].status).toBe('HELD');

      const dbPayments = await pool.query('SELECT * FROM payments WHERE booking_id = $1', [booking.id]);
      expect(dbPayments.rows).toHaveLength(1);
      expect(dbPayments.rows[0].status).toBe('FAILED');
    });

    test('4.2. allows successful payment retry on same booking after failed attempt (HTTP 402 then HTTP 200)', async () => {
      const { booking, allocations } = await createProvisionalBooking({
        userId: userA.id,
        passengers: [{ status: 'CONFIRMED' }],
      });

      // Step 1: First attempt with simulateFailure: true -> HTTP 402
      const failRes = await request(app)
        .post('/api/payments/process')
        .set('Cookie', [cookieA])
        .send({ bookingId: booking.id, simulateFailure: true });

      expect(failRes.status).toBe(402);

      // Step 2: Second attempt with simulateFailure: false -> HTTP 200
      const retryRes = await request(app)
        .post('/api/payments/process')
        .set('Cookie', [cookieA])
        .send({ bookingId: booking.id, simulateFailure: false });

      expect(retryRes.status).toBe(200);
      expect(retryRes.body.success).toBe(true);
      expect(retryRes.body.booking.status).toBe('CONFIRMED');
      expect(retryRes.body.booking.pnr).toMatch(/^SR[0-9A-Z]{8}$/);

      // Database verification: exactly 2 payment records exist (1 FAILED, 1 SUCCESS)
      const dbPayments = await pool.query(
        'SELECT * FROM payments WHERE booking_id = $1 ORDER BY created_at ASC',
        [booking.id]
      );
      expect(dbPayments.rows).toHaveLength(2);
      expect(dbPayments.rows[0].status).toBe('FAILED');
      expect(dbPayments.rows[1].status).toBe('SUCCESS');

      // Allocation is now ACTIVE
      const dbAlloc = await pool.query('SELECT * FROM seat_allocations WHERE id = $1', [allocations[0].id]);
      expect(dbAlloc.rows[0].status).toBe('ACTIVE');
    });
  });

  // ===========================================================================
  // 5. Expired Booking Hold Handling
  // ===========================================================================
  describe('5. Expired Booking Hold Handling', () => {
    test('5.1. releases expired holds (> 10 mins), marks booking CANCELLED, and returns HTTP 410', async () => {
      const { booking, allocations } = await createProvisionalBooking({
        userId: userA.id,
        passengers: [{ status: 'CONFIRMED' }],
        backdatedMinutes: 11, // Past the 10-minute hold window
      });

      const res = await request(app)
        .post('/api/payments/process')
        .set('Cookie', [cookieA])
        .send({ bookingId: booking.id });

      expect(res.status).toBe(410);
      expect(res.body.error).toBeDefined();
      expect(res.body.error.code).toBe('BOOKING_HOLD_EXPIRED');

      // Database verification: booking CANCELLED, allocations RELEASED, zero payments
      const dbBooking = await pool.query('SELECT * FROM bookings WHERE id = $1', [booking.id]);
      expect(dbBooking.rows[0].status).toBe('CANCELLED');

      const dbAlloc = await pool.query('SELECT * FROM seat_allocations WHERE id = $1', [allocations[0].id]);
      expect(dbAlloc.rows[0].status).toBe('RELEASED');

      const dbPayments = await pool.query('SELECT * FROM payments WHERE booking_id = $1', [booking.id]);
      expect(dbPayments.rows).toHaveLength(0);
    });
  });

  // ===========================================================================
  // 6. Booking Status & Idempotency
  // ===========================================================================
  describe('6. Booking Status & Idempotency', () => {
    test('6.1. rejects payment for cancelled booking with HTTP 400 BOOKING_ALREADY_CANCELLED', async () => {
      const { booking } = await createProvisionalBooking({
        userId: userA.id,
        bookingStatus: 'CANCELLED',
      });

      const res = await request(app)
        .post('/api/payments/process')
        .set('Cookie', [cookieA])
        .send({ bookingId: booking.id });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('BOOKING_ALREADY_CANCELLED');
    });

    test('6.2. rejects payment for non-existent booking with HTTP 404 BOOKING_NOT_FOUND', async () => {
      const res = await request(app)
        .post('/api/payments/process')
        .set('Cookie', [cookieA])
        .send({ bookingId: 99999999 });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('BOOKING_NOT_FOUND');
    });

    test('6.3. replaying payment on already-confirmed booking returns HTTP 200 with isIdempotent: true', async () => {
      const { booking } = await createProvisionalBooking({
        userId: userA.id,
        passengers: [{ status: 'CONFIRMED' }],
      });

      // Initial payment
      const res1 = await request(app)
        .post('/api/payments/process')
        .set('Cookie', [cookieA])
        .send({ bookingId: booking.id });

      expect(res1.status).toBe(200);
      expect(res1.body.isIdempotent).toBe(false);
      const originalPnr = res1.body.booking.pnr;
      const originalTxnRef = res1.body.payment.transaction_reference;

      // Replayed payment attempt
      const res2 = await request(app)
        .post('/api/payments/process')
        .set('Cookie', [cookieA])
        .send({ bookingId: booking.id });

      expect(res2.status).toBe(200);
      expect(res2.body.success).toBe(true);
      expect(res2.body.isIdempotent).toBe(true);
      expect(res2.body.message).toContain('already confirmed');
      expect(res2.body.booking.pnr).toBe(originalPnr);
      expect(res2.body.payment.transaction_reference).toBe(originalTxnRef);

      // Verify no duplicate payment was created in database
      const dbPayments = await pool.query('SELECT * FROM payments WHERE booking_id = $1', [booking.id]);
      expect(dbPayments.rows).toHaveLength(1);
    });
  });

  // ===========================================================================
  // 7. Route Mounting Scope
  // ===========================================================================
  describe('7. Route Mounting Scope', () => {
    test('7.1. confirms POST /api/payments/process is mounted, but unauthorized aliases return 404', async () => {
      // POST /api/payments should return 404 (not mounted as an alias)
      const resRoot = await request(app)
        .post('/api/payments')
        .set('Cookie', [cookieA])
        .send({ bookingId: 1 });

      expect(resRoot.status).toBe(404);

      // POST /api/payments/ should also return 404
      const resSlash = await request(app)
        .post('/api/payments/')
        .set('Cookie', [cookieA])
        .send({ bookingId: 1 });

      expect(resSlash.status).toBe(404);
    });
  });

  // ===========================================================================
  // 8. Seed Integrity Check
  // ===========================================================================
  describe('8. Development Seed Integrity', () => {
    test('8.1. development seed row counts must remain completely intact', async () => {
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
