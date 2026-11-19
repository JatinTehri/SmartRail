/**
 * booking.service.test.js — Integration & Unit Tests for Booking Service
 *
 * Verifies:
 *   1. SmartRail Demo Fare Model calculation across all 7 supported classes
 *   2. Fare minimums, distance rounding, and input validations
 *   3. Passenger resolution for manual and saved profiles
 *   4. Authoritative database profile ownership and preference fallbacks/overrides
 *   5. Route segment, train active status, and class availability verification
 *   6. Confirmed and RAC seat allocation separation (no mixed berths, no duplicate slots)
 *   7. Transaction atomicity: commit on success, rollback on failure (409 on insufficient seats)
 *   8. Provisional status transparency in API response DTO
 */

'use strict';

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const pool = require('../src/config/db');
const AppError = require('../src/errors/AppError');
const bookingService = require('../src/modules/bookings/booking.service');
const {
  calculateTotalFare,
  resolvePassengers,
  createBooking,
  SMARTRAIL_DEMO_FARE_CONFIG,
} = bookingService;

describe('Booking Service (booking.service.js)', () => {
  const TEST_PREFIX = 'test.bservice.';
  const generateEmail = (suffix) => `${TEST_PREFIX}${Date.now()}.${suffix}@example.com`;

  let userA, userB;
  let savedProfileA;
  let trainExpId, trainSfId;
  let stnNdlsId, stnCnbId, stnPryjId, stnHwhId;
  const testJourneyDate = '2026-12-20';

  // Track created bookings for clean teardown
  const createdBookingIds = [];

  const cleanupTestData = async () => {
    if (createdBookingIds.length > 0) {
      await pool.query('DELETE FROM seat_allocations WHERE booking_passenger_id IN (SELECT id FROM booking_passengers WHERE booking_id = ANY($1))', [createdBookingIds]);
      await pool.query('DELETE FROM booking_passengers WHERE booking_id = ANY($1)', [createdBookingIds]);
      await pool.query('DELETE FROM bookings WHERE id = ANY($1)', [createdBookingIds]);
      createdBookingIds.length = 0;
    }

    // Delete any test allocations for test journey date
    await pool.query("DELETE FROM seat_allocations WHERE journey_date = $1", [testJourneyDate]);
    await pool.query("DELETE FROM passenger_profiles WHERE user_id IN (SELECT id FROM users WHERE email LIKE $1)", [`${TEST_PREFIX}%`]);
    await pool.query("DELETE FROM users WHERE email LIKE $1", [`${TEST_PREFIX}%`]);
  };

  beforeAll(async () => {
    await cleanupTestData();

    // 1. Create two test users (User A and User B)
    const userARes = await pool.query(
      "INSERT INTO users (name, email, password_hash, role) VALUES ('Booking User A', $1, 'hash_a', 'USER') RETURNING id, name, email",
      [generateEmail('usera')]
    );
    userA = userARes.rows[0];

    const userBRes = await pool.query(
      "INSERT INTO users (name, email, password_hash, role) VALUES ('Booking User B', $1, 'hash_b', 'USER') RETURNING id, name, email",
      [generateEmail('userb')]
    );
    userB = userBRes.rows[0];

    // 2. Create a saved passenger profile for User A
    const profRes = await pool.query(
      `INSERT INTO passenger_profiles (user_id, name, age, gender, berth_preference, window_preference)
       VALUES ($1, 'Saved Profile A', 62, 'FEMALE', 'LOWER', true)
       RETURNING id, name, age, gender, berth_preference, window_preference`,
      [userA.id]
    );
    savedProfileA = profRes.rows[0];

    // 3. Resolve seeded trains and stations
    const trainsRes = await pool.query("SELECT id, train_number FROM trains WHERE train_number IN ('DEMO-EXP-01', 'DEMO-SF-02')");
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
      await pool.query('DELETE FROM seat_allocations WHERE booking_passenger_id IN (SELECT id FROM booking_passengers WHERE booking_id = ANY($1))', [createdBookingIds]);
      await pool.query('DELETE FROM booking_passengers WHERE booking_id = ANY($1)', [createdBookingIds]);
      await pool.query('DELETE FROM bookings WHERE id = ANY($1)', [createdBookingIds]);
      createdBookingIds.length = 0;
    }
  });

  afterAll(async () => {
    await cleanupTestData();
  });

  // =========================================================================
  // 1. SMARTRAIL DEMO FARE MODEL
  // =========================================================================
  describe('SmartRail Demo Fare Model (calculateTotalFare)', () => {
    test('1.1. should calculate accurate fare for each of the 7 supported travel classes', () => {
      const distance = 440; // NDLS -> CNB (440 km)
      const passengers = 1;

      // 1A: 440 * 2.50 = 1100 (min 750)
      expect(calculateTotalFare(distance, '1A', passengers)).toBe(1100);
      // EC: 440 * 2.00 = 880 (min 600)
      expect(calculateTotalFare(distance, 'EC', passengers)).toBe(880);
      // 2A: 440 * 1.60 = 704 (min 500)
      expect(calculateTotalFare(distance, '2A', passengers)).toBe(704);
      // 3A: 440 * 1.15 = 506 (min 350)
      expect(calculateTotalFare(distance, '3A', passengers)).toBe(506);
      // CC: 440 * 0.90 = 396 (min 250)
      expect(calculateTotalFare(distance, 'CC', passengers)).toBe(396);
      // SL: 440 * 0.45 = 198 (min 150)
      expect(calculateTotalFare(distance, 'SL', passengers)).toBe(198);
      // 2S: 440 * 0.25 = 110 (min 60)
      expect(calculateTotalFare(distance, '2S', passengers)).toBe(110);
    });

    test('1.2. should enforce minimum fare thresholds on short-distance hops', () => {
      const shortDistance = 10; // 10 km
      const passengers = 1;

      expect(calculateTotalFare(shortDistance, '1A', passengers)).toBe(SMARTRAIL_DEMO_FARE_CONFIG['1A'].minFare);
      expect(calculateTotalFare(shortDistance, 'EC', passengers)).toBe(SMARTRAIL_DEMO_FARE_CONFIG['EC'].minFare);
      expect(calculateTotalFare(shortDistance, '2A', passengers)).toBe(SMARTRAIL_DEMO_FARE_CONFIG['2A'].minFare);
      expect(calculateTotalFare(shortDistance, '3A', passengers)).toBe(SMARTRAIL_DEMO_FARE_CONFIG['3A'].minFare);
      expect(calculateTotalFare(shortDistance, 'CC', passengers)).toBe(SMARTRAIL_DEMO_FARE_CONFIG['CC'].minFare);
      expect(calculateTotalFare(shortDistance, 'SL', passengers)).toBe(SMARTRAIL_DEMO_FARE_CONFIG['SL'].minFare);
      expect(calculateTotalFare(shortDistance, '2S', passengers)).toBe(SMARTRAIL_DEMO_FARE_CONFIG['2S'].minFare);
    });

    test('1.3. should round individual passenger fare to the nearest whole integer', () => {
      // 101 km in 3A: 101 * 1.15 = 116.15 -> rounds to 116. Min fare is 350 so min fare triggers.
      // Let's use distance 501 km: 501 * 1.15 = 576.15 -> rounds to 576
      expect(calculateTotalFare(501, '3A', 1)).toBe(576);

      // 503 km in 3A: 503 * 1.15 = 578.45 -> rounds to 578
      expect(calculateTotalFare(503, '3A', 1)).toBe(578);

      // 505 km in 3A: 505 * 1.15 = 580.75 -> rounds to 581
      expect(calculateTotalFare(505, '3A', 1)).toBe(581);
    });

    test('1.4. should multiply rounded per-passenger fare by passenger count', () => {
      const distance = 440; // 506 per passenger in 3A
      expect(calculateTotalFare(distance, '3A', 1)).toBe(506);
      expect(calculateTotalFare(distance, '3A', 2)).toBe(1012);
      expect(calculateTotalFare(distance, '3A', 4)).toBe(2024);
      expect(calculateTotalFare(distance, '3A', 6)).toBe(3036);
    });

    test('1.5. should reject zero or negative distance with 400 VALIDATION_ERROR', () => {
      expect(() => calculateTotalFare(0, '3A', 1)).toThrow(AppError);
      expect(() => calculateTotalFare(-50, '3A', 1)).toThrow(AppError);
      expect(() => calculateTotalFare(NaN, '3A', 1)).toThrow(AppError);
    });

    test('1.6. should reject unsupported class code with 400 VALIDATION_ERROR', () => {
      expect(() => calculateTotalFare(440, 'UNKNOWN', 1)).toThrow(AppError);
      expect(() => calculateTotalFare(440, '3E', 1)).toThrow(AppError);
    });
  });

  // =========================================================================
  // 2. PASSENGER RESOLUTION (resolvePassengers)
  // =========================================================================
  describe('Passenger Resolution (resolvePassengers)', () => {
    test('2.1. should resolve manual walk-in passenger and compute seniorCitizenFlag', async () => {
      const rawPassengers = [
        { name: 'Kavita', age: 25, gender: 'FEMALE', berthPreference: 'LOWER', windowPreference: true },
        { name: 'Ramesh', age: 65, gender: 'MALE', berthPreference: null, windowPreference: false },
      ];

      const resolved = await resolvePassengers(userA.id, rawPassengers);
      expect(resolved).toHaveLength(2);

      expect(resolved[0]).toEqual({
        passengerProfileId: null,
        name: 'Kavita',
        age: 25,
        gender: 'FEMALE',
        berthPreference: 'LOWER',
        windowPreference: true,
        seniorCitizenFlag: false,
      });

      expect(resolved[1]).toEqual({
        passengerProfileId: null,
        name: 'Ramesh',
        age: 65,
        gender: 'MALE',
        berthPreference: null,
        windowPreference: false,
        seniorCitizenFlag: true, // age >= 60
      });
    });

    test('2.2. should use database profile as authoritative identity for saved profile', async () => {
      const rawPassengers = [
        {
          passengerProfileId: savedProfileA.id,
          // Client attempts to pass spoofed name and age in body
          name: 'Spoofed Name',
          age: 18,
          gender: 'MALE',
        },
      ];

      const resolved = await resolvePassengers(userA.id, rawPassengers);
      expect(resolved[0].name).toBe('Saved Profile A');
      expect(resolved[0].age).toBe(62);
      expect(resolved[0].gender).toBe('FEMALE');
      expect(resolved[0].seniorCitizenFlag).toBe(true);
    });

    test('2.3. should inherit saved profile preferences when omitted in request', async () => {
      const rawPassengers = [
        {
          passengerProfileId: savedProfileA.id,
          // berthPreference and windowPreference omitted (undefined)
        },
      ];

      const resolved = await resolvePassengers(userA.id, rawPassengers);
      expect(resolved[0].berthPreference).toBe('LOWER'); // From DB profile
      expect(resolved[0].windowPreference).toBe(true); // From DB profile
    });

    test('2.4. should respect explicit preference overrides on saved profile', async () => {
      // Explicit 'NONE' overrides saved 'LOWER' to null
      const res1 = await resolvePassengers(userA.id, [
        { passengerProfileId: savedProfileA.id, berthPreference: 'NONE' },
      ]);
      expect(res1[0].berthPreference).toBeNull();

      // Explicit 'UPPER' overrides saved 'LOWER' to 'UPPER'
      const res2 = await resolvePassengers(userA.id, [
        { passengerProfileId: savedProfileA.id, berthPreference: 'UPPER' },
      ]);
      expect(res2[0].berthPreference).toBe('UPPER');

      // Explicit windowPreference: false overrides saved true to false
      const res3 = await resolvePassengers(userA.id, [
        { passengerProfileId: savedProfileA.id, windowPreference: false },
      ]);
      expect(res3[0].windowPreference).toBe(false);
    });

    test('2.5. should throw 404 PASSENGER_NOT_FOUND when passengerProfileId belongs to another user', async () => {
      // User B tries to use User A's saved profile
      await expect(
        resolvePassengers(userB.id, [{ passengerProfileId: savedProfileA.id }])
      ).rejects.toThrow(AppError);

      try {
        await resolvePassengers(userB.id, [{ passengerProfileId: savedProfileA.id }]);
      } catch (err) {
        expect(err.statusCode).toBe(404);
        expect(err.code).toBe('PASSENGER_NOT_FOUND');
      }
    });

    test('2.6. should throw 404 PASSENGER_NOT_FOUND when passengerProfileId does not exist', async () => {
      await expect(
        resolvePassengers(userA.id, [{ passengerProfileId: 999999 }])
      ).rejects.toThrow(AppError);
    });
  });

  // =========================================================================
  // 3. ROUTE, CLASS & DISTANCE VALIDATION (createBooking)
  // =========================================================================
  describe('Route and Class Verification in createBooking', () => {
    test('3.1. should reject invalid route segment or reverse direction with 400', async () => {
      await expect(
        createBooking(userA.id, {
          trainId: trainExpId,
          journeyDate: testJourneyDate,
          sourceStationId: stnCnbId,
          destinationStationId: stnNdlsId, // Reverse direction!
          classCode: '3A',
          passengers: [{ name: 'Test', age: 30, gender: 'MALE' }],
        })
      ).rejects.toThrow(AppError);
    });

    test('3.2. should reject non-existent train with 404', async () => {
      await expect(
        createBooking(userA.id, {
          trainId: 999999,
          journeyDate: testJourneyDate,
          sourceStationId: stnNdlsId,
          destinationStationId: stnCnbId,
          classCode: '3A',
          passengers: [{ name: 'Test', age: 30, gender: 'MALE' }],
        })
      ).rejects.toThrow(AppError);
    });

    test('3.3. should reject class not operated by the train with 400 VALIDATION_ERROR', async () => {
      // DEMO-EXP-01 only has 2A and 3A; does NOT carry SL
      await expect(
        createBooking(userA.id, {
          trainId: trainExpId,
          journeyDate: testJourneyDate,
          sourceStationId: stnNdlsId,
          destinationStationId: stnCnbId,
          classCode: 'SL',
          passengers: [{ name: 'Test', age: 30, gender: 'MALE' }],
        })
      ).rejects.toThrow(AppError);
    });
  });

  // =========================================================================
  // 4. TRANSACTIONAL ALLOCATION & SEAT HOLD (createBooking)
  // =========================================================================
  describe('Transactional Seat Hold & Segregated Pools (createBooking)', () => {
    test('4.1. should create booking with manual passenger, holding a confirmed berth', async () => {
      const result = await createBooking(userA.id, {
        trainId: trainExpId,
        journeyDate: testJourneyDate,
        sourceStationId: stnNdlsId,
        destinationStationId: stnCnbId,
        classCode: '3A',
        passengers: [
          { name: 'Aarav Patel', age: 29, gender: 'MALE', berthPreference: 'LOWER', windowPreference: true },
        ],
      });

      expect(result.message).toBe('Booking created and seats temporarily held');
      expect(result.booking).toBeDefined();
      createdBookingIds.push(result.booking.bookingId);

      // Verify provisional booking status
      expect(result.booking.status).toBe('PENDING_PAYMENT');
      expect(result.booking.pnr).toBeNull();
      expect(result.booking.paymentRequired).toBe(true);
      expect(result.booking.trainNumber).toBe('DEMO-EXP-01');
      expect(result.booking.source).toBe('New Delhi');
      expect(result.booking.destination).toBe('Kanpur Central');
      expect(result.booking.totalAmount).toBe(506); // 440 km * 1.15

      // Verify passenger allocation
      expect(result.booking.passengers).toHaveLength(1);
      const p = result.booking.passengers[0];
      expect(p.name).toBe('Aarav Patel');
      expect(p.allocationType).toBe('CONFIRMED');
      expect(p.allocationStatus).toBe('HELD');
      expect(p.coach).toBe('B1');
      expect(p.seatNumber).toBeDefined();
      expect(p.racSlot).toBeNull();

      // Verify DB record status
      const bRes = await pool.query('SELECT status, pnr, total_amount FROM bookings WHERE id = $1', [result.booking.bookingId]);
      expect(bRes.rows[0].status).toBe('PENDING_PAYMENT');
      expect(bRes.rows[0].pnr).toBeNull();
      expect(Number(bRes.rows[0].total_amount)).toBe(506);

      const aRes = await pool.query(
        `SELECT sa.status, sa.allocation_type, sa.rac_slot 
         FROM seat_allocations sa 
         JOIN booking_passengers bp ON bp.id = sa.booking_passenger_id
         WHERE bp.booking_id = $1`,
        [result.booking.bookingId]
      );
      expect(aRes.rows[0].status).toBe('HELD');
      expect(aRes.rows[0].allocation_type).toBe('CONFIRMED');
      expect(aRes.rows[0].rac_slot).toBeNull();
    });

    test('4.2. should create booking with saved profile and freeze snapshot details', async () => {
      const result = await createBooking(userA.id, {
        trainId: trainExpId,
        journeyDate: testJourneyDate,
        sourceStationId: stnNdlsId,
        destinationStationId: stnCnbId,
        classCode: '3A',
        passengers: [{ passengerProfileId: savedProfileA.id }],
      });

      createdBookingIds.push(result.booking.bookingId);
      expect(result.booking.passengers[0].name).toBe('Saved Profile A');

      // Verify DB snapshot
      const bpRes = await pool.query(
        'SELECT name_snapshot, age_snapshot, gender_snapshot, senior_citizen_flag, passenger_status FROM booking_passengers WHERE booking_id = $1',
        [result.booking.bookingId]
      );
      expect(bpRes.rows[0].name_snapshot).toBe('Saved Profile A');
      expect(bpRes.rows[0].age_snapshot).toBe(62);
      expect(bpRes.rows[0].gender_snapshot).toBe('FEMALE');
      expect(bpRes.rows[0].senior_citizen_flag).toBe(true);
      expect(bpRes.rows[0].passenger_status).toBe('CONFIRMED');
    });

    test('4.3. should allocate distinct berths from confirmed pool without touching RAC berths', async () => {
      const result = await createBooking(userA.id, {
        trainId: trainExpId,
        journeyDate: testJourneyDate,
        sourceStationId: stnNdlsId,
        destinationStationId: stnCnbId,
        classCode: '3A',
        passengers: [
          { name: 'Passenger One', age: 30, gender: 'MALE' },
          { name: 'Passenger Two', age: 32, gender: 'FEMALE' },
        ],
      });

      createdBookingIds.push(result.booking.bookingId);
      const p1 = result.booking.passengers[0];
      const p2 = result.booking.passengers[1];

      expect(p1.allocationType).toBe('CONFIRMED');
      expect(p2.allocationType).toBe('CONFIRMED');
      expect(p1.seatNumber).not.toBe(p2.seatNumber);

      // Verify neither seat is an RAC-capable berth (Seats 7 and 15 in B1)
      expect(['7', '15'].includes(p1.seatNumber)).toBe(false);
      expect(['7', '15'].includes(p2.seatNumber)).toBe(false);
    });

    test('4.4. should allocate RAC slot 1 and slot 2 when confirmed seats are exhausted', async () => {
      // Coach A1 on DEMO-EXP-01 (class 2A) has 52 seats total:
      // Exactly 51 confirmed berths (rac_capable = false) and 1 RAC berth (Seat 5, rac_capable = true).
      // We simulate all 51 confirmed berths as occupied by inserting active allocations:
      const seatsRes = await pool.query(
        `SELECT s.id, s.seat_number, s.rac_capable 
         FROM seats s 
         JOIN coaches c ON c.id = s.coach_id 
         WHERE c.train_id = $1 AND c.class_code = '2A'
         ORDER BY s.id ASC`,
        [trainExpId]
      );

      const confirmedSeats = seatsRes.rows.filter((s) => !s.rac_capable);
      const racSeats = seatsRes.rows.filter((s) => s.rac_capable);
      expect(confirmedSeats).toHaveLength(51);
      expect(racSeats).toHaveLength(1);
      expect(racSeats[0].seat_number).toBe('5');

      // Create a dummy booking for User B to occupy all 51 confirmed seats
      const dummyBookingRes = await pool.query(
        "INSERT INTO bookings (user_id, train_id, journey_date, source_station_id, destination_station_id, class_code, status, total_amount) VALUES ($1, $2, $3, $4, $5, '2A', 'CONFIRMED', 1000) RETURNING id",
        [userB.id, trainExpId, testJourneyDate, stnNdlsId, stnCnbId]
      );
      createdBookingIds.push(dummyBookingRes.rows[0].id);

      // Occupy all 51 confirmed seats
      for (const seat of confirmedSeats) {
        const dummyPassenger = await pool.query(
          "INSERT INTO booking_passengers (booking_id, name_snapshot, age_snapshot, gender_snapshot, passenger_status) VALUES ($1, 'Blocker', 30, 'MALE', 'CONFIRMED') RETURNING id",
          [dummyBookingRes.rows[0].id]
        );
        await pool.query(
          "INSERT INTO seat_allocations (booking_passenger_id, seat_id, journey_date, from_stop_order, to_stop_order, allocation_type, status) VALUES ($1, $2, $3, 1, 2, 'CONFIRMED', 'ACTIVE')",
          [dummyPassenger.rows[0].id, seat.id, testJourneyDate]
        );
      }

      // Now create a booking for 2 passengers: with 51 confirmed berths full, they should get RAC Slot 1 and Slot 2 on Seat 5!
      const racBooking = await createBooking(userA.id, {
        trainId: trainExpId,
        journeyDate: testJourneyDate,
        sourceStationId: stnNdlsId,
        destinationStationId: stnCnbId,
        classCode: '2A',
        passengers: [
          { name: 'RAC Passenger A', age: 24, gender: 'FEMALE' },
          { name: 'RAC Passenger B', age: 26, gender: 'MALE' },
        ],
      });

      createdBookingIds.push(racBooking.booking.bookingId);
      expect(racBooking.booking.passengers).toHaveLength(2);

      const rp1 = racBooking.booking.passengers[0];
      const rp2 = racBooking.booking.passengers[1];

      expect(rp1.allocationType).toBe('RAC');
      expect(rp1.seatNumber).toBe('5');
      expect(rp1.racSlot).toBe(1);

      expect(rp2.allocationType).toBe('RAC');
      expect(rp2.seatNumber).toBe('5');
      expect(rp2.racSlot).toBe(2);

      // Verify no duplicate slots were assigned
      expect(rp1.racSlot).not.toBe(rp2.racSlot);
    });

    test('4.5. should throw 409 SEATS_UNAVAILABLE and rollback when capacity is insufficient', async () => {
      // In 2A on DEMO-EXP-01, capacity is 51 confirmed + 2 RAC = 53 total.
      // If a user requests 6 passengers when 0 seats are free, it should fail with 409.
      // Let's create a booking requesting 6 passengers when only 0 seats are free:
      const seatsRes = await pool.query(
        `SELECT s.id FROM seats s 
         JOIN coaches c ON c.id = s.coach_id 
         WHERE c.train_id = $1 AND c.class_code = '2A'`,
        [trainExpId]
      );

      // Block all seats in 2A
      const blockerRes = await pool.query(
        "INSERT INTO bookings (user_id, train_id, journey_date, source_station_id, destination_station_id, class_code, status, total_amount) VALUES ($1, $2, $3, $4, $5, '2A', 'CONFIRMED', 1000) RETURNING id",
        [userB.id, trainExpId, testJourneyDate, stnNdlsId, stnCnbId]
      );
      createdBookingIds.push(blockerRes.rows[0].id);

      for (const seat of seatsRes.rows) {
        const dummyPassenger = await pool.query(
          "INSERT INTO booking_passengers (booking_id, name_snapshot, age_snapshot, gender_snapshot, passenger_status) VALUES ($1, 'Blocker', 30, 'MALE', 'CONFIRMED') RETURNING id",
          [blockerRes.rows[0].id]
        );
        await pool.query(
          "INSERT INTO seat_allocations (booking_passenger_id, seat_id, journey_date, from_stop_order, to_stop_order, allocation_type, status) VALUES ($1, $2, $3, 1, 2, 'CONFIRMED', 'ACTIVE')",
          [dummyPassenger.rows[0].id, seat.id, testJourneyDate]
        );
      }

      // Record count of bookings prior to failing attempt
      const countBefore = await pool.query('SELECT COUNT(*) FROM bookings WHERE user_id = $1', [userA.id]);

      await expect(
        createBooking(userA.id, {
          trainId: trainExpId,
          journeyDate: testJourneyDate,
          sourceStationId: stnNdlsId,
          destinationStationId: stnCnbId,
          classCode: '2A',
          passengers: [{ name: 'Overbooked', age: 30, gender: 'MALE' }],
        })
      ).rejects.toThrow(AppError);

      try {
        await createBooking(userA.id, {
          trainId: trainExpId,
          journeyDate: testJourneyDate,
          sourceStationId: stnNdlsId,
          destinationStationId: stnCnbId,
          classCode: '2A',
          passengers: [{ name: 'Overbooked', age: 30, gender: 'MALE' }],
        });
      } catch (err) {
        expect(err.statusCode).toBe(409);
        expect(err.code).toBe('SEATS_UNAVAILABLE');
      }

      // Verify transaction rolled back cleanly with zero partial records
      const countAfter = await pool.query('SELECT COUNT(*) FROM bookings WHERE user_id = $1', [userA.id]);
      expect(countAfter.rows[0].count).toBe(countBefore.rows[0].count);
    });

    test('4.6. should release expired holds older than 10 minutes before allocating seats', async () => {
      // 1. Create a stale PENDING_PAYMENT booking with HELD allocation created 15 minutes ago
      const staleBookingRes = await pool.query(
        `INSERT INTO bookings (user_id, train_id, journey_date, source_station_id, destination_station_id, class_code, status, total_amount, created_at)
         VALUES ($1, $2, $3, $4, $5, '3A', 'PENDING_PAYMENT', 506, NOW() - INTERVAL '15 minutes')
         RETURNING id`,
        [userB.id, trainExpId, testJourneyDate, stnNdlsId, stnCnbId]
      );
      const staleBookingId = staleBookingRes.rows[0].id;
      createdBookingIds.push(staleBookingId);

      const stalePassRes = await pool.query(
        "INSERT INTO booking_passengers (booking_id, name_snapshot, age_snapshot, gender_snapshot, passenger_status) VALUES ($1, 'Stale Passenger', 30, 'MALE', 'CONFIRMED') RETURNING id",
        [staleBookingId]
      );
      const stalePassId = stalePassRes.rows[0].id;

      // Select first seat in 3A
      const seatRes = await pool.query(
        "SELECT s.id FROM seats s JOIN coaches c ON c.id = s.coach_id WHERE c.train_id = $1 AND c.class_code = '3A' ORDER BY s.id ASC LIMIT 1",
        [trainExpId]
      );
      const targetSeatId = seatRes.rows[0].id;

      await pool.query(
        `INSERT INTO seat_allocations (booking_passenger_id, seat_id, journey_date, from_stop_order, to_stop_order, allocation_type, status, allocated_at)
         VALUES ($1, $2, $3, 1, 2, 'CONFIRMED', 'HELD', NOW() - INTERVAL '15 minutes')`,
        [stalePassId, targetSeatId, testJourneyDate]
      );

      // 2. Call createBooking for User A
      const result = await createBooking(userA.id, {
        trainId: trainExpId,
        journeyDate: testJourneyDate,
        sourceStationId: stnNdlsId,
        destinationStationId: stnCnbId,
        classCode: '3A',
        passengers: [{ name: 'Fresh Passenger', age: 28, gender: 'FEMALE' }],
      });
      createdBookingIds.push(result.booking.bookingId);

      // Verify stale booking transitioned to CANCELLED and allocation to RELEASED
      const staleCheck = await pool.query('SELECT status FROM bookings WHERE id = $1', [staleBookingId]);
      expect(staleCheck.rows[0].status).toBe('CANCELLED');

      const staleAllocCheck = await pool.query('SELECT status FROM seat_allocations WHERE booking_passenger_id = $1', [stalePassId]);
      expect(staleAllocCheck.rows[0].status).toBe('RELEASED');
    });
  });
});
