/**
 * train.availability.test.js — Integration Tests for Seat Availability API
 *
 * GET /api/trains/:trainId/availability?fromStationId=...&toStationId=...&journeyDate=...&classCode=...
 *
 * Covers all 24 required scenarios:
 *   Basic availability:
 *     1. Freshly seeded train with all seats available
 *     2. Correct coach-wise and class-wise summaries
 *     3. Correct seat and berth information
 *   Confirmed allocations:
 *     4. Active confirmed allocation blocks an overlapping journey
 *     5. Non-overlapping journey can reuse the same physical seat
 *     6. HELD allocation blocks availability
 *     7. CANCELLED and RELEASED allocations do not block availability
 *   RAC allocations:
 *     8. RAC slot 1 occupied and slot 2 available
 *     9. RAC slot 2 occupied and slot 1 available
 *     10. Both RAC slots occupied
 *     11. Confirmed allocation blocks both RAC slots
 *     12. RAC allocation prevents confirmed use of the same berth
 *   Journey validation:
 *     13. Invalid train ID (non-numeric, negative, zero, decimal)
 *     14. Invalid source or destination station ID
 *     15. Source and destination stations are identical
 *     16. Reverse-direction journey
 *     17. Stations that do not belong to the selected train
 *     18. Invalid journey date (bad format, non-existent date)
 *     19. Past journey date using Asia/Kolkata
 *     20. Optional class filtering
 *   API and data safety:
 *     21. Correct HTTP status codes and response structure
 *     22. No passenger names, booking IDs, PNRs, or payment information exposed
 *     23. Existing train search and train details endpoints continue working
 *     24. Database seed records remain intact
 */

'use strict';

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const request = require('supertest');
const app = require('../src/app');
const pool = require('../src/config/db');

describe('GET /api/trains/:trainId/availability', () => {
  let expTrainId;
  let sfTrainId;
  let stations = {};
  let testUserId;
  let testBookingId;
  let testPassengerId;
  let normalSeatId;
  let racSeatId;

  // Dynamic future date (14 days ahead)
  const futureDate = new Date();
  futureDate.setDate(futureDate.getDate() + 14);
  const testJourneyDate = futureDate.toISOString().split('T')[0];

  const createdAllocationIds = [];
  const createdBookingIds = [];

  beforeAll(async () => {
    // 1. Fetch trains
    const trainRes = await pool.query(
      "SELECT id, train_number FROM trains WHERE train_number IN ('DEMO-EXP-01', 'DEMO-SF-02')"
    );
    for (const r of trainRes.rows) {
      if (r.train_number === 'DEMO-EXP-01') expTrainId = Number(r.id);
      if (r.train_number === 'DEMO-SF-02') sfTrainId = Number(r.id);
    }

    // 2. Fetch stations
    const stationRes = await pool.query(
      "SELECT id, code FROM stations WHERE code IN ('NDLS', 'CNB', 'PRYJ', 'DDU', 'HWH')"
    );
    for (const r of stationRes.rows) {
      stations[r.code] = Number(r.id);
    }

    // 3. Find sample seats from DEMO-EXP-01: one normal berth and one RAC-capable berth
    const seatRes = await pool.query(`
      SELECT s.id, s.rac_capable, s.berth_type, c.class_code
      FROM seats s
      JOIN coaches c ON s.coach_id = c.id
      WHERE c.train_id = $1
      ORDER BY s.id ASC
    `, [expTrainId]);

    for (const row of seatRes.rows) {
      if (!row.rac_capable && !normalSeatId) {
        normalSeatId = Number(row.id);
      }
      if (row.rac_capable && !racSeatId) {
        racSeatId = Number(row.id);
      }
    }

    // 4. Create single test user, booking, and passenger fixture for allocation tests
    const userRes = await pool.query(`
      INSERT INTO users (name, email, phone, password_hash, role)
      VALUES ('Fixture User', 'availability_fixture_user@example.com', '9999999999', 'dummy_hash', 'USER')
      RETURNING id
    `);
    testUserId = userRes.rows[0].id;

    const bookingRes = await pool.query(`
      INSERT INTO bookings (
        user_id, train_id, journey_date, source_station_id, destination_station_id, class_code, status, total_amount
      )
      VALUES ($1, $2, $3, $4, $5, '2A', 'CONFIRMED', 1500.00)
      RETURNING id
    `, [testUserId, expTrainId, testJourneyDate, stations.NDLS, stations.HWH]);
    testBookingId = bookingRes.rows[0].id;

    const passRes = await pool.query(`
      INSERT INTO booking_passengers (
        booking_id, name_snapshot, age_snapshot, gender_snapshot, passenger_status
      )
      VALUES ($1, 'Fixture Passenger', 32, 'FEMALE', 'CONFIRMED')
      RETURNING id
    `, [testBookingId]);
    testPassengerId = passRes.rows[0].id;
  });

  afterEach(async () => {
    // Delete any test allocations created during the test
    if (createdAllocationIds.length > 0) {
      await pool.query('DELETE FROM seat_allocations WHERE id = ANY($1)', [createdAllocationIds]);
      createdAllocationIds.length = 0;
    }
    if (createdBookingIds.length > 0) {
      await pool.query(
        'DELETE FROM seat_allocations WHERE booking_passenger_id IN (SELECT id FROM booking_passengers WHERE booking_id = ANY($1))',
        [createdBookingIds]
      );
      await pool.query('DELETE FROM booking_passengers WHERE booking_id = ANY($1)', [createdBookingIds]);
      await pool.query('DELETE FROM bookings WHERE id = ANY($1)', [createdBookingIds]);
      createdBookingIds.length = 0;
    }
  });

  afterAll(async () => {
    // Clean up test fixture records in reverse dependency order
    if (createdBookingIds.length > 0) {
      await pool.query(
        'DELETE FROM seat_allocations WHERE booking_passenger_id IN (SELECT id FROM booking_passengers WHERE booking_id = ANY($1))',
        [createdBookingIds]
      );
      await pool.query('DELETE FROM booking_passengers WHERE booking_id = ANY($1)', [createdBookingIds]);
      await pool.query('DELETE FROM bookings WHERE id = ANY($1)', [createdBookingIds]);
    }
    if (createdAllocationIds.length > 0) {
      await pool.query('DELETE FROM seat_allocations WHERE id = ANY($1)', [createdAllocationIds]);
    }
    if (testPassengerId) {
      await pool.query('DELETE FROM booking_passengers WHERE id = $1', [testPassengerId]);
    }
    if (testBookingId) {
      await pool.query('DELETE FROM bookings WHERE id = $1', [testBookingId]);
    }
    if (testUserId) {
      await pool.query('DELETE FROM users WHERE id = $1', [testUserId]);
    }
    await pool.end();
  });

  // Helper to insert test allocations
  async function addAllocation({
    seatId,
    fromStopOrder,
    toStopOrder,
    allocationType = 'CONFIRMED',
    racSlot = null,
    status = 'ACTIVE',
    journeyDate = testJourneyDate,
  }) {
    const res = await pool.query(`
      INSERT INTO seat_allocations (
        booking_passenger_id, seat_id, journey_date, from_stop_order, to_stop_order, allocation_type, rac_slot, status
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id
    `, [testPassengerId, seatId, journeyDate, fromStopOrder, toStopOrder, allocationType, racSlot, status]);

    createdAllocationIds.push(res.rows[0].id);
    return res.rows[0].id;
  }

  // =========================================================================
  // Basic Availability
  // =========================================================================
  test('1. Freshly seeded train with all seats available', async () => {
    const res = await request(app)
      .get(`/api/trains/${expTrainId}/availability`)
      .query({
        fromStationId: stations.NDLS,
        toStationId: stations.CNB,
        journeyDate: testJourneyDate,
      });

    expect(res.status).toBe(200);
    expect(res.body.availability.confirmed).toBe(124);
    expect(res.body.availability.rac).toBe(6);
  });

  test('2. Correct coach-wise and class-wise summaries', async () => {
    const res = await request(app)
      .get(`/api/trains/${expTrainId}/availability`)
      .query({
        fromStationId: stations.NDLS,
        toStationId: stations.CNB,
        journeyDate: testJourneyDate,
      });

    expect(res.status).toBe(200);

    // Classes summary
    expect(res.body.classes).toHaveProperty('2A');
    expect(res.body.classes).toHaveProperty('3A');
    expect(res.body.classes['2A']).toEqual({ confirmed: 52, rac: 2 });
    expect(res.body.classes['3A']).toEqual({ confirmed: 72, rac: 4 });

    // Coach breakdown
    expect(res.body.coaches.length).toBe(2);
    const coach2A = res.body.coaches.find((c) => c.classCode === '2A');
    const coach3A = res.body.coaches.find((c) => c.classCode === '3A');

    expect(coach2A.availableConfirmed).toBe(52);
    expect(coach2A.availableRac).toBe(2);
    expect(coach3A.availableConfirmed).toBe(72);
    expect(coach3A.availableRac).toBe(4);
  });

  test('3. Correct seat and berth information', async () => {
    const res = await request(app)
      .get(`/api/trains/${expTrainId}/availability`)
      .query({
        fromStationId: stations.NDLS,
        toStationId: stations.CNB,
        journeyDate: testJourneyDate,
      });

    expect(res.status).toBe(200);
    const coach = res.body.coaches[0];
    const firstSeat = coach.seats[0];

    expect(firstSeat).toHaveProperty('seatId');
    expect(firstSeat).toHaveProperty('seatNumber');
    expect(firstSeat).toHaveProperty('berthType');
    expect(firstSeat).toHaveProperty('position');
    expect(firstSeat).toHaveProperty('isWindow');
    expect(firstSeat).toHaveProperty('racCapable');
    expect(firstSeat).toHaveProperty('isAvailable');
    expect(firstSeat.isAvailable).toBe(true);

    const racBerth = coach.seats.find((s) => s.racCapable === true);
    expect(racBerth).toBeDefined();
    expect(racBerth.racSlotsAvailable).toEqual([1, 2]);
  });

  // =========================================================================
  // Confirmed Allocations
  // =========================================================================
  test('4. Active confirmed allocation blocks an overlapping journey', async () => {
    // Book normalSeatId on NDLS -> PRYJ (stop 1 to stop 3)
    await addAllocation({
      seatId: normalSeatId,
      fromStopOrder: 1,
      toStopOrder: 3,
      allocationType: 'CONFIRMED',
      status: 'ACTIVE',
    });

    // Check availability for NDLS -> CNB (stop 1 to stop 2) -> Overlaps!
    const res = await request(app)
      .get(`/api/trains/${expTrainId}/availability`)
      .query({
        fromStationId: stations.NDLS,
        toStationId: stations.CNB,
        journeyDate: testJourneyDate,
      });

    expect(res.status).toBe(200);
    expect(res.body.availability.confirmed).toBe(123); // Decreased by 1

    // Find the specific seat in the response
    let foundSeat = null;
    for (const coach of res.body.coaches) {
      const match = coach.seats.find((s) => s.seatId === normalSeatId);
      if (match) foundSeat = match;
    }
    expect(foundSeat).toBeDefined();
    expect(foundSeat.isAvailable).toBe(false);
  });

  test('5. Non-overlapping journey can reuse the same physical seat', async () => {
    // Book normalSeatId on NDLS -> CNB (stop 1 to stop 2)
    await addAllocation({
      seatId: normalSeatId,
      fromStopOrder: 1,
      toStopOrder: 2,
      allocationType: 'CONFIRMED',
      status: 'ACTIVE',
    });

    // Check availability for PRYJ -> HWH (stop 3 to stop 5) -> No overlap!
    const res = await request(app)
      .get(`/api/trains/${expTrainId}/availability`)
      .query({
        fromStationId: stations.PRYJ,
        toStationId: stations.HWH,
        journeyDate: testJourneyDate,
      });

    expect(res.status).toBe(200);
    expect(res.body.availability.confirmed).toBe(124); // Full capacity available

    let foundSeat = null;
    for (const coach of res.body.coaches) {
      const match = coach.seats.find((s) => s.seatId === normalSeatId);
      if (match) foundSeat = match;
    }
    expect(foundSeat).toBeDefined();
    expect(foundSeat.isAvailable).toBe(true);
  });

  test('6. HELD allocation blocks availability', async () => {
    // Place a hold on normalSeatId for NDLS -> CNB (stop 1 to stop 2)
    await addAllocation({
      seatId: normalSeatId,
      fromStopOrder: 1,
      toStopOrder: 2,
      allocationType: 'CONFIRMED',
      status: 'HELD',
    });

    const res = await request(app)
      .get(`/api/trains/${expTrainId}/availability`)
      .query({
        fromStationId: stations.NDLS,
        toStationId: stations.CNB,
        journeyDate: testJourneyDate,
      });

    expect(res.status).toBe(200);
    expect(res.body.availability.confirmed).toBe(123);
  });

  test('7. CANCELLED and RELEASED allocations do not block availability', async () => {
    // Add one CANCELLED and one RELEASED allocation on normalSeatId
    await addAllocation({
      seatId: normalSeatId,
      fromStopOrder: 1,
      toStopOrder: 2,
      allocationType: 'CONFIRMED',
      status: 'CANCELLED',
    });
    await addAllocation({
      seatId: normalSeatId,
      fromStopOrder: 1,
      toStopOrder: 2,
      allocationType: 'CONFIRMED',
      status: 'RELEASED',
    });

    const res = await request(app)
      .get(`/api/trains/${expTrainId}/availability`)
      .query({
        fromStationId: stations.NDLS,
        toStationId: stations.CNB,
        journeyDate: testJourneyDate,
      });

    expect(res.status).toBe(200);
    expect(res.body.availability.confirmed).toBe(124); // Untouched
  });

  // =========================================================================
  // RAC Allocations
  // =========================================================================
  test('8. RAC slot 1 occupied and slot 2 available', async () => {
    await addAllocation({
      seatId: racSeatId,
      fromStopOrder: 1,
      toStopOrder: 2,
      allocationType: 'RAC',
      racSlot: 1,
      status: 'ACTIVE',
    });

    const res = await request(app)
      .get(`/api/trains/${expTrainId}/availability`)
      .query({
        fromStationId: stations.NDLS,
        toStationId: stations.CNB,
        journeyDate: testJourneyDate,
      });

    expect(res.status).toBe(200);
    expect(res.body.availability.rac).toBe(5); // 6 - 1 = 5

    let foundSeat = null;
    for (const coach of res.body.coaches) {
      const match = coach.seats.find((s) => s.seatId === racSeatId);
      if (match) foundSeat = match;
    }
    expect(foundSeat).toBeDefined();
    expect(foundSeat.racSlotsAvailable).toEqual([2]);
  });

  test('9. RAC slot 2 occupied and slot 1 available', async () => {
    await addAllocation({
      seatId: racSeatId,
      fromStopOrder: 1,
      toStopOrder: 2,
      allocationType: 'RAC',
      racSlot: 2,
      status: 'ACTIVE',
    });

    const res = await request(app)
      .get(`/api/trains/${expTrainId}/availability`)
      .query({
        fromStationId: stations.NDLS,
        toStationId: stations.CNB,
        journeyDate: testJourneyDate,
      });

    expect(res.status).toBe(200);
    expect(res.body.availability.rac).toBe(5);

    let foundSeat = null;
    for (const coach of res.body.coaches) {
      const match = coach.seats.find((s) => s.seatId === racSeatId);
      if (match) foundSeat = match;
    }
    expect(foundSeat).toBeDefined();
    expect(foundSeat.racSlotsAvailable).toEqual([1]);
  });

  test('10. Both RAC slots occupied', async () => {
    await addAllocation({
      seatId: racSeatId,
      fromStopOrder: 1,
      toStopOrder: 2,
      allocationType: 'RAC',
      racSlot: 1,
      status: 'ACTIVE',
    });
    await addAllocation({
      seatId: racSeatId,
      fromStopOrder: 1,
      toStopOrder: 2,
      allocationType: 'RAC',
      racSlot: 2,
      status: 'ACTIVE',
    });

    const res = await request(app)
      .get(`/api/trains/${expTrainId}/availability`)
      .query({
        fromStationId: stations.NDLS,
        toStationId: stations.CNB,
        journeyDate: testJourneyDate,
      });

    expect(res.status).toBe(200);
    expect(res.body.availability.rac).toBe(4); // 6 - 2 = 4

    let foundSeat = null;
    for (const coach of res.body.coaches) {
      const match = coach.seats.find((s) => s.seatId === racSeatId);
      if (match) foundSeat = match;
    }
    expect(foundSeat).toBeDefined();
    expect(foundSeat.racSlotsAvailable).toEqual([]);
    expect(foundSeat.isAvailable).toBe(false);
  });

  test('11. Confirmed allocation blocks both RAC slots', async () => {
    // If a whole berth is booked confirmed, it offers 0 RAC slots
    await addAllocation({
      seatId: racSeatId,
      fromStopOrder: 1,
      toStopOrder: 2,
      allocationType: 'CONFIRMED',
      status: 'ACTIVE',
    });

    const res = await request(app)
      .get(`/api/trains/${expTrainId}/availability`)
      .query({
        fromStationId: stations.NDLS,
        toStationId: stations.CNB,
        journeyDate: testJourneyDate,
      });

    expect(res.status).toBe(200);
    expect(res.body.availability.confirmed).toBe(123);
    // Booking an RAC-capable berth as confirmed blocks both of its RAC slots (6 - 2 = 4)
    expect(res.body.availability.rac).toBe(4);

    let foundSeat = null;
    for (const coach of res.body.coaches) {
      const match = coach.seats.find((s) => s.seatId === racSeatId);
      if (match) foundSeat = match;
    }
    expect(foundSeat).toBeDefined();
    expect(foundSeat.racSlotsAvailable).toEqual([]);
    expect(foundSeat.isAvailable).toBe(false);
  });

  test('12. RAC allocation prevents confirmed use of the same berth', async () => {
    // If even one RAC slot is occupied, the berth cannot be booked confirmed
    await addAllocation({
      seatId: racSeatId,
      fromStopOrder: 1,
      toStopOrder: 2,
      allocationType: 'RAC',
      racSlot: 1,
      status: 'ACTIVE',
    });

    const res = await request(app)
      .get(`/api/trains/${expTrainId}/availability`)
      .query({
        fromStationId: stations.NDLS,
        toStationId: stations.CNB,
        journeyDate: testJourneyDate,
      });

    expect(res.status).toBe(200);
    // Confirmed count must decrease from 124 to 123
    expect(res.body.availability.confirmed).toBe(123);

    let foundSeat = null;
    for (const coach of res.body.coaches) {
      const match = coach.seats.find((s) => s.seatId === racSeatId);
      if (match) foundSeat = match;
    }
    expect(foundSeat).toBeDefined();
    expect(foundSeat.isAvailable).toBe(false); // Not available for confirmed booking
  });

  // =========================================================================
  // Journey Validation
  // =========================================================================
  test('13. Invalid train ID returns HTTP 400', async () => {
    // Non-numeric
    const res1 = await request(app)
      .get('/api/trains/abc/availability')
      .query({ fromStationId: stations.NDLS, toStationId: stations.CNB, journeyDate: testJourneyDate });
    expect(res1.status).toBe(400);

    // Negative
    const res2 = await request(app)
      .get('/api/trains/-5/availability')
      .query({ fromStationId: stations.NDLS, toStationId: stations.CNB, journeyDate: testJourneyDate });
    expect(res2.status).toBe(400);

    // Zero
    const res3 = await request(app)
      .get('/api/trains/0/availability')
      .query({ fromStationId: stations.NDLS, toStationId: stations.CNB, journeyDate: testJourneyDate });
    expect(res3.status).toBe(400);

    // Decimal
    const res4 = await request(app)
      .get('/api/trains/1.5/availability')
      .query({ fromStationId: stations.NDLS, toStationId: stations.CNB, journeyDate: testJourneyDate });
    expect(res4.status).toBe(400);
  });

  test('14. Invalid source or destination station returns HTTP 400', async () => {
    // Non-numeric fromStationId
    const res1 = await request(app)
      .get(`/api/trains/${expTrainId}/availability`)
      .query({ fromStationId: 'xyz', toStationId: stations.CNB, journeyDate: testJourneyDate });
    expect(res1.status).toBe(400);
    expect(res1.body.error.code).toBe('VALIDATION_ERROR');

    // Negative toStationId
    const res2 = await request(app)
      .get(`/api/trains/${expTrainId}/availability`)
      .query({ fromStationId: stations.NDLS, toStationId: -1, journeyDate: testJourneyDate });
    expect(res2.status).toBe(400);
    expect(res2.body.error.code).toBe('VALIDATION_ERROR');

    // Missing fromStationId
    const res3 = await request(app)
      .get(`/api/trains/${expTrainId}/availability`)
      .query({ toStationId: stations.CNB, journeyDate: testJourneyDate });
    expect(res3.status).toBe(400);
  });

  test('15. Source and destination are identical returns HTTP 400', async () => {
    const res = await request(app)
      .get(`/api/trains/${expTrainId}/availability`)
      .query({
        fromStationId: stations.NDLS,
        toStationId: stations.NDLS,
        journeyDate: testJourneyDate,
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.message).toMatch(/cannot be identical/i);
  });

  test('16. Reverse-direction journey returns HTTP 400', async () => {
    // CNB (stop 2) -> NDLS (stop 1) is reverse for DEMO-EXP-01
    const res = await request(app)
      .get(`/api/trains/${expTrainId}/availability`)
      .query({
        fromStationId: stations.CNB,
        toStationId: stations.NDLS,
        journeyDate: testJourneyDate,
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.message).toMatch(/invalid route segment or travel direction/i);
  });

  test('17. Stations that do not belong to the selected train returns HTTP 400', async () => {
    // DEMO-SF-02 only runs NDLS -> CNB -> PRYJ -> DDU (does NOT stop at HWH)
    const res = await request(app)
      .get(`/api/trains/${sfTrainId}/availability`)
      .query({
        fromStationId: stations.NDLS,
        toStationId: stations.HWH,
        journeyDate: testJourneyDate,
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  test('18. Invalid journey date returns HTTP 400', async () => {
    // Bad format
    const res1 = await request(app)
      .get(`/api/trains/${expTrainId}/availability`)
      .query({ fromStationId: stations.NDLS, toStationId: stations.CNB, journeyDate: '15-11-2026' });
    expect(res1.status).toBe(400);

    // Impossible calendar date (Feb 30)
    const res2 = await request(app)
      .get(`/api/trains/${expTrainId}/availability`)
      .query({ fromStationId: stations.NDLS, toStationId: stations.CNB, journeyDate: '2027-02-30' });
    expect(res2.status).toBe(400);

    // Missing journey date
    const res3 = await request(app)
      .get(`/api/trains/${expTrainId}/availability`)
      .query({ fromStationId: stations.NDLS, toStationId: stations.CNB });
    expect(res3.status).toBe(400);
  });

  test('19. Past journey date using Asia/Kolkata returns HTTP 400', async () => {
    const res = await request(app)
      .get(`/api/trains/${expTrainId}/availability`)
      .query({
        fromStationId: stations.NDLS,
        toStationId: stations.CNB,
        journeyDate: '2020-01-01',
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.message).toMatch(/cannot be in the past/i);
  });

  test('20. Optional class filtering', async () => {
    // Filter by classCode=2A
    const res2A = await request(app)
      .get(`/api/trains/${expTrainId}/availability`)
      .query({
        fromStationId: stations.NDLS,
        toStationId: stations.CNB,
        journeyDate: testJourneyDate,
        classCode: '2A',
      });

    expect(res2A.status).toBe(200);
    expect(res2A.body.availability).toEqual({ confirmed: 52, rac: 2 });
    expect(Object.keys(res2A.body.classes)).toEqual(['2A']);
    expect(res2A.body.coaches.length).toBe(1);
    expect(res2A.body.coaches[0].classCode).toBe('2A');

    // Filter by classCode=3A
    const res3A = await request(app)
      .get(`/api/trains/${expTrainId}/availability`)
      .query({
        fromStationId: stations.NDLS,
        toStationId: stations.CNB,
        journeyDate: testJourneyDate,
        classCode: '3A',
      });

    expect(res3A.status).toBe(200);
    expect(res3A.body.availability).toEqual({ confirmed: 72, rac: 4 });
    expect(Object.keys(res3A.body.classes)).toEqual(['3A']);
    expect(res3A.body.coaches.length).toBe(1);
    expect(res3A.body.coaches[0].classCode).toBe('3A');
  });

  // =========================================================================
  // API and Data Safety
  // =========================================================================
  test('21. Correct HTTP status codes and response structure', async () => {
    const res = await request(app)
      .get(`/api/trains/${expTrainId}/availability`)
      .query({
        fromStationId: stations.NDLS,
        toStationId: stations.CNB,
        journeyDate: testJourneyDate,
      });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('trainId', expTrainId);
    expect(res.body).toHaveProperty('trainNumber', 'DEMO-EXP-01');
    expect(res.body).toHaveProperty('trainName', 'SmartRail Express');
    expect(res.body).toHaveProperty('journeyDate', testJourneyDate);
    expect(res.body).toHaveProperty('fromStation');
    expect(res.body.fromStation).toEqual({
      id: stations.NDLS,
      code: 'NDLS',
      name: 'New Delhi',
      stopOrder: 1,
    });
    expect(res.body).toHaveProperty('toStation');
    expect(res.body.toStation).toEqual({
      id: stations.CNB,
      code: 'CNB',
      name: 'Kanpur Central',
      stopOrder: 2,
    });
    expect(res.body).toHaveProperty('availability');
    expect(res.body).toHaveProperty('classes');
    expect(res.body).toHaveProperty('coaches');
  });

  test('22. No passenger names, booking IDs, PNRs, or payment information exposed', async () => {
    // Add active confirmed allocation to test output sanitization
    await addAllocation({
      seatId: normalSeatId,
      fromStopOrder: 1,
      toStopOrder: 2,
      allocationType: 'CONFIRMED',
      status: 'ACTIVE',
    });

    const res = await request(app)
      .get(`/api/trains/${expTrainId}/availability`)
      .query({
        fromStationId: stations.NDLS,
        toStationId: stations.CNB,
        journeyDate: testJourneyDate,
      });

    expect(res.status).toBe(200);
    const jsonStr = JSON.stringify(res.body);

    // Verify sensitive booking and passenger terms are not leaked
    expect(jsonStr).not.toMatch(/Fixture Passenger/i);
    expect(jsonStr).not.toMatch(/booking_id/i);
    expect(jsonStr).not.toMatch(/pnr/i);
    expect(jsonStr).not.toMatch(/payment/i);
    expect(jsonStr).not.toMatch(/amount/i);
    expect(jsonStr).not.toMatch(/user_id/i);
  });

  test('23. Existing train search and train details endpoints continue working', async () => {
    // 1. Train search
    const searchRes = await request(app)
      .get('/api/trains/search')
      .query({
        fromStationId: stations.NDLS,
        toStationId: stations.CNB,
        journeyDate: testJourneyDate,
      });
    expect(searchRes.status).toBe(200);
    expect(searchRes.body.trains.length).toBeGreaterThan(0);

    // 2. Train details
    const detailsRes = await request(app).get(`/api/trains/${expTrainId}`);
    expect(detailsRes.status).toBe(200);
    expect(detailsRes.body.train.trainNumber).toBe('DEMO-EXP-01');
    expect(detailsRes.body.stops.length).toBe(5);
  });

  test('24. Fresh HELD allocation (2 minutes old) remains occupied', async () => {
    // 1. Create a fresh pending booking 2 minutes ago
    const bRes = await pool.query(
      `INSERT INTO bookings (user_id, train_id, journey_date, source_station_id, destination_station_id, class_code, status, total_amount, created_at)
       VALUES ($1, $2, $3, $4, $5, '2A', 'PENDING_PAYMENT', 500, NOW() - INTERVAL '2 minutes')
       RETURNING id`,
      [testUserId, expTrainId, testJourneyDate, stations.NDLS, stations.CNB]
    );
    const bId = bRes.rows[0].id;
    createdBookingIds.push(bId);

    const pRes = await pool.query(
      `INSERT INTO booking_passengers (booking_id, name_snapshot, age_snapshot, gender_snapshot, passenger_status)
       VALUES ($1, 'Fresh Hold Passenger', 30, 'MALE', 'CONFIRMED')
       RETURNING id`,
      [bId]
    );
    const pId = pRes.rows[0].id;

    await pool.query(
      `INSERT INTO seat_allocations (booking_passenger_id, seat_id, journey_date, from_stop_order, to_stop_order, allocation_type, status, allocated_at)
       VALUES ($1, $2, $3, 1, 2, 'CONFIRMED', 'HELD', NOW() - INTERVAL '2 minutes')`,
      [pId, normalSeatId, testJourneyDate]
    );

    // 2. Call GET /api/trains/:trainId/availability
    const res = await request(app)
      .get(`/api/trains/${expTrainId}/availability`)
      .query({
        fromStationId: stations.NDLS,
        toStationId: stations.CNB,
        journeyDate: testJourneyDate,
      });

    expect(res.status).toBe(200);
    expect(res.body.availability.confirmed).toBe(123); // 124 - 1

    let foundSeat = null;
    for (const coach of res.body.coaches) {
      const match = coach.seats.find((s) => s.seatId === normalSeatId);
      if (match) foundSeat = match;
    }
    expect(foundSeat).toBeDefined();
    expect(foundSeat.isAvailable).toBe(false);

    // Direct DB verification: still HELD and PENDING_PAYMENT
    const aCheck = await pool.query('SELECT status FROM seat_allocations WHERE booking_passenger_id = $1', [pId]);
    expect(aCheck.rows[0].status).toBe('HELD');

    const bCheck = await pool.query('SELECT status FROM bookings WHERE id = $1', [bId]);
    expect(bCheck.rows[0].status).toBe('PENDING_PAYMENT');

    const pCheck = await pool.query('SELECT passenger_status FROM booking_passengers WHERE id = $1', [pId]);
    expect(pCheck.rows[0].passenger_status).toBe('CONFIRMED');
  });

  test('25. Expired HELD allocation (15 minutes old) becomes RELEASED, booking/passengers become CANCELLED, and availability correctly restores the seat', async () => {
    // 1. Create an expired pending booking 15 minutes ago
    const bRes = await pool.query(
      `INSERT INTO bookings (user_id, train_id, journey_date, source_station_id, destination_station_id, class_code, status, total_amount, created_at)
       VALUES ($1, $2, $3, $4, $5, '2A', 'PENDING_PAYMENT', 500, NOW() - INTERVAL '15 minutes')
       RETURNING id`,
      [testUserId, expTrainId, testJourneyDate, stations.NDLS, stations.CNB]
    );
    const bId = bRes.rows[0].id;
    createdBookingIds.push(bId);

    const pRes = await pool.query(
      `INSERT INTO booking_passengers (booking_id, name_snapshot, age_snapshot, gender_snapshot, passenger_status)
       VALUES ($1, 'Expired Hold Passenger', 30, 'MALE', 'CONFIRMED')
       RETURNING id`,
      [bId]
    );
    const pId = pRes.rows[0].id;

    await pool.query(
      `INSERT INTO seat_allocations (booking_passenger_id, seat_id, journey_date, from_stop_order, to_stop_order, allocation_type, status, allocated_at)
       VALUES ($1, $2, $3, 1, 2, 'CONFIRMED', 'HELD', NOW() - INTERVAL '15 minutes')`,
      [pId, normalSeatId, testJourneyDate]
    );

    // 2. Call GET /api/trains/:trainId/availability — triggers eager releaseExpiredHolds!
    const res = await request(app)
      .get(`/api/trains/${expTrainId}/availability`)
      .query({
        fromStationId: stations.NDLS,
        toStationId: stations.CNB,
        journeyDate: testJourneyDate,
      });

    expect(res.status).toBe(200);
    expect(res.body.availability.confirmed).toBe(124); // Fully available!

    let foundSeat = null;
    for (const coach of res.body.coaches) {
      const match = coach.seats.find((s) => s.seatId === normalSeatId);
      if (match) foundSeat = match;
    }
    expect(foundSeat).toBeDefined();
    expect(foundSeat.isAvailable).toBe(true);

    // Direct DB verification: allocations RELEASED, booking & passengers CANCELLED
    const aCheck = await pool.query('SELECT status FROM seat_allocations WHERE booking_passenger_id = $1', [pId]);
    expect(aCheck.rows[0].status).toBe('RELEASED');

    const bCheck = await pool.query('SELECT status FROM bookings WHERE id = $1', [bId]);
    expect(bCheck.rows[0].status).toBe('CANCELLED');

    const pCheck = await pool.query('SELECT passenger_status FROM booking_passengers WHERE id = $1', [pId]);
    expect(pCheck.rows[0].passenger_status).toBe('CANCELLED');
  });

  test('26. Old ACTIVE allocations remain occupied', async () => {
    // 1. Create a confirmed booking 2 hours ago
    const bRes = await pool.query(
      `INSERT INTO bookings (user_id, train_id, journey_date, source_station_id, destination_station_id, class_code, status, total_amount, created_at)
       VALUES ($1, $2, $3, $4, $5, '2A', 'CONFIRMED', 500, NOW() - INTERVAL '2 hours')
       RETURNING id`,
      [testUserId, expTrainId, testJourneyDate, stations.NDLS, stations.CNB]
    );
    const bId = bRes.rows[0].id;
    createdBookingIds.push(bId);

    const pRes = await pool.query(
      `INSERT INTO booking_passengers (booking_id, name_snapshot, age_snapshot, gender_snapshot, passenger_status)
       VALUES ($1, 'Active Passenger', 30, 'MALE', 'CONFIRMED')
       RETURNING id`,
      [bId]
    );
    const pId = pRes.rows[0].id;

    await pool.query(
      `INSERT INTO seat_allocations (booking_passenger_id, seat_id, journey_date, from_stop_order, to_stop_order, allocation_type, status, allocated_at)
       VALUES ($1, $2, $3, 1, 2, 'CONFIRMED', 'ACTIVE', NOW() - INTERVAL '2 hours')`,
      [pId, normalSeatId, testJourneyDate]
    );

    // 2. Call GET /api/trains/:trainId/availability
    const res = await request(app)
      .get(`/api/trains/${expTrainId}/availability`)
      .query({
        fromStationId: stations.NDLS,
        toStationId: stations.CNB,
        journeyDate: testJourneyDate,
      });

    expect(res.status).toBe(200);
    expect(res.body.availability.confirmed).toBe(123);

    // Direct DB check: ACTIVE allocation and CONFIRMED booking remain untouched
    const aCheck = await pool.query('SELECT status FROM seat_allocations WHERE booking_passenger_id = $1', [pId]);
    expect(aCheck.rows[0].status).toBe('ACTIVE');

    const bCheck = await pool.query('SELECT status FROM bookings WHERE id = $1', [bId]);
    expect(bCheck.rows[0].status).toBe('CONFIRMED');

    const pCheck = await pool.query('SELECT passenger_status FROM booking_passengers WHERE id = $1', [pId]);
    expect(pCheck.rows[0].passenger_status).toBe('CONFIRMED');
  });

  test('27. Adjacent-segment reuse continues working after expired hold release', async () => {
    // 1. Expired hold on normalSeatId for NDLS -> CNB (stop 1 to stop 2)
    const bExpiredRes = await pool.query(
      `INSERT INTO bookings (user_id, train_id, journey_date, source_station_id, destination_station_id, class_code, status, total_amount, created_at)
       VALUES ($1, $2, $3, $4, $5, '2A', 'PENDING_PAYMENT', 500, NOW() - INTERVAL '15 minutes')
       RETURNING id`,
      [testUserId, expTrainId, testJourneyDate, stations.NDLS, stations.CNB]
    );
    const bExpiredId = bExpiredRes.rows[0].id;
    createdBookingIds.push(bExpiredId);

    const pExpiredRes = await pool.query(
      `INSERT INTO booking_passengers (booking_id, name_snapshot, age_snapshot, gender_snapshot, passenger_status)
       VALUES ($1, 'Expired Passenger', 30, 'MALE', 'CONFIRMED')
       RETURNING id`,
      [bExpiredId]
    );
    const pExpiredId = pExpiredRes.rows[0].id;

    await pool.query(
      `INSERT INTO seat_allocations (booking_passenger_id, seat_id, journey_date, from_stop_order, to_stop_order, allocation_type, status, allocated_at)
       VALUES ($1, $2, $3, 1, 2, 'CONFIRMED', 'HELD', NOW() - INTERVAL '15 minutes')`,
      [pExpiredId, normalSeatId, testJourneyDate]
    );

    // 2. Active allocation on normalSeatId for CNB -> PRYJ (stop 2 to stop 3)
    const bActiveRes = await pool.query(
      `INSERT INTO bookings (user_id, train_id, journey_date, source_station_id, destination_station_id, class_code, status, total_amount, created_at)
       VALUES ($1, $2, $3, $4, $5, '2A', 'CONFIRMED', 500, NOW() - INTERVAL '1 hour')
       RETURNING id`,
      [testUserId, expTrainId, testJourneyDate, stations.CNB, stations.PRYJ]
    );
    const bActiveId = bActiveRes.rows[0].id;
    createdBookingIds.push(bActiveId);

    const pActiveRes = await pool.query(
      `INSERT INTO booking_passengers (booking_id, name_snapshot, age_snapshot, gender_snapshot, passenger_status)
       VALUES ($1, 'Active Segment Passenger', 28, 'FEMALE', 'CONFIRMED')
       RETURNING id`,
      [bActiveId]
    );
    const pActiveId = pActiveRes.rows[0].id;

    await pool.query(
      `INSERT INTO seat_allocations (booking_passenger_id, seat_id, journey_date, from_stop_order, to_stop_order, allocation_type, status, allocated_at)
       VALUES ($1, $2, $3, 2, 3, 'CONFIRMED', 'ACTIVE', NOW() - INTERVAL '1 hour')`,
      [pActiveId, normalSeatId, testJourneyDate]
    );

    // 3. Query availability for NDLS -> CNB (stop 1 to stop 2)
    // The expired hold for stop 1-2 is released, and stop 2-3 is non-overlapping, so NDLS -> CNB is available!
    const res1 = await request(app)
      .get(`/api/trains/${expTrainId}/availability`)
      .query({
        fromStationId: stations.NDLS,
        toStationId: stations.CNB,
        journeyDate: testJourneyDate,
      });

    expect(res1.status).toBe(200);
    let foundSeat1 = null;
    for (const coach of res1.body.coaches) {
      const match = coach.seats.find((s) => s.seatId === normalSeatId);
      if (match) foundSeat1 = match;
    }
    expect(foundSeat1).toBeDefined();
    expect(foundSeat1.isAvailable).toBe(true);

    // 4. Query availability for CNB -> PRYJ (stop 2 to stop 3)
    // Active allocation blocks this segment!
    const res2 = await request(app)
      .get(`/api/trains/${expTrainId}/availability`)
      .query({
        fromStationId: stations.CNB,
        toStationId: stations.PRYJ,
        journeyDate: testJourneyDate,
      });

    expect(res2.status).toBe(200);
    let foundSeat2 = null;
    for (const coach of res2.body.coaches) {
      const match = coach.seats.find((s) => s.seatId === normalSeatId);
      if (match) foundSeat2 = match;
    }
    expect(foundSeat2).toBeDefined();
    expect(foundSeat2.isAvailable).toBe(false);

    // Direct DB check: expired hold is RELEASED, active segment remains ACTIVE
    const expiredCheck = await pool.query('SELECT status FROM seat_allocations WHERE booking_passenger_id = $1', [pExpiredId]);
    expect(expiredCheck.rows[0].status).toBe('RELEASED');

    const activeCheck = await pool.query('SELECT status FROM seat_allocations WHERE booking_passenger_id = $1', [pActiveId]);
    expect(activeCheck.rows[0].status).toBe('ACTIVE');
  });

  test('28. Seed records remain intact', async () => {
    const stationCount = await pool.query('SELECT COUNT(*) FROM stations');
    const trainCount = await pool.query('SELECT COUNT(*) FROM trains');
    const stopCount = await pool.query('SELECT COUNT(*) FROM train_stops');
    const coachCount = await pool.query('SELECT COUNT(*) FROM coaches');
    const seatCount = await pool.query('SELECT COUNT(*) FROM seats');

    expect(Number(stationCount.rows[0].count)).toBe(5);
    expect(Number(trainCount.rows[0].count)).toBe(2);
    expect(Number(stopCount.rows[0].count)).toBe(9);
    expect(Number(coachCount.rows[0].count)).toBe(4);
    expect(Number(seatCount.rows[0].count)).toBe(276);
  });
});
