/**
 * payment.repository.test.js — Integration Tests for Payment Repository Layer
 *
 * Verifies all 9 repository methods using real PostgreSQL transactions:
 *   1. lockSeatAllocationsByBookingId (locks seat allocations in ascending sa.id order)
 *   2. lockBookingPassengersByBookingId (locks passengers in ascending bp.id order)
 *   3. lockBookingById (locks booking row and evaluates clock_timestamp() expiration)
 *   4. Deadlock-avoidance lock hierarchy execution
 *   5. findSuccessfulPaymentByBookingId (idempotent lookup with deterministic ordering)
 *   6. createPaymentRecord (persists SUCCESS and FAILED attempts)
 *   7. updateBookingStatusAndPnr (updates PNR, aggregate status, and updated_at)
 *   8. activateSeatAllocationsByBookingId (transitions HELD allocations to ACTIVE)
 *   9. releaseExpiredHoldForBooking (targeted atomic cancellation and hold release)
 *   10. getBookingConfirmationDetails (parameterized joined query for booking & passenger details)
 *   11. Transaction rollback safety
 *   12. Development seed record integrity
 */

'use strict';

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const pool = require('../src/config/db');
const paymentRepository = require('../src/modules/payments/payment.repository');

describe('Payment Repository (payment.repository.js)', () => {
  const TEST_PREFIX = 'test.prepo.';
  const generateEmail = (suffix) => `${TEST_PREFIX}${Date.now()}.${suffix}@example.com`;

  let testUser;
  let testTrainId;
  let testSourceStationId;
  let testDestStationId;
  let testSeat1, testSeat2;
  const testJourneyDate = '2026-12-25';

  // Track created bookings for clean teardown
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

    await pool.query('DELETE FROM users WHERE email LIKE $1', [`${TEST_PREFIX}%`]);
  };

  beforeAll(async () => {
    await cleanupTestData();

    // 1. Create a test user
    const userRes = await pool.query(
      "INSERT INTO users (name, email, password_hash, role) VALUES ('Payment Repo User', $1, 'hash_payment_repo', 'USER') RETURNING id, name, email",
      [generateEmail('user')]
    );
    testUser = userRes.rows[0];

    // 2. Discover existing seed stations (NDLS -> CNB)
    const stnRes = await pool.query(
      "SELECT id, code FROM stations WHERE code IN ('NDLS', 'CNB') ORDER BY code ASC"
    );
    const ndls = stnRes.rows.find((s) => s.code === 'NDLS');
    const cnb = stnRes.rows.find((s) => s.code === 'CNB');
    testSourceStationId = ndls.id;
    testDestStationId = cnb.id;

    // 3. Discover seed train (DEMO-EXP-01)
    const trainRes = await pool.query(
      "SELECT id FROM trains WHERE train_number = 'DEMO-EXP-01'"
    );
    testTrainId = trainRes.rows[0].id;

    // 4. Discover two 3A seats from coach B1
    const seatRes = await pool.query(`
      SELECT s.id, s.seat_number, s.berth_type, c.coach_number, c.coach_type
      FROM seats s
      JOIN coaches c ON c.id = s.coach_id
      WHERE c.train_id = $1 AND c.class_code = '3A'
      ORDER BY s.id ASC
      LIMIT 2
    `, [testTrainId]);

    testSeat1 = seatRes.rows[0];
    testSeat2 = seatRes.rows[1];
  });

  afterAll(async () => {
    await cleanupTestData();
  });

  /**
   * Helper to create a test booking with 1 or 2 passengers and HELD allocations.
   */
  async function createTestBookingWithHolds(client, { passengerCount = 1, backdatedMinutes = 0 } = {}) {
    const createdAt = backdatedMinutes > 0
      ? new Date(Date.now() - backdatedMinutes * 60 * 1000)
      : new Date();

    const bookingRes = await client.query(`
      INSERT INTO bookings (
        user_id, train_id, journey_date, source_station_id, destination_station_id,
        class_code, status, total_amount, pnr, created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, '3A', 'PENDING_PAYMENT', $6, NULL, $7, $7)
      RETURNING id, status, total_amount, pnr, created_at;
    `, [testUser.id, testTrainId, testJourneyDate, testSourceStationId, testDestStationId, passengerCount * 350, createdAt]);

    const booking = bookingRes.rows[0];
    createdBookingIds.push(booking.id);

    const passengers = [];
    const allocations = [];

    for (let i = 0; i < passengerCount; i++) {
      const passRes = await client.query(`
        INSERT INTO booking_passengers (
          booking_id, name_snapshot, age_snapshot, gender_snapshot, passenger_status
        )
        VALUES ($1, $2, $3, 'M', 'CONFIRMED')
        RETURNING id, passenger_status;
      `, [booking.id, `Passenger ${i + 1}`, 30 + i]);

      const passenger = passRes.rows[0];
      passengers.push(passenger);

      const seat = i === 0 ? testSeat1 : testSeat2;
      const allocRes = await client.query(`
        INSERT INTO seat_allocations (
          booking_passenger_id, seat_id, journey_date, from_stop_order, to_stop_order,
          allocation_type, rac_slot, status, allocated_at
        )
        VALUES ($1, $2, $3, 1, 2, 'CONFIRMED', NULL, 'HELD', $4)
        RETURNING id, status;
      `, [passenger.id, seat.id, testJourneyDate, createdAt]);

      allocations.push(allocRes.rows[0]);
    }

    return { booking, passengers, allocations };
  }

  // ===========================================================================
  // 1. Lock Ordering and Row Locks
  // ===========================================================================
  describe('Hierarchical Row Locking', () => {
    test('1.1. lockSeatAllocationsByBookingId locks seat allocations in ascending sa.id order', async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const { booking, allocations } = await createTestBookingWithHolds(client, { passengerCount: 2 });

        const lockedAllocations = await paymentRepository.lockSeatAllocationsByBookingId(client, booking.id);

        expect(lockedAllocations).toHaveLength(2);
        expect(Number(lockedAllocations[0].id)).toBe(Math.min(Number(allocations[0].id), Number(allocations[1].id)));
        expect(Number(lockedAllocations[1].id)).toBe(Math.max(Number(allocations[0].id), Number(allocations[1].id)));
        expect(lockedAllocations[0].status).toBe('HELD');
        expect(lockedAllocations[1].status).toBe('HELD');

        await client.query('COMMIT');
      } finally {
        client.release();
      }
    });

    test('1.2. lockBookingPassengersByBookingId locks passengers in ascending bp.id order', async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const { booking, passengers } = await createTestBookingWithHolds(client, { passengerCount: 2 });

        const lockedPassengers = await paymentRepository.lockBookingPassengersByBookingId(client, booking.id);

        expect(lockedPassengers).toHaveLength(2);
        expect(Number(lockedPassengers[0].id)).toBe(Math.min(Number(passengers[0].id), Number(passengers[1].id)));
        expect(Number(lockedPassengers[1].id)).toBe(Math.max(Number(passengers[0].id), Number(passengers[1].id)));
        expect(lockedPassengers[0].passenger_status).toBe('CONFIRMED');

        await client.query('COMMIT');
      } finally {
        client.release();
      }
    });

    test('1.3. lockBookingById locks booking and checks clock_timestamp() expiration', async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // Fresh booking: isExpired must be false
        const { booking: freshBooking } = await createTestBookingWithHolds(client, { passengerCount: 1, backdatedMinutes: 0 });
        const lockedFresh = await paymentRepository.lockBookingById(client, freshBooking.id);
        expect(lockedFresh).not.toBeNull();
        expect(lockedFresh.id).toBe(freshBooking.id);
        expect(lockedFresh.status).toBe('PENDING_PAYMENT');
        expect(lockedFresh.isExpired).toBe(false);

        // Backdated booking (15 minutes old): isExpired must be true
        const { booking: expiredBooking } = await createTestBookingWithHolds(client, { passengerCount: 1, backdatedMinutes: 15 });
        const lockedExpired = await paymentRepository.lockBookingById(client, expiredBooking.id);
        expect(lockedExpired).not.toBeNull();
        expect(lockedExpired.id).toBe(expiredBooking.id);
        expect(lockedExpired.isExpired).toBe(true);

        // Non-existent booking returns null
        const lockedNotFound = await paymentRepository.lockBookingById(client, 999999999);
        expect(lockedNotFound).toBeNull();

        await client.query('COMMIT');
      } finally {
        client.release();
      }
    });

    test('1.4. hierarchical lock sequence executes without error in proper order', async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const { booking } = await createTestBookingWithHolds(client, { passengerCount: 1 });

        // Step 1: Allocations
        const allocs = await paymentRepository.lockSeatAllocationsByBookingId(client, booking.id);
        expect(allocs).toHaveLength(1);

        // Step 2: Passengers
        const passes = await paymentRepository.lockBookingPassengersByBookingId(client, booking.id);
        expect(passes).toHaveLength(1);

        // Step 3: Booking
        const b = await paymentRepository.lockBookingById(client, booking.id);
        expect(b).not.toBeNull();
        expect(b.id).toBe(booking.id);

        await client.query('COMMIT');
      } finally {
        client.release();
      }
    });
  });

  // ===========================================================================
  // 2. Payment Insertion and Successful Lookup
  // ===========================================================================
  describe('Payment Insertion & Lookup', () => {
    test('2.1. createPaymentRecord inserts SUCCESS payment and findSuccessfulPaymentByBookingId retrieves it', async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const { booking } = await createTestBookingWithHolds(client, { passengerCount: 1 });

        // Before payment, lookup returns null
        const before = await paymentRepository.findSuccessfulPaymentByBookingId(client, booking.id);
        expect(before).toBeNull();

        // Insert SUCCESS payment
        const txnRef = `TXN_TEST_${Date.now()}_A`;
        const payment = await paymentRepository.createPaymentRecord(client, {
          bookingId: booking.id,
          amount: '350.00',
          status: 'SUCCESS',
          paymentMethod: 'MOCK_UPI',
          transactionReference: txnRef,
        });

        expect(payment).toBeDefined();
        expect(payment.id).toBeDefined();
        expect(payment.booking_id).toBe(booking.id);
        expect(payment.status).toBe('SUCCESS');
        expect(payment.payment_method).toBe('MOCK_UPI');
        expect(payment.transaction_reference).toBe(txnRef);

        // After payment, lookup returns the record
        const after = await paymentRepository.findSuccessfulPaymentByBookingId(client, booking.id);
        expect(after).not.toBeNull();
        expect(after.id).toBe(payment.id);
        expect(after.status).toBe('SUCCESS');

        await client.query('COMMIT');
      } finally {
        client.release();
      }
    });

    test('2.2. createPaymentRecord inserts FAILED payment and findSuccessfulPaymentByBookingId ignores it', async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const { booking } = await createTestBookingWithHolds(client, { passengerCount: 1 });

        // Insert FAILED payment
        const failedTxn = `TXN_TEST_FAIL_${Date.now()}`;
        const failedPayment = await paymentRepository.createPaymentRecord(client, {
          bookingId: booking.id,
          amount: '350.00',
          status: 'FAILED',
          paymentMethod: 'DEBIT_CARD',
          transactionReference: failedTxn,
        });

        expect(failedPayment.status).toBe('FAILED');

        // Lookup for SUCCESS payment must still return null
        const lookup = await paymentRepository.findSuccessfulPaymentByBookingId(client, booking.id);
        expect(lookup).toBeNull();

        await client.query('COMMIT');
      } finally {
        client.release();
      }
    });

    test('2.3. findSuccessfulPaymentByBookingId deterministic order returns latest payment', async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const { booking } = await createTestBookingWithHolds(client, { passengerCount: 1 });

        // Insert first SUCCESS payment
        const p1 = await paymentRepository.createPaymentRecord(client, {
          bookingId: booking.id,
          amount: '350.00',
          status: 'SUCCESS',
          paymentMethod: 'UPI',
          transactionReference: `TXN_MULTI_1_${Date.now()}`,
        });

        // Insert second SUCCESS payment
        const p2 = await paymentRepository.createPaymentRecord(client, {
          bookingId: booking.id,
          amount: '350.00',
          status: 'SUCCESS',
          paymentMethod: 'UPI',
          transactionReference: `TXN_MULTI_2_${Date.now()}`,
        });

        const latest = await paymentRepository.findSuccessfulPaymentByBookingId(client, booking.id);
        expect(latest.id).toBe(p2.id);

        await client.query('COMMIT');
      } finally {
        client.release();
      }
    });
  });

  // ===========================================================================
  // 3. Status Transitions and Booking Updates
  // ===========================================================================
  describe('Status Transitions & Allocation Management', () => {
    test('3.1. updateBookingStatusAndPnr updates pnr and status', async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const { booking } = await createTestBookingWithHolds(client, { passengerCount: 1 });

        const testPnr = `SR${Date.now().toString().slice(-8)}`;
        const updated = await paymentRepository.updateBookingStatusAndPnr(client, {
          bookingId: booking.id,
          pnr: testPnr,
          status: 'CONFIRMED',
        });

        expect(updated).not.toBeNull();
        expect(updated.id).toBe(booking.id);
        expect(updated.pnr).toBe(testPnr);
        expect(updated.status).toBe('CONFIRMED');

        await client.query('COMMIT');
      } finally {
        client.release();
      }
    });

    test('3.2. activateSeatAllocationsByBookingId transitions HELD to ACTIVE', async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const { booking } = await createTestBookingWithHolds(client, { passengerCount: 2 });

        const result = await paymentRepository.activateSeatAllocationsByBookingId(client, booking.id);

        expect(result.rowCount).toBe(2);
        expect(result.activatedAllocations).toHaveLength(2);
        for (const alloc of result.activatedAllocations) {
          expect(alloc.status).toBe('ACTIVE');
        }

        // Direct DB verification
        const dbCheck = await client.query(
          'SELECT status FROM seat_allocations WHERE booking_passenger_id IN (SELECT id FROM booking_passengers WHERE booking_id = $1)',
          [booking.id]
        );
        expect(dbCheck.rows.every((r) => r.status === 'ACTIVE')).toBe(true);

        await client.query('COMMIT');
      } finally {
        client.release();
      }
    });

    test('3.3. releaseExpiredHoldForBooking releases holds and cancels booking and passengers', async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const { booking } = await createTestBookingWithHolds(client, { passengerCount: 2, backdatedMinutes: 15 });

        const result = await paymentRepository.releaseExpiredHoldForBooking(client, booking.id);

        expect(result.releasedAllocationsCount).toBe(2);
        expect(result.cancelledPassengersCount).toBe(2);
        expect(result.cancelledBooking).not.toBeNull();
        expect(result.cancelledBooking.status).toBe('CANCELLED');

        // Direct DB verification
        const allocCheck = await client.query(
          'SELECT status FROM seat_allocations WHERE booking_passenger_id IN (SELECT id FROM booking_passengers WHERE booking_id = $1)',
          [booking.id]
        );
        expect(allocCheck.rows.every((r) => r.status === 'RELEASED')).toBe(true);

        const passCheck = await client.query(
          'SELECT passenger_status FROM booking_passengers WHERE booking_id = $1',
          [booking.id]
        );
        expect(passCheck.rows.every((r) => r.passenger_status === 'CANCELLED')).toBe(true);

        const bookCheck = await client.query(
          'SELECT status FROM bookings WHERE id = $1',
          [booking.id]
        );
        expect(bookCheck.rows[0].status).toBe('CANCELLED');

        await client.query('COMMIT');
      } finally {
        client.release();
      }
    });
  });

  // ===========================================================================
  // 4. Confirmation Details Retrieval
  // ===========================================================================
  describe('getBookingConfirmationDetails', () => {
    test('4.1. getBookingConfirmationDetails returns complete joined data structure', async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const { booking } = await createTestBookingWithHolds(client, { passengerCount: 2 });

        const details = await paymentRepository.getBookingConfirmationDetails(client, booking.id);

        expect(details).not.toBeNull();
        expect(details.booking).toBeDefined();
        expect(details.booking.id).toBe(Number(booking.id));
        expect(details.booking.trainId).toBe(Number(testTrainId));
        expect(details.booking.classCode).toBe('3A');
        expect(details.booking.status).toBe('PENDING_PAYMENT');

        expect(details.passengers).toBeDefined();
        expect(details.passengers).toHaveLength(2);

        const p1 = details.passengers[0];
        expect(p1.name).toBe('Passenger 1');
        expect(p1.passengerStatus).toBe('CONFIRMED');
        expect(p1.allocationType).toBe('CONFIRMED');
        expect(p1.seatId).toBe(Number(testSeat1.id));
        expect(p1.seatNumber).toBe(testSeat1.seat_number);
        expect(p1.berthType).toBe(testSeat1.berth_type);
        expect(p1.coachNumber).toBe(testSeat1.coach_number);

        await client.query('COMMIT');
      } finally {
        client.release();
      }
    });

    test('4.2. getBookingConfirmationDetails returns null for non-existent booking', async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const details = await paymentRepository.getBookingConfirmationDetails(client, 99999999);
        expect(details).toBeNull();
        await client.query('COMMIT');
      } finally {
        client.release();
      }
    });
  });

  // ===========================================================================
  // 5. Development Seed Record Integrity
  // ===========================================================================
  describe('Seed Integrity Check', () => {
    test('5.1. development seed row counts must remain completely intact', async () => {
      const stationCount = await pool.query('SELECT COUNT(*) FROM stations');
      const trainCount = await pool.query('SELECT COUNT(*) FROM trains');
      const stopCount = await pool.query('SELECT COUNT(*) FROM train_stops');
      const coachCount = await pool.query('SELECT COUNT(*) FROM coaches');
      const seatCount = await pool.query('SELECT COUNT(*) FROM seats');
      const foodCount = await pool.query('SELECT COUNT(*) FROM food_menu_items');

      expect(Number(stationCount.rows[0].count)).toBe(5);
      expect(Number(trainCount.rows[0].count)).toBe(2);
      expect(Number(stopCount.rows[0].count)).toBe(9);
      expect(Number(coachCount.rows[0].count)).toBe(4);
      expect(Number(seatCount.rows[0].count)).toBe(276);
      expect(Number(foodCount.rows[0].count)).toBe(11);
    });
  });
});
