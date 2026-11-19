/**
 * payment.service.test.js — Integration Tests for Payment Service Layer
 *
 * Verifies business logic, transaction orchestration, and ACID safety using real PostgreSQL:
 *   1. Successful payment confirmation flow
 *   2. Failed payment with retryable booking state (402, booking stays PENDING_PAYMENT, holds stay HELD)
 *   3. Failed attempt followed by successful retry confirmation
 *   4. Expired booking hold cleanup and HTTP 410 rejection
 *   5. Ownership violation (HTTP 403) and non-existent booking (HTTP 404)
 *   6. Idempotent success replay on already-confirmed booking
 *   7. Inconsistent database state detection (PAYMENT_DATA_CORRUPTION)
 *   8. Allocation integrity verification (all 8 rules: missing, duplicate, unsupported status, collisions)
 *   9. Allocation activation and booking update row count verification
 *   10. SmartRail aggregate booking status policy (CONFIRMED, RAC, PARTIALLY_CONFIRMED)
 *   11. PNR collision handling with SAVEPOINT retry
 *   12. Requirement that valid allocations exist even for simulated failure
 *   13. Development seed integrity
 */

'use strict';

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const pool = require('../src/config/db');
const AppError = require('../src/errors/AppError');
const paymentService = require('../src/modules/payments/payment.service');
const paymentRepository = require('../src/modules/payments/payment.repository');
const pnrUtil = require('../src/utils/pnr');

describe('Payment Service (payment.service.js)', () => {
  const TEST_PREFIX = 'test.pservice.';
  const generateEmail = (suffix) => `${TEST_PREFIX}${Date.now()}.${suffix}@example.com`;

  let userA, userB;
  let trainExpId;
  let stnNdlsId, stnCnbId;
  let testSeats = [];
  const testJourneyDate = '2026-12-28';

  // Track created bookings for clean cascading teardown
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

    // 1. Create two test users (User A and User B)
    const userARes = await pool.query(
      "INSERT INTO users (name, email, password_hash, role) VALUES ('Payment User A', $1, 'hash_a', 'USER') RETURNING id, name, email",
      [generateEmail('usera')]
    );
    userA = userARes.rows[0];

    const userBRes = await pool.query(
      "INSERT INTO users (name, email, password_hash, role) VALUES ('Payment User B', $1, 'hash_b', 'USER') RETURNING id, name, email",
      [generateEmail('userb')]
    );
    userB = userBRes.rows[0];

    // 2. Discover seed stations (NDLS -> CNB)
    const stnRes = await pool.query(
      "SELECT id, code FROM stations WHERE code IN ('NDLS', 'CNB') ORDER BY code ASC"
    );
    stnNdlsId = stnRes.rows.find((s) => s.code === 'NDLS').id;
    stnCnbId = stnRes.rows.find((s) => s.code === 'CNB').id;

    // 3. Discover seed train (DEMO-EXP-01)
    const trainRes = await pool.query(
      "SELECT id FROM trains WHERE train_number = 'DEMO-EXP-01'"
    );
    trainExpId = trainRes.rows[0].id;

    // 4. Discover candidate seats (non-RAC and RAC capable)
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

      const totalAmount = passengers.length * 350;

      const bookingRes = await client.query(`
        INSERT INTO bookings (
          user_id, train_id, journey_date, source_station_id, destination_station_id,
          class_code, status, total_amount, pnr, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, '3A', $6, $7, NULL, $8, $8)
        RETURNING id, status, total_amount, created_at;
      `, [userId, trainExpId, testJourneyDate, stnNdlsId, stnCnbId, bookingStatus, totalAmount, createdAt]);

      const booking = bookingRes.rows[0];
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
        `, [booking.id, `Passenger ${i + 1}`, 25 + i, pDef.status]);

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
  // 1. Successful Payment Flow
  // ===========================================================================
  describe('Successful Payment Flow', () => {
    test('1.1. processes successful payment, confirms booking, activates allocations, issues PNR', async () => {
      const { booking } = await createProvisionalBooking({
        userId: userA.id,
        passengers: [{ status: 'CONFIRMED' }],
      });

      const result = await paymentService.processPayment(userA.id, {
        bookingId: booking.id,
        paymentMethod: 'MOCK_UPI',
        simulateFailure: false,
      });

      expect(result.success).toBe(true);
      expect(result.statusCode).toBe(200);
      expect(result.isIdempotent).toBe(false);
      expect(result.payment).toBeDefined();
      expect(result.payment.status).toBe('SUCCESS');
      expect(result.payment.booking_id).toBe(booking.id);
      expect(result.booking.status).toBe('CONFIRMED');
      expect(result.booking.pnr).toMatch(/^SR[0-9A-Z]{8}$/);
      expect(result.passengers).toHaveLength(1);
      expect(result.passengers[0].allocationStatus).toBe('ACTIVE');

      // Direct DB Verification
      const dbBooking = await pool.query('SELECT status, pnr FROM bookings WHERE id = $1', [booking.id]);
      expect(dbBooking.rows[0].status).toBe('CONFIRMED');
      expect(dbBooking.rows[0].pnr).toBe(result.booking.pnr);

      const dbAlloc = await pool.query(
        'SELECT status FROM seat_allocations WHERE booking_passenger_id IN (SELECT id FROM booking_passengers WHERE booking_id = $1)',
        [booking.id]
      );
      expect(dbAlloc.rows[0].status).toBe('ACTIVE');

      const dbPayment = await pool.query('SELECT status, amount FROM payments WHERE booking_id = $1', [booking.id]);
      expect(dbPayment.rows).toHaveLength(1);
      expect(dbPayment.rows[0].status).toBe('SUCCESS');
    });
  });

  // ===========================================================================
  // 2. Failed Payment with Retryable State
  // ===========================================================================
  describe('Failed Payment Simulation & Retry Policy', () => {
    test('2.1. records FAILED payment, leaves booking PENDING_PAYMENT, leaves holds HELD, returns 402', async () => {
      const { booking } = await createProvisionalBooking({
        userId: userA.id,
        passengers: [{ status: 'CONFIRMED' }],
      });

      const result = await paymentService.processPayment(userA.id, {
        bookingId: booking.id,
        paymentMethod: 'DEBIT_CARD',
        simulateFailure: true,
      });

      expect(result.success).toBe(false);
      expect(result.statusCode).toBe(402);
      expect(result.payment.status).toBe('FAILED');
      expect(result.booking.status).toBe('PENDING_PAYMENT');

      // Direct DB verification: Booking is still PENDING_PAYMENT and allocations are still HELD
      const dbBooking = await pool.query('SELECT status, pnr FROM bookings WHERE id = $1', [booking.id]);
      expect(dbBooking.rows[0].status).toBe('PENDING_PAYMENT');
      expect(dbBooking.rows[0].pnr).toBeNull();

      const dbAlloc = await pool.query(
        'SELECT status FROM seat_allocations WHERE booking_passenger_id IN (SELECT id FROM booking_passengers WHERE booking_id = $1)',
        [booking.id]
      );
      expect(dbAlloc.rows[0].status).toBe('HELD');

      const dbPayment = await pool.query('SELECT status FROM payments WHERE booking_id = $1', [booking.id]);
      expect(dbPayment.rows).toHaveLength(1);
      expect(dbPayment.rows[0].status).toBe('FAILED');
    });

    test('2.2. failed attempt followed by successful retry confirms the same booking', async () => {
      const { booking } = await createProvisionalBooking({
        userId: userA.id,
        passengers: [{ status: 'CONFIRMED' }],
      });

      // Attempt 1: Failed simulation
      const failResult = await paymentService.processPayment(userA.id, {
        bookingId: booking.id,
        paymentMethod: 'DEBIT_CARD',
        simulateFailure: true,
      });
      expect(failResult.statusCode).toBe(402);

      // Attempt 2: Successful retry on the exact same booking
      const successResult = await paymentService.processPayment(userA.id, {
        bookingId: booking.id,
        paymentMethod: 'UPI',
        simulateFailure: false,
      });

      expect(successResult.success).toBe(true);
      expect(successResult.statusCode).toBe(200);
      expect(successResult.booking.status).toBe('CONFIRMED');

      // Verify DB audit trail contains 2 records: [FAILED, SUCCESS]
      const dbPayments = await pool.query(
        'SELECT status, payment_method FROM payments WHERE booking_id = $1 ORDER BY id ASC',
        [booking.id]
      );
      expect(dbPayments.rows).toHaveLength(2);
      expect(dbPayments.rows[0].status).toBe('FAILED');
      expect(dbPayments.rows[1].status).toBe('SUCCESS');
    });
  });

  // ===========================================================================
  // 3. Expired Booking Hold Flow
  // ===========================================================================
  describe('Expired Booking Hold Handling', () => {
    test('3.1. expired booking hold releases allocations, cancels booking, and throws HTTP 410', async () => {
      const { booking } = await createProvisionalBooking({
        userId: userA.id,
        passengers: [{ status: 'CONFIRMED' }],
        backdatedMinutes: 15, // 15 minutes old (> 10-minute deadline)
      });

      await expect(
        paymentService.processPayment(userA.id, {
          bookingId: booking.id,
          paymentMethod: 'MOCK_UPI',
          simulateFailure: false,
        })
      ).rejects.toThrow(AppError);

      try {
        await paymentService.processPayment(userA.id, {
          bookingId: booking.id,
          paymentMethod: 'MOCK_UPI',
          simulateFailure: false,
        });
      } catch (err) {
        expect(err.statusCode).toBe(400); // Because now it is CANCELLED on second call
      }

      // Direct DB verification: The cleanup committed permanently
      const dbBooking = await pool.query('SELECT status FROM bookings WHERE id = $1', [booking.id]);
      expect(dbBooking.rows[0].status).toBe('CANCELLED');

      const dbAlloc = await pool.query(
        'SELECT status FROM seat_allocations WHERE booking_passenger_id IN (SELECT id FROM booking_passengers WHERE booking_id = $1)',
        [booking.id]
      );
      expect(dbAlloc.rows[0].status).toBe('RELEASED');

      const dbPassengers = await pool.query(
        'SELECT passenger_status FROM booking_passengers WHERE booking_id = $1',
        [booking.id]
      );
      expect(dbPassengers.rows[0].passenger_status).toBe('CANCELLED');

      // Zero payment records created for expired booking
      const dbPayments = await pool.query('SELECT * FROM payments WHERE booking_id = $1', [booking.id]);
      expect(dbPayments.rows).toHaveLength(0);
    });
  });

  // ===========================================================================
  // 4. Ownership and Validation Violations
  // ===========================================================================
  describe('Security & Status Validations', () => {
    test('4.1. throws HTTP 403 when User B attempts to pay for User A booking', async () => {
      const { booking } = await createProvisionalBooking({
        userId: userA.id,
        passengers: [{ status: 'CONFIRMED' }],
      });

      await expect(
        paymentService.processPayment(userB.id, {
          bookingId: booking.id,
          paymentMethod: 'MOCK_UPI',
          simulateFailure: false,
        })
      ).rejects.toMatchObject({
        statusCode: 403,
        code: 'FORBIDDEN',
      });
    });

    test('4.2. throws HTTP 404 when bookingId does not exist', async () => {
      await expect(
        paymentService.processPayment(userA.id, {
          bookingId: 999999999,
          paymentMethod: 'MOCK_UPI',
          simulateFailure: false,
        })
      ).rejects.toMatchObject({
        statusCode: 404,
        code: 'BOOKING_NOT_FOUND',
      });
    });

    test('4.3. throws HTTP 400 when booking is already CANCELLED', async () => {
      const { booking } = await createProvisionalBooking({
        userId: userA.id,
        passengers: [{ status: 'CONFIRMED' }],
        bookingStatus: 'CANCELLED',
      });

      await expect(
        paymentService.processPayment(userA.id, {
          bookingId: booking.id,
          paymentMethod: 'MOCK_UPI',
          simulateFailure: false,
        })
      ).rejects.toMatchObject({
        statusCode: 400,
        code: 'BOOKING_ALREADY_CANCELLED',
      });
    });
  });

  // ===========================================================================
  // 5. Idempotency & Data Corruption Guards
  // ===========================================================================
  describe('Idempotency & Data Corruption Guards', () => {
    test('5.1. already-confirmed booking returns existing confirmation receipt without new payment row', async () => {
      const { booking } = await createProvisionalBooking({
        userId: userA.id,
        passengers: [{ status: 'CONFIRMED' }],
      });

      // Initial payment
      const first = await paymentService.processPayment(userA.id, {
        bookingId: booking.id,
        paymentMethod: 'MOCK_UPI',
        simulateFailure: false,
      });

      // Repeat request
      const replay = await paymentService.processPayment(userA.id, {
        bookingId: booking.id,
        paymentMethod: 'MOCK_UPI',
        simulateFailure: false,
      });

      expect(replay.success).toBe(true);
      expect(replay.isIdempotent).toBe(true);
      expect(replay.payment.id).toBe(first.payment.id);
      expect(replay.booking.pnr).toBe(first.booking.pnr);

      // Verify no duplicate payment record inserted
      const count = await pool.query('SELECT COUNT(*) FROM payments WHERE booking_id = $1', [booking.id]);
      expect(Number(count.rows[0].count)).toBe(1);
    });

    test('5.2. throws HTTP 500 when confirmed booking has no SUCCESS payment record (corruption guard)', async () => {
      const { booking } = await createProvisionalBooking({
        userId: userA.id,
        passengers: [{ status: 'CONFIRMED' }],
        bookingStatus: 'CONFIRMED',
      });

      await expect(
        paymentService.processPayment(userA.id, {
          bookingId: booking.id,
          paymentMethod: 'MOCK_UPI',
          simulateFailure: false,
        })
      ).rejects.toMatchObject({
        statusCode: 500,
        code: 'PAYMENT_DATA_CORRUPTION',
      });
    });

    test('5.3. throws HTTP 500 when pending booking already has a SUCCESS payment record (corruption guard)', async () => {
      const { booking } = await createProvisionalBooking({
        userId: userA.id,
        passengers: [{ status: 'CONFIRMED' }],
        bookingStatus: 'PENDING_PAYMENT',
      });

      // Insert an orphaned SUCCESS payment record
      await pool.query(`
        INSERT INTO payments (booking_id, amount, status, payment_method, transaction_reference)
        VALUES ($1, 350.00, 'SUCCESS', 'MOCK_UPI', $2)
      `, [booking.id, `TXN_ORPHAN_${Date.now()}`]);

      await expect(
        paymentService.processPayment(userA.id, {
          bookingId: booking.id,
          paymentMethod: 'MOCK_UPI',
          simulateFailure: false,
        })
      ).rejects.toMatchObject({
        statusCode: 500,
        code: 'PAYMENT_DATA_CORRUPTION',
      });
    });
  });

  // ===========================================================================
  // 6. Allocation Integrity Verification (Rules 1-8)
  // ===========================================================================
  describe('Strengthened Allocation Integrity Rules', () => {
    test('6.1. throws HTTP 409 when passenger status is unsupported (e.g. WAITLIST)', async () => {
      const { booking } = await createProvisionalBooking({
        userId: userA.id,
        passengers: [{ status: 'WAITLIST' }],
      });

      await expect(
        paymentService.processPayment(userA.id, {
          bookingId: booking.id,
          paymentMethod: 'MOCK_UPI',
        })
      ).rejects.toMatchObject({
        statusCode: 409,
        code: 'ALLOCATION_INTEGRITY_ERROR',
      });
    });

    test('6.2. throws HTTP 409 when allocation count does not match passenger count', async () => {
      const { booking, allocations } = await createProvisionalBooking({
        userId: userA.id,
        passengers: [{ status: 'CONFIRMED' }],
      });

      // Delete the allocation
      await pool.query('DELETE FROM seat_allocations WHERE id = $1', [allocations[0].id]);

      await expect(
        paymentService.processPayment(userA.id, {
          bookingId: booking.id,
          paymentMethod: 'MOCK_UPI',
        })
      ).rejects.toMatchObject({
        statusCode: 409,
        code: 'ALLOCATION_INTEGRITY_ERROR',
      });
    });

    test('6.3. throws HTTP 409 when an allocation is not in HELD status', async () => {
      const { booking, allocations } = await createProvisionalBooking({
        userId: userA.id,
        passengers: [{ status: 'CONFIRMED' }],
      });

      // Flip status to RELEASED prematurely
      await pool.query("UPDATE seat_allocations SET status = 'RELEASED' WHERE id = $1", [allocations[0].id]);

      await expect(
        paymentService.processPayment(userA.id, {
          bookingId: booking.id,
          paymentMethod: 'MOCK_UPI',
        })
      ).rejects.toMatchObject({
        statusCode: 409,
        code: 'ALLOCATION_INTEGRITY_ERROR',
      });
    });

    test('6.4. throws HTTP 409 when two CONFIRMED passengers share the same physical seat', async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const bookingRes = await client.query(`
          INSERT INTO bookings (user_id, train_id, journey_date, source_station_id, destination_station_id, class_code, status, total_amount)
          VALUES ($1, $2, $3, $4, $5, '3A', 'PENDING_PAYMENT', 700.00) RETURNING id;
        `, [userA.id, trainExpId, testJourneyDate, stnNdlsId, stnCnbId]);
        const bId = bookingRes.rows[0].id;
        createdBookingIds.push(bId);

        const p1 = await client.query("INSERT INTO booking_passengers (booking_id, name_snapshot, age_snapshot, gender_snapshot, passenger_status) VALUES ($1, 'P1', 30, 'M', 'CONFIRMED') RETURNING id;", [bId]);
        const p2 = await client.query("INSERT INTO booking_passengers (booking_id, name_snapshot, age_snapshot, gender_snapshot, passenger_status) VALUES ($1, 'P2', 32, 'M', 'CONFIRMED') RETURNING id;", [bId]);

        // Assign same physical seat to both confirmed passengers
        await client.query("INSERT INTO seat_allocations (booking_passenger_id, seat_id, journey_date, from_stop_order, to_stop_order, allocation_type, rac_slot, status) VALUES ($1, $2, $3, 1, 2, 'CONFIRMED', NULL, 'HELD');", [p1.rows[0].id, testSeats[0].id, testJourneyDate]);
        await client.query("INSERT INTO seat_allocations (booking_passenger_id, seat_id, journey_date, from_stop_order, to_stop_order, allocation_type, rac_slot, status) VALUES ($1, $2, $3, 1, 2, 'CONFIRMED', NULL, 'HELD');", [p2.rows[0].id, testSeats[0].id, testJourneyDate]);

        await client.query('COMMIT');

        await expect(
          paymentService.processPayment(userA.id, { bookingId: bId, paymentMethod: 'MOCK_UPI' })
        ).rejects.toMatchObject({
          statusCode: 409,
          code: 'ALLOCATION_INTEGRITY_ERROR',
        });
      } finally {
        client.release();
      }
    });

    test('6.5b. throws HTTP 409 when a CONFIRMED and RAC passenger share the same physical berth', async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const bookingRes = await client.query(`
          INSERT INTO bookings (user_id, train_id, journey_date, source_station_id, destination_station_id, class_code, status, total_amount)
          VALUES ($1, $2, $3, $4, $5, '3A', 'PENDING_PAYMENT', 700.00) RETURNING id;
        `, [userA.id, trainExpId, testJourneyDate, stnNdlsId, stnCnbId]);
        const bId = bookingRes.rows[0].id;
        createdBookingIds.push(bId);

        const p1 = await client.query("INSERT INTO booking_passengers (booking_id, name_snapshot, age_snapshot, gender_snapshot, passenger_status) VALUES ($1, 'P1', 30, 'M', 'CONFIRMED') RETURNING id;", [bId]);
        const p2 = await client.query("INSERT INTO booking_passengers (booking_id, name_snapshot, age_snapshot, gender_snapshot, passenger_status) VALUES ($1, 'P2', 32, 'M', 'RAC') RETURNING id;", [bId]);

        // Attempt to share the same physical berth between Confirmed and RAC
        await client.query("INSERT INTO seat_allocations (booking_passenger_id, seat_id, journey_date, from_stop_order, to_stop_order, allocation_type, rac_slot, status) VALUES ($1, $2, $3, 1, 2, 'CONFIRMED', NULL, 'HELD');", [p1.rows[0].id, testSeats[0].id, testJourneyDate]);
        await client.query("INSERT INTO seat_allocations (booking_passenger_id, seat_id, journey_date, from_stop_order, to_stop_order, allocation_type, rac_slot, status) VALUES ($1, $2, $3, 1, 2, 'RAC', 1, 'HELD');", [p2.rows[0].id, testSeats[0].id, testJourneyDate]);

        await client.query('COMMIT');

        await expect(
          paymentService.processPayment(userA.id, { bookingId: bId, paymentMethod: 'MOCK_UPI' })
        ).rejects.toMatchObject({
          statusCode: 409,
          code: 'ALLOCATION_INTEGRITY_ERROR',
        });
      } finally {
        client.release();
      }
    });

    test('6.5. throws HTTP 409 when two RAC passengers share the same slot on the same berth', async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const bookingRes = await client.query(`
          INSERT INTO bookings (user_id, train_id, journey_date, source_station_id, destination_station_id, class_code, status, total_amount)
          VALUES ($1, $2, $3, $4, $5, '3A', 'PENDING_PAYMENT', 700.00) RETURNING id;
        `, [userA.id, trainExpId, testJourneyDate, stnNdlsId, stnCnbId]);
        const bId = bookingRes.rows[0].id;
        createdBookingIds.push(bId);

        const p1 = await client.query("INSERT INTO booking_passengers (booking_id, name_snapshot, age_snapshot, gender_snapshot, passenger_status) VALUES ($1, 'P1', 30, 'M', 'RAC') RETURNING id;", [bId]);
        const p2 = await client.query("INSERT INTO booking_passengers (booking_id, name_snapshot, age_snapshot, gender_snapshot, passenger_status) VALUES ($1, 'P2', 32, 'M', 'RAC') RETURNING id;", [bId]);

        // Assign same slot 1 on the same physical seat
        await client.query("INSERT INTO seat_allocations (booking_passenger_id, seat_id, journey_date, from_stop_order, to_stop_order, allocation_type, rac_slot, status) VALUES ($1, $2, $3, 1, 2, 'RAC', 1, 'HELD');", [p1.rows[0].id, testSeats[0].id, testJourneyDate]);
        await client.query("INSERT INTO seat_allocations (booking_passenger_id, seat_id, journey_date, from_stop_order, to_stop_order, allocation_type, rac_slot, status) VALUES ($1, $2, $3, 1, 2, 'RAC', 1, 'HELD');", [p2.rows[0].id, testSeats[0].id, testJourneyDate]);

        await client.query('COMMIT');

        await expect(
          paymentService.processPayment(userA.id, { bookingId: bId, paymentMethod: 'MOCK_UPI' })
        ).rejects.toMatchObject({
          statusCode: 409,
          code: 'ALLOCATION_INTEGRITY_ERROR',
        });
      } finally {
        client.release();
      }
    });

    test('6.6. valid allocations are required even for a simulated failed payment attempt', async () => {
      const { booking, allocations } = await createProvisionalBooking({
        userId: userA.id,
        passengers: [{ status: 'CONFIRMED' }],
      });

      // Invalidate allocation status
      await pool.query("UPDATE seat_allocations SET status = 'CANCELLED' WHERE id = $1", [allocations[0].id]);

      // Attempt simulated failure on an invalid booking
      await expect(
        paymentService.processPayment(userA.id, {
          bookingId: booking.id,
          paymentMethod: 'MOCK_UPI',
          simulateFailure: true,
        })
      ).rejects.toMatchObject({
        statusCode: 409,
        code: 'ALLOCATION_INTEGRITY_ERROR',
      });

      // Direct DB check: No failed payment was recorded because validation aborted beforehand
      const count = await pool.query('SELECT COUNT(*) FROM payments WHERE booking_id = $1', [booking.id]);
      expect(Number(count.rows[0].count)).toBe(0);
    });
  });

  // ===========================================================================
  // 7. SmartRail Aggregate Booking Status Policy
  // ===========================================================================
  describe('SmartRail Aggregate Booking Status Policy', () => {
    test('7.1. all-RAC passengers resolve to aggregate status RAC', async () => {
      const { booking } = await createProvisionalBooking({
        userId: userA.id,
        passengers: [
          { status: 'RAC', racSlot: 1 },
        ],
      });

      const result = await paymentService.processPayment(userA.id, {
        bookingId: booking.id,
        paymentMethod: 'MOCK_UPI',
      });

      expect(result.success).toBe(true);
      expect(result.booking.status).toBe('RAC');
    });

    test('7.2. mixed CONFIRMED and RAC passengers resolve to aggregate status PARTIALLY_CONFIRMED', async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const bookingRes = await client.query(`
          INSERT INTO bookings (user_id, train_id, journey_date, source_station_id, destination_station_id, class_code, status, total_amount)
          VALUES ($1, $2, $3, $4, $5, '3A', 'PENDING_PAYMENT', 700.00) RETURNING id;
        `, [userA.id, trainExpId, testJourneyDate, stnNdlsId, stnCnbId]);
        const bId = bookingRes.rows[0].id;
        createdBookingIds.push(bId);

        const p1 = await client.query("INSERT INTO booking_passengers (booking_id, name_snapshot, age_snapshot, gender_snapshot, passenger_status) VALUES ($1, 'P1', 30, 'M', 'CONFIRMED') RETURNING id;", [bId]);
        const p2 = await client.query("INSERT INTO booking_passengers (booking_id, name_snapshot, age_snapshot, gender_snapshot, passenger_status) VALUES ($1, 'P2', 32, 'M', 'RAC') RETURNING id;", [bId]);

        await client.query("INSERT INTO seat_allocations (booking_passenger_id, seat_id, journey_date, from_stop_order, to_stop_order, allocation_type, rac_slot, status) VALUES ($1, $2, $3, 1, 2, 'CONFIRMED', NULL, 'HELD');", [p1.rows[0].id, testSeats[0].id, testJourneyDate]);
        await client.query("INSERT INTO seat_allocations (booking_passenger_id, seat_id, journey_date, from_stop_order, to_stop_order, allocation_type, rac_slot, status) VALUES ($1, $2, $3, 1, 2, 'RAC', 1, 'HELD');", [p2.rows[0].id, testSeats[1].id, testJourneyDate]);

        await client.query('COMMIT');

        const result = await paymentService.processPayment(userA.id, {
          bookingId: bId,
          paymentMethod: 'MOCK_UPI',
        });

        expect(result.success).toBe(true);
        expect(result.booking.status).toBe('PARTIALLY_CONFIRMED');
      } finally {
        client.release();
      }
    });
  });

  // ===========================================================================
  // 8. PNR Collision & SAVEPOINT Retry Handling
  // ===========================================================================
  describe('PNR Collision & SAVEPOINT Retry', () => {
    test('8.1. retries successfully on bookings_pnr_key unique constraint violation', async () => {
      const { booking } = await createProvisionalBooking({
        userId: userA.id,
        passengers: [{ status: 'CONFIRMED' }],
      });

      // Pre-occupy a PNR in the database by confirming a dummy booking
      const collidingPnr = 'SRCOLLIDE1';
      const dummyRes = await pool.query(`
        INSERT INTO bookings (user_id, train_id, journey_date, source_station_id, destination_station_id, class_code, status, total_amount, pnr)
        VALUES ($1, $2, $3, $4, $5, '3A', 'CONFIRMED', 350.00, $6)
        RETURNING id;
      `, [userB.id, trainExpId, testJourneyDate, stnNdlsId, stnCnbId, collidingPnr]);
      createdBookingIds.push(dummyRes.rows[0].id);

      // Spy on generatePnr: produce collidingPnr on attempt 1, then a fresh one on attempt 2
      const originalGeneratePnr = pnrUtil.generatePnr;
      let callCount = 0;
      jest.spyOn(pnrUtil, 'generatePnr').mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return collidingPnr; // Collides with dummy booking!
        }
        return originalGeneratePnr(); // Success on attempt 2
      });

      try {
        const result = await paymentService.processPayment(userA.id, {
          bookingId: booking.id,
          paymentMethod: 'MOCK_UPI',
        });

        expect(callCount).toBeGreaterThanOrEqual(2);
        expect(result.success).toBe(true);
        expect(result.booking.pnr).not.toBe(collidingPnr);
        expect(result.booking.pnr).toMatch(/^SR[0-9A-Z]{8}$/);
      } finally {
        pnrUtil.generatePnr.mockRestore();
      }
    });

    test('8.2. throws HTTP 500 when updateBookingStatusAndPnr rowCount is not exactly 1 (booking update mismatch)', async () => {
      const { booking } = await createProvisionalBooking({
        userId: userA.id,
        passengers: [{ status: 'CONFIRMED' }],
      });

      jest.spyOn(paymentRepository, 'updateBookingStatusAndPnr').mockResolvedValueOnce(null);

      try {
        await expect(
          paymentService.processPayment(userA.id, {
            bookingId: booking.id,
            paymentMethod: 'MOCK_UPI',
          })
        ).rejects.toMatchObject({
          statusCode: 500,
          code: 'BOOKING_UPDATE_FAILED',
        });
      } finally {
        paymentRepository.updateBookingStatusAndPnr.mockRestore();
      }
    });

    test('8.3. throws HTTP 500 when activationResult.rowCount does not match expected allocations (activation mismatch)', async () => {
      const { booking } = await createProvisionalBooking({
        userId: userA.id,
        passengers: [{ status: 'CONFIRMED' }],
      });

      jest.spyOn(paymentRepository, 'activateSeatAllocationsByBookingId').mockResolvedValueOnce({
        activatedAllocations: [],
        rowCount: 0, // Expected 1, received 0
      });

      try {
        await expect(
          paymentService.processPayment(userA.id, {
            bookingId: booking.id,
            paymentMethod: 'MOCK_UPI',
          })
        ).rejects.toMatchObject({
          statusCode: 500,
          code: 'ALLOCATION_ACTIVATION_FAILED',
        });
      } finally {
        paymentRepository.activateSeatAllocationsByBookingId.mockRestore();
      }
    });

    test('8.4. throws error and rolls back when unique constraint violation is unrelated to PNR', async () => {
      const { booking } = await createProvisionalBooking({
        userId: userA.id,
        passengers: [{ status: 'CONFIRMED' }],
      });

      const unrelatedError = new Error('duplicate key value violates unique constraint "some_other_key"');
      unrelatedError.code = '23505';
      unrelatedError.constraint = 'some_other_key';

      jest.spyOn(paymentRepository, 'updateBookingStatusAndPnr').mockRejectedValueOnce(unrelatedError);

      try {
        await expect(
          paymentService.processPayment(userA.id, {
            bookingId: booking.id,
            paymentMethod: 'MOCK_UPI',
          })
        ).rejects.toThrow('some_other_key');
      } finally {
        paymentRepository.updateBookingStatusAndPnr.mockRestore();
      }
    });

    test('8.5. throws error and rolls back when transaction reference unique collision occurs on payments_transaction_reference_key', async () => {
      const { booking } = await createProvisionalBooking({
        userId: userA.id,
        passengers: [{ status: 'CONFIRMED' }],
      });

      const txnError = new Error('duplicate key value violates unique constraint "payments_transaction_reference_key"');
      txnError.code = '23505';
      txnError.constraint = 'payments_transaction_reference_key';

      jest.spyOn(paymentRepository, 'createPaymentRecord').mockRejectedValueOnce(txnError);

      try {
        await expect(
          paymentService.processPayment(userA.id, {
            bookingId: booking.id,
            paymentMethod: 'MOCK_UPI',
          })
        ).rejects.toThrow('payments_transaction_reference_key');
      } finally {
        paymentRepository.createPaymentRecord.mockRestore();
      }
    });
  });

  // ===========================================================================
  // 9. Seed Data Integrity Check
  // ===========================================================================
  describe('Seed Integrity Check', () => {
    test('9.1. development seed row counts must remain completely intact', async () => {
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
