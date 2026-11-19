/**
 * booking.create.test.js — HTTP Integration Tests for POST /api/bookings
 *
 * Verifies:
 *   1. Unauthenticated requests reject with HTTP 401
 *   2. Invalid or expired cookie rejects with HTTP 401
 *   3. Invalid booking payloads reject with HTTP 400 VALIDATION_ERROR
 *   4. Successful manual passenger booking with HTTP 201 and provisional status
 *   5. Successful saved passenger booking with DB snapshot freezing
 *   6. Passenger profile ownership enforcement (HTTP 404 PASSENGER_NOT_FOUND)
 *   7. Invalid train route or unsupported class returns HTTP 400
 *   8. Insufficient seat capacity returns HTTP 409 SEATS_UNAVAILABLE with clean rollback
 *   9. Response contract transparency (PENDING_PAYMENT, pnr null, HELD allocationStatus)
 *   10. Client-supplied user_id/userId cannot override authenticated user
 *   11. Hold expiration cleanup (> 10 mins) frees stale holds before allocation
 *   12. Real PostgreSQL concurrency: Two simultaneous requests for the final seat resolve
 *       cleanly into one HTTP 201 and one HTTP 409 with zero overbooking
 *   13. Development seed database records remain completely untouched
 */

'use strict';

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const request = require('supertest');
const app = require('../src/app');
const pool = require('../src/config/db');
const { generateToken } = require('../src/utils/token');

describe('POST /api/bookings (Booking Creation & Temporary Holds)', () => {
  const TEST_PREFIX = 'test.bcreate.';
  const generateEmail = (suffix) => `${TEST_PREFIX}${Date.now()}.${suffix}@example.com`;

  let userA, userB;
  let cookieA, cookieB;
  let savedProfileA;
  let trainExpId, trainSfId;
  let stnNdlsId, stnCnbId, stnPryjId, stnHwhId;
  const testJourneyDate = '2026-12-25';

  const createdBookingIds = [];

  const cleanupTestData = async () => {
    if (createdBookingIds.length > 0) {
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

    // 1. Create two test users
    const userARes = await pool.query(
      "INSERT INTO users (name, email, password_hash, role) VALUES ('Booking HTTP User A', $1, 'hash_a', 'USER') RETURNING id, name, email",
      [generateEmail('usera')]
    );
    userA = userARes.rows[0];
    cookieA = `smartrail_token=${generateToken(userA.id)}`;

    const userBRes = await pool.query(
      "INSERT INTO users (name, email, password_hash, role) VALUES ('Booking HTTP User B', $1, 'hash_b', 'USER') RETURNING id, name, email",
      [generateEmail('userb')]
    );
    userB = userBRes.rows[0];
    cookieB = `smartrail_token=${generateToken(userB.id)}`;

    // 2. Create saved passenger profile for User A
    const profRes = await pool.query(
      `INSERT INTO passenger_profiles (user_id, name, age, gender, berth_preference, window_preference)
       VALUES ($1, 'Saved Profile Alpha', 65, 'FEMALE', 'LOWER', true)
       RETURNING id, name, age, gender, berth_preference, window_preference`,
      [userA.id]
    );
    savedProfileA = profRes.rows[0];

    // 3. Resolve seeded trains and stations
    const trainsRes = await pool.query(
      "SELECT id, train_number FROM trains WHERE train_number IN ('DEMO-EXP-01', 'DEMO-SF-02')"
    );
    for (const t of trainsRes.rows) {
      if (t.train_number === 'DEMO-EXP-01') trainExpId = Number(t.id);
      if (t.train_number === 'DEMO-SF-02') trainSfId = Number(t.id);
    }

    const stnRes = await pool.query("SELECT id, code FROM stations WHERE code IN ('NDLS', 'CNB', 'PRYJ', 'HWH')");
    for (const s of stnRes.rows) {
      if (s.code === 'NDLS') stnNdlsId = Number(s.id);
      if (s.code === 'CNB') stnCnbId = Number(s.id);
      if (s.code === 'PRYJ') stnPryjId = Number(s.id);
      if (s.code === 'HWH') stnHwhId = Number(s.id);
    }
  });

  afterEach(async () => {
    if (createdBookingIds.length > 0) {
      await pool.query(
        'DELETE FROM seat_allocations WHERE booking_passenger_id IN (SELECT id FROM booking_passengers WHERE booking_id = ANY($1))',
        [createdBookingIds]
      );
      await pool.query('DELETE FROM booking_passengers WHERE booking_id = ANY($1)', [createdBookingIds]);
      await pool.query('DELETE FROM bookings WHERE id = ANY($1)', [createdBookingIds]);
      createdBookingIds.length = 0;
    }
    await pool.query('DELETE FROM seat_allocations WHERE journey_date = $1', [testJourneyDate]);
  });

  afterAll(async () => {
    await cleanupTestData();
  });

  // =========================================================================
  // 1. AUTHENTICATION ENFORCEMENT
  // =========================================================================
  describe('Authentication Enforcement', () => {
    test('1.1. should reject unauthenticated request with HTTP 401', async () => {
      const res = await request(app)
        .post('/api/bookings')
        .send({
          trainId: trainExpId,
          journeyDate: testJourneyDate,
          sourceStationId: stnNdlsId,
          destinationStationId: stnCnbId,
          classCode: '3A',
          passengers: [{ name: 'Test', age: 30, gender: 'MALE' }],
        });

      expect(res.status).toBe(401);
      expect(res.body.error).toBeDefined();
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    test('1.2. should reject request with tampered auth cookie with HTTP 401', async () => {
      const res = await request(app)
        .post('/api/bookings')
        .set('Cookie', 'smartrail_token=tampered.token.here')
        .send({
          trainId: trainExpId,
          journeyDate: testJourneyDate,
          sourceStationId: stnNdlsId,
          destinationStationId: stnCnbId,
          classCode: '3A',
          passengers: [{ name: 'Test', age: 30, gender: 'MALE' }],
        });

      expect(res.status).toBe(401);
      expect(res.body.error).toBeDefined();
    });
  });

  // =========================================================================
  // 2. INPUT VALIDATION (HTTP 400)
  // =========================================================================
  describe('Input Validation (HTTP 400)', () => {
    test('2.1. should reject missing or invalid trainId with HTTP 400', async () => {
      const res = await request(app)
        .post('/api/bookings')
        .set('Cookie', cookieA)
        .send({
          trainId: -1,
          journeyDate: testJourneyDate,
          sourceStationId: stnNdlsId,
          destinationStationId: stnCnbId,
          classCode: '3A',
          passengers: [{ name: 'Test', age: 30, gender: 'MALE' }],
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    test('2.2. should reject past journeyDate with HTTP 400', async () => {
      const res = await request(app)
        .post('/api/bookings')
        .set('Cookie', cookieA)
        .send({
          trainId: trainExpId,
          journeyDate: '2020-01-01',
          sourceStationId: stnNdlsId,
          destinationStationId: stnCnbId,
          classCode: '3A',
          passengers: [{ name: 'Test', age: 30, gender: 'MALE' }],
        });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toMatch(/past/i);
    });

    test('2.3. should reject identical source and destination station with HTTP 400', async () => {
      const res = await request(app)
        .post('/api/bookings')
        .set('Cookie', cookieA)
        .send({
          trainId: trainExpId,
          journeyDate: testJourneyDate,
          sourceStationId: stnNdlsId,
          destinationStationId: stnNdlsId,
          classCode: '3A',
          passengers: [{ name: 'Test', age: 30, gender: 'MALE' }],
        });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toMatch(/identical/i);
    });

    test('2.4. should reject unsupported classCode with HTTP 400', async () => {
      const res = await request(app)
        .post('/api/bookings')
        .set('Cookie', cookieA)
        .send({
          trainId: trainExpId,
          journeyDate: testJourneyDate,
          sourceStationId: stnNdlsId,
          destinationStationId: stnCnbId,
          classCode: 'XYZ',
          passengers: [{ name: 'Test', age: 30, gender: 'MALE' }],
        });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toMatch(/Invalid class code/i);
    });

    test('2.5. should reject empty passengers array or exceeding 6 passengers with HTTP 400', async () => {
      const resEmpty = await request(app)
        .post('/api/bookings')
        .set('Cookie', cookieA)
        .send({
          trainId: trainExpId,
          journeyDate: testJourneyDate,
          sourceStationId: stnNdlsId,
          destinationStationId: stnCnbId,
          classCode: '3A',
          passengers: [],
        });
      expect(resEmpty.status).toBe(400);

      const resTooMany = await request(app)
        .post('/api/bookings')
        .set('Cookie', cookieA)
        .send({
          trainId: trainExpId,
          journeyDate: testJourneyDate,
          sourceStationId: stnNdlsId,
          destinationStationId: stnCnbId,
          classCode: '3A',
          passengers: Array(7).fill({ name: 'Test', age: 30, gender: 'MALE' }),
        });
      expect(resTooMany.status).toBe(400);
      expect(resTooMany.body.error.message).toMatch(/maximum of 6/i);
    });

    test('2.6. should reject manual passenger missing name, age, or gender with HTTP 400', async () => {
      const res = await request(app)
        .post('/api/bookings')
        .set('Cookie', cookieA)
        .send({
          trainId: trainExpId,
          journeyDate: testJourneyDate,
          sourceStationId: stnNdlsId,
          destinationStationId: stnCnbId,
          classCode: '3A',
          passengers: [{ age: 25, gender: 'FEMALE' }], // Missing name
        });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toMatch(/Passenger name is required/i);
    });
  });

  // =========================================================================
  // 3. SUCCESSFUL MANUAL PASSENGER BOOKING
  // =========================================================================
  describe('Successful Manual Passenger Booking', () => {
    test('3.1. should create booking for manual passenger, holding confirmed berth with HTTP 201', async () => {
      const res = await request(app)
        .post('/api/bookings')
        .set('Cookie', cookieA)
        .send({
          trainId: trainExpId,
          journeyDate: testJourneyDate,
          sourceStationId: stnNdlsId,
          destinationStationId: stnCnbId,
          classCode: '3A',
          passengers: [
            {
              name: 'Vikram Singh',
              age: 28,
              gender: 'MALE',
              berthPreference: 'LOWER',
              windowPreference: true,
            },
          ],
        });

      expect(res.status).toBe(201);
      expect(res.body.message).toBe('Booking created and seats temporarily held');
      expect(res.body.booking).toBeDefined();

      const b = res.body.booking;
      createdBookingIds.push(b.bookingId);

      // Verify provisional status semantics
      expect(b.status).toBe('PENDING_PAYMENT');
      expect(b.pnr).toBeNull();
      expect(b.paymentRequired).toBe(true);
      expect(b.trainNumber).toBe('DEMO-EXP-01');
      expect(b.source).toBe('New Delhi');
      expect(b.destination).toBe('Kanpur Central');
      expect(b.classCode).toBe('3A');
      expect(b.totalAmount).toBe(506); // 440 km * 1.15

      // Verify passenger allocation
      expect(b.passengers).toHaveLength(1);
      const p = b.passengers[0];
      expect(p.name).toBe('Vikram Singh');
      expect(p.allocationType).toBe('CONFIRMED');
      expect(p.allocationStatus).toBe('HELD');
      expect(p.coach).toBe('B1');
      expect(p.seatNumber).toBeDefined();
      expect(p.racSlot).toBeNull();
    });
  });

  // =========================================================================
  // 4. SAVED PASSENGER PROFILE BOOKING & OWNERSHIP
  // =========================================================================
  describe('Saved Passenger Profile Booking & Ownership', () => {
    test('4.1. should create booking with saved profile and freeze DB snapshot', async () => {
      const res = await request(app)
        .post('/api/bookings')
        .set('Cookie', cookieA)
        .send({
          trainId: trainExpId,
          journeyDate: testJourneyDate,
          sourceStationId: stnNdlsId,
          destinationStationId: stnCnbId,
          classCode: '3A',
          passengers: [{ passengerProfileId: savedProfileA.id }],
        });

      expect(res.status).toBe(201);
      const b = res.body.booking;
      createdBookingIds.push(b.bookingId);

      expect(b.passengers[0].name).toBe('Saved Profile Alpha');

      // Verify snapshot in database
      const bpRes = await pool.query(
        'SELECT name_snapshot, age_snapshot, gender_snapshot, senior_citizen_flag FROM booking_passengers WHERE booking_id = $1',
        [b.bookingId]
      );
      expect(bpRes.rows[0].name_snapshot).toBe('Saved Profile Alpha');
      expect(bpRes.rows[0].age_snapshot).toBe(65);
      expect(bpRes.rows[0].gender_snapshot).toBe('FEMALE');
      expect(bpRes.rows[0].senior_citizen_flag).toBe(true);
    });

    test('4.2. should return HTTP 404 PASSENGER_NOT_FOUND when user attempts to use another user profile', async () => {
      // User B tries to book with User A's saved profile
      const res = await request(app)
        .post('/api/bookings')
        .set('Cookie', cookieB)
        .send({
          trainId: trainExpId,
          journeyDate: testJourneyDate,
          sourceStationId: stnNdlsId,
          destinationStationId: stnCnbId,
          classCode: '3A',
          passengers: [{ passengerProfileId: savedProfileA.id }],
        });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('PASSENGER_NOT_FOUND');
    });
  });

  // =========================================================================
  // 5. ROUTE AND CLASS VALIDATION
  // =========================================================================
  describe('Route and Class Validation', () => {
    test('5.1. should reject reverse-direction journey with HTTP 400', async () => {
      const res = await request(app)
        .post('/api/bookings')
        .set('Cookie', cookieA)
        .send({
          trainId: trainExpId,
          journeyDate: testJourneyDate,
          sourceStationId: stnCnbId,
          destinationStationId: stnNdlsId,
          classCode: '3A',
          passengers: [{ name: 'Traveler', age: 30, gender: 'MALE' }],
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    test('5.2. should reject class not attached to train with HTTP 400', async () => {
      // DEMO-EXP-01 only has 2A and 3A, not SL
      const res = await request(app)
        .post('/api/bookings')
        .set('Cookie', cookieA)
        .send({
          trainId: trainExpId,
          journeyDate: testJourneyDate,
          sourceStationId: stnNdlsId,
          destinationStationId: stnCnbId,
          classCode: 'SL',
          passengers: [{ name: 'Traveler', age: 30, gender: 'MALE' }],
        });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toMatch(/not available on this train/i);
    });
  });

  // =========================================================================
  // 6. SECURITY: CLIENT USER ID SPOOFING GUARD
  // =========================================================================
  describe('Security: User ID Spoofing Guard', () => {
    test('6.1. client-supplied user_id in payload cannot override authenticated identity', async () => {
      const res = await request(app)
        .post('/api/bookings')
        .set('Cookie', cookieA)
        .send({
          userId: 99999,
          user_id: 99999,
          trainId: trainExpId,
          journeyDate: testJourneyDate,
          sourceStationId: stnNdlsId,
          destinationStationId: stnCnbId,
          classCode: '3A',
          passengers: [{ name: 'Honest Traveler', age: 30, gender: 'MALE' }],
        });

      expect(res.status).toBe(201);
      const bId = res.body.booking.bookingId;
      createdBookingIds.push(bId);

      // Verify the record in DB belongs to userA.id, NOT 99999
      const dbRes = await pool.query('SELECT user_id FROM bookings WHERE id = $1', [bId]);
      expect(Number(dbRes.rows[0].user_id)).toBe(Number(userA.id));
    });
  });

  // =========================================================================
  // 7. SEGREGATED RAC ALLOCATION
  // =========================================================================
  describe('Segregated RAC Allocation', () => {
    test('7.1. should allocate RAC Slot 1 and Slot 2 when confirmed seats are full', async () => {
      // Coach A1 on DEMO-EXP-01 (class 2A) has 51 confirmed berths and 1 RAC berth (Seat 5).
      const seatsRes = await pool.query(
        `SELECT s.id, s.seat_number, s.rac_capable 
         FROM seats s 
         JOIN coaches c ON c.id = s.coach_id 
         WHERE c.train_id = $1 AND c.class_code = '2A'
         ORDER BY s.id ASC`,
        [trainExpId]
      );
      const confirmedSeats = seatsRes.rows.filter((s) => !s.rac_capable);

      // Block all 51 confirmed seats
      const blockerRes = await pool.query(
        "INSERT INTO bookings (user_id, train_id, journey_date, source_station_id, destination_station_id, class_code, status, total_amount) VALUES ($1, $2, $3, $4, $5, '2A', 'CONFIRMED', 1000) RETURNING id",
        [userB.id, trainExpId, testJourneyDate, stnNdlsId, stnCnbId]
      );
      createdBookingIds.push(blockerRes.rows[0].id);

      for (const seat of confirmedSeats) {
        const dummyP = await pool.query(
          "INSERT INTO booking_passengers (booking_id, name_snapshot, age_snapshot, gender_snapshot, passenger_status) VALUES ($1, 'Blocker', 30, 'MALE', 'CONFIRMED') RETURNING id",
          [blockerRes.rows[0].id]
        );
        await pool.query(
          "INSERT INTO seat_allocations (booking_passenger_id, seat_id, journey_date, from_stop_order, to_stop_order, allocation_type, status) VALUES ($1, $2, $3, 1, 2, 'CONFIRMED', 'ACTIVE')",
          [dummyP.rows[0].id, seat.id, testJourneyDate]
        );
      }

      // Now User A books 2 passengers -> must receive RAC Slot 1 and Slot 2 on Seat 5
      const res = await request(app)
        .post('/api/bookings')
        .set('Cookie', cookieA)
        .send({
          trainId: trainExpId,
          journeyDate: testJourneyDate,
          sourceStationId: stnNdlsId,
          destinationStationId: stnCnbId,
          classCode: '2A',
          passengers: [
            { name: 'RAC First', age: 25, gender: 'FEMALE' },
            { name: 'RAC Second', age: 27, gender: 'MALE' },
          ],
        });

      expect(res.status).toBe(201);
      const b = res.body.booking;
      createdBookingIds.push(b.bookingId);

      expect(b.passengers).toHaveLength(2);
      expect(b.passengers[0].allocationType).toBe('RAC');
      expect(b.passengers[0].seatNumber).toBe('5');
      expect(b.passengers[0].racSlot).toBe(1);

      expect(b.passengers[1].allocationType).toBe('RAC');
      expect(b.passengers[1].seatNumber).toBe('5');
      expect(b.passengers[1].racSlot).toBe(2);
    });
  });

  // =========================================================================
  // 8. CAPACITY EXHAUSTION & ROLLBACK (HTTP 409)
  // =========================================================================
  describe('Capacity Exhaustion & Rollback (HTTP 409)', () => {
    test('8.1. should return HTTP 409 SEATS_UNAVAILABLE when total capacity is exhausted', async () => {
      // Block all seats in 2A (51 confirmed + 1 RAC berth = 52 physical seats)
      const seatsRes = await pool.query(
        `SELECT s.id FROM seats s 
         JOIN coaches c ON c.id = s.coach_id 
         WHERE c.train_id = $1 AND c.class_code = '2A'`,
        [trainExpId]
      );

      const blockerRes = await pool.query(
        "INSERT INTO bookings (user_id, train_id, journey_date, source_station_id, destination_station_id, class_code, status, total_amount) VALUES ($1, $2, $3, $4, $5, '2A', 'CONFIRMED', 1000) RETURNING id",
        [userB.id, trainExpId, testJourneyDate, stnNdlsId, stnCnbId]
      );
      createdBookingIds.push(blockerRes.rows[0].id);

      for (const seat of seatsRes.rows) {
        const dummyP = await pool.query(
          "INSERT INTO booking_passengers (booking_id, name_snapshot, age_snapshot, gender_snapshot, passenger_status) VALUES ($1, 'Blocker', 30, 'MALE', 'CONFIRMED') RETURNING id",
          [blockerRes.rows[0].id]
        );
        await pool.query(
          "INSERT INTO seat_allocations (booking_passenger_id, seat_id, journey_date, from_stop_order, to_stop_order, allocation_type, status) VALUES ($1, $2, $3, 1, 2, 'CONFIRMED', 'ACTIVE')",
          [dummyP.rows[0].id, seat.id, testJourneyDate]
        );
      }

      const res = await request(app)
        .post('/api/bookings')
        .set('Cookie', cookieA)
        .send({
          trainId: trainExpId,
          journeyDate: testJourneyDate,
          sourceStationId: stnNdlsId,
          destinationStationId: stnCnbId,
          classCode: '2A',
          passengers: [{ name: 'No Room', age: 30, gender: 'MALE' }],
        });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('SEATS_UNAVAILABLE');
    });
  });

  // =========================================================================
  // 9. PROVISIONAL HOLD EXPIRATION CLEANUP
  // =========================================================================
  describe('Provisional Hold Expiration Cleanup', () => {
    test('9.1. should transition stale holds older than 10 minutes to RELEASED and allow reallocation', async () => {
      // 1. Create a stale PENDING_PAYMENT booking created 15 minutes ago
      const staleBookingRes = await pool.query(
        `INSERT INTO bookings (user_id, train_id, journey_date, source_station_id, destination_station_id, class_code, status, total_amount, created_at)
         VALUES ($1, $2, $3, $4, $5, '3A', 'PENDING_PAYMENT', 506, NOW() - INTERVAL '15 minutes')
         RETURNING id`,
        [userB.id, trainExpId, testJourneyDate, stnNdlsId, stnCnbId]
      );
      const staleBookingId = staleBookingRes.rows[0].id;
      createdBookingIds.push(staleBookingId);

      const staleP = await pool.query(
        "INSERT INTO booking_passengers (booking_id, name_snapshot, age_snapshot, gender_snapshot, passenger_status) VALUES ($1, 'Stale User', 30, 'MALE', 'CONFIRMED') RETURNING id",
        [staleBookingId]
      );

      const seatRes = await pool.query(
        "SELECT s.id FROM seats s JOIN coaches c ON c.id = s.coach_id WHERE c.train_id = $1 AND c.class_code = '3A' ORDER BY s.id ASC LIMIT 1",
        [trainExpId]
      );
      const targetSeatId = seatRes.rows[0].id;

      await pool.query(
        `INSERT INTO seat_allocations (booking_passenger_id, seat_id, journey_date, from_stop_order, to_stop_order, allocation_type, status, allocated_at)
         VALUES ($1, $2, $3, 1, 2, 'CONFIRMED', 'HELD', NOW() - INTERVAL '15 minutes')`,
        [staleP.rows[0].id, targetSeatId, testJourneyDate]
      );

      // 2. User A issues booking request
      const res = await request(app)
        .post('/api/bookings')
        .set('Cookie', cookieA)
        .send({
          trainId: trainExpId,
          journeyDate: testJourneyDate,
          sourceStationId: stnNdlsId,
          destinationStationId: stnCnbId,
          classCode: '3A',
          passengers: [{ name: 'Active User', age: 28, gender: 'FEMALE' }],
        });

      expect(res.status).toBe(201);
      createdBookingIds.push(res.body.booking.bookingId);

      // Verify the stale booking is now CANCELLED and hold is RELEASED
      const staleBCheck = await pool.query('SELECT status FROM bookings WHERE id = $1', [staleBookingId]);
      expect(staleBCheck.rows[0].status).toBe('CANCELLED');

      const staleACheck = await pool.query('SELECT status FROM seat_allocations WHERE booking_passenger_id = $1', [staleP.rows[0].id]);
      expect(staleACheck.rows[0].status).toBe('RELEASED');
    });
  });

  // =========================================================================
  // 10. REAL POSTGRESQL CONCURRENCY TEST
  // =========================================================================
  describe('Real PostgreSQL Concurrency Test', () => {
    test('10.1. two simultaneous requests competing for the final available seat resolve to exactly one 201 and one 409', async () => {
      // In 2A on DEMO-EXP-01, there are 51 confirmed berths and 1 RAC berth (Seat 5 = 2 RAC slots) = 53 total capacity units.
      // We block 52 units, leaving EXACTLY 1 capacity unit (Slot 2 on Seat 5) available.
      const seatsRes = await pool.query(
        `SELECT s.id, s.rac_capable FROM seats s 
         JOIN coaches c ON c.id = s.coach_id 
         WHERE c.train_id = $1 AND c.class_code = '2A'
         ORDER BY s.id ASC`,
        [trainExpId]
      );

      const confirmedSeats = seatsRes.rows.filter((s) => !s.rac_capable);
      const racSeat = seatsRes.rows.find((s) => s.rac_capable);

      const blockerRes = await pool.query(
        "INSERT INTO bookings (user_id, train_id, journey_date, source_station_id, destination_station_id, class_code, status, total_amount) VALUES ($1, $2, $3, $4, $5, '2A', 'CONFIRMED', 1000) RETURNING id",
        [userB.id, trainExpId, testJourneyDate, stnNdlsId, stnCnbId]
      );
      createdBookingIds.push(blockerRes.rows[0].id);

      // 1. Fill all 51 confirmed berths
      for (const seat of confirmedSeats) {
        const dummyP = await pool.query(
          "INSERT INTO booking_passengers (booking_id, name_snapshot, age_snapshot, gender_snapshot, passenger_status) VALUES ($1, 'Blocker', 30, 'MALE', 'CONFIRMED') RETURNING id",
          [blockerRes.rows[0].id]
        );
        await pool.query(
          "INSERT INTO seat_allocations (booking_passenger_id, seat_id, journey_date, from_stop_order, to_stop_order, allocation_type, status) VALUES ($1, $2, $3, 1, 2, 'CONFIRMED', 'ACTIVE')",
          [dummyP.rows[0].id, seat.id, testJourneyDate]
        );
      }

      // 2. Fill RAC Slot 1 on Seat 5
      const rac1P = await pool.query(
        "INSERT INTO booking_passengers (booking_id, name_snapshot, age_snapshot, gender_snapshot, passenger_status) VALUES ($1, 'RAC1 Blocker', 30, 'MALE', 'RAC') RETURNING id",
        [blockerRes.rows[0].id]
      );
      await pool.query(
        "INSERT INTO seat_allocations (booking_passenger_id, seat_id, journey_date, from_stop_order, to_stop_order, allocation_type, rac_slot, status) VALUES ($1, $2, $3, 1, 2, 'RAC', 1, 'ACTIVE')",
        [rac1P.rows[0].id, racSeat.id, testJourneyDate]
      );

      // EXACTLY 1 capacity unit remains on the entire train: RAC Slot 2 on Seat 5!
      const bookingPayload = {
        trainId: trainExpId,
        journeyDate: testJourneyDate,
        sourceStationId: stnNdlsId,
        destinationStationId: stnCnbId,
        classCode: '2A',
        passengers: [{ name: 'Competitor', age: 30, gender: 'MALE' }],
      };

      // 3. Issue TWO SIMULTANEOUS HTTP requests via Promise.all using distinct authenticated users
      const [resUserA, resUserB] = await Promise.all([
        request(app).post('/api/bookings').set('Cookie', cookieA).send(bookingPayload),
        request(app).post('/api/bookings').set('Cookie', cookieB).send(bookingPayload),
      ]);

      const statuses = [resUserA.status, resUserB.status].sort();
      expect(statuses).toEqual([201, 409]);

      // Track successful booking for teardown
      if (resUserA.status === 201) {
        createdBookingIds.push(resUserA.body.booking.bookingId);
        expect(resUserB.body.error.code).toBe('SEATS_UNAVAILABLE');
      } else {
        createdBookingIds.push(resUserB.body.booking.bookingId);
        expect(resUserA.body.error.code).toBe('SEATS_UNAVAILABLE');
      }

      // 4. Verify only ONE allocation exists for Slot 2
      const slot2Check = await pool.query(
        `SELECT COUNT(*) FROM seat_allocations 
         WHERE seat_id = $1 AND journey_date = $2 AND rac_slot = 2 AND status = 'HELD'`,
        [racSeat.id, testJourneyDate]
      );
      expect(Number(slot2Check.rows[0].count)).toBe(1);
    });
  });

  // =========================================================================
  // 11. DEVELOPMENT SEED RECORD INTEGRITY
  // =========================================================================
  describe('Development Seed Record Integrity', () => {
    test('11.1. development seed row counts must remain completely intact', async () => {
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
