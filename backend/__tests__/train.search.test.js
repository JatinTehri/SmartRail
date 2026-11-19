/**
 * train.search.test.js — Integration Tests for Train Search API
 *
 * Verifies:
 *   1. Search NDLS -> CNB returns DEMO-EXP-01 and DEMO-SF-02 ordered by departure time
 *   2. Search NDLS -> HWH returns DEMO-EXP-01 and excludes DEMO-SF-02 (does not go to HWH)
 *   3. Search NDLS -> DDU returns both demo trains with accurate intermediate timings
 *   4. Reverse direction (HWH -> NDLS) returns 0 trains (directionality enforced)
 *   5. Same source and destination (fromStationId === toStationId) returns HTTP 400
 *   6. Missing and non-numeric station IDs return HTTP 400
 *   7. Invalid and past journey dates return HTTP 400
 *   8. Optional classCode filtering works (2A, SL, 3A, and non-matching 1A)
 *   9. Invalid classCode returns HTTP 400
 *   10. Distinct aggregated coach classes are returned
 *   11. Duration formatting matches 'Xh Ym'
 *   12. Segment distance (to_dist - from_dist) is accurately computed
 *   13. Inactive trains (active = false) are excluded
 *   14. Non-existent station IDs return HTTP 200 with empty array
 *   15. Response structure strictly adheres to docs/API.md: { trains: [...] }
 *   16. Database seed integrity is preserved
 */

'use strict';

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const request = require('supertest');
const app = require('../src/app');
const pool = require('../src/config/db');
const { getTodayIST, isDateInPast } = require('../src/modules/trains/train.validator');

describe('GET /api/trains/search', () => {
  const stationMap = {};
  let validJourneyDate;

  beforeAll(async () => {
    // 1. Fetch station IDs dynamically
    const res = await pool.query('SELECT id, code FROM stations');
    for (const row of res.rows) {
      stationMap[row.code] = row.id;
    }

    // 2. Generate a valid future journey date
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 7);
    validJourneyDate = futureDate.toISOString().split('T')[0];
  });

  afterAll(async () => {
    await pool.end();
  });

  // -------------------------------------------------------------------------
  // 1. Basic Train Search: NDLS -> CNB
  // -------------------------------------------------------------------------
  test('1. should return DEMO-EXP-01 and DEMO-SF-02 for NDLS -> CNB ordered by departure', async () => {
    const res = await request(app)
      .get('/api/trains/search')
      .query({
        fromStationId: stationMap.NDLS,
        toStationId: stationMap.CNB,
        journeyDate: validJourneyDate,
      });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('trains');
    expect(Array.isArray(res.body.trains)).toBe(true);
    expect(res.body.trains.length).toBe(2);

    const [firstTrain, secondTrain] = res.body.trains;
    expect(firstTrain.trainNumber).toBe('DEMO-EXP-01');
    expect(firstTrain.departure).toBe('06:00');
    expect(firstTrain.arrival).toBe('10:30');
    expect(firstTrain.duration).toBe('4h 30m');
    expect(firstTrain.distanceKm).toBe(440);

    expect(secondTrain.trainNumber).toBe('DEMO-SF-02');
    expect(secondTrain.departure).toBe('07:30');
    expect(secondTrain.arrival).toBe('12:00');
    expect(secondTrain.duration).toBe('4h 30m');
    expect(secondTrain.distanceKm).toBe(440);
  });

  // -------------------------------------------------------------------------
  // 2. Endpoint Terminus Search: NDLS -> HWH
  // -------------------------------------------------------------------------
  test('2. should return DEMO-EXP-01 for NDLS -> HWH and exclude DEMO-SF-02', async () => {
    const res = await request(app)
      .get('/api/trains/search')
      .query({
        fromStationId: stationMap.NDLS,
        toStationId: stationMap.HWH,
        journeyDate: validJourneyDate,
      });

    expect(res.status).toBe(200);
    expect(res.body.trains.length).toBe(1);

    const train = res.body.trains[0];
    expect(train.trainNumber).toBe('DEMO-EXP-01');
    expect(train.trainName).toBe('SmartRail Express');
    expect(train.departure).toBe('06:00');
    expect(train.arrival).toBe('22:30');
    expect(train.duration).toBe('16h 30m');
    expect(train.distanceKm).toBe(1447);
  });

  // -------------------------------------------------------------------------
  // 3. Intermediate Station Search: NDLS -> DDU
  // -------------------------------------------------------------------------
  test('3. should return both trains for NDLS -> DDU with accurate timings and distances', async () => {
    const res = await request(app)
      .get('/api/trains/search')
      .query({
        fromStationId: stationMap.NDLS,
        toStationId: stationMap.DDU,
        journeyDate: validJourneyDate,
      });

    expect(res.status).toBe(200);
    expect(res.body.trains.length).toBe(2);

    const expTrain = res.body.trains.find((t) => t.trainNumber === 'DEMO-EXP-01');
    const sfTrain = res.body.trains.find((t) => t.trainNumber === 'DEMO-SF-02');

    expect(expTrain.arrival).toBe('15:00');
    expect(expTrain.duration).toBe('9h 0m');
    expect(expTrain.distanceKm).toBe(786);

    expect(sfTrain.arrival).toBe('16:45');
    expect(sfTrain.duration).toBe('9h 15m');
    expect(sfTrain.distanceKm).toBe(786);
  });

  // -------------------------------------------------------------------------
  // 4. Directionality: Reverse Search (HWH -> NDLS)
  // -------------------------------------------------------------------------
  test('4. should return 0 trains for reverse direction HWH -> NDLS', async () => {
    const res = await request(app)
      .get('/api/trains/search')
      .query({
        fromStationId: stationMap.HWH,
        toStationId: stationMap.NDLS,
        journeyDate: validJourneyDate,
      });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('trains');
    expect(res.body.trains).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // 5. Origin and Destination are Identical
  // -------------------------------------------------------------------------
  test('5. should return HTTP 400 when fromStationId === toStationId', async () => {
    const res = await request(app)
      .get('/api/trains/search')
      .query({
        fromStationId: stationMap.NDLS,
        toStationId: stationMap.NDLS,
        journeyDate: validJourneyDate,
      });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.message).toMatch(/identical|same/i);
  });

  // -------------------------------------------------------------------------
  // 6. Station ID Validation
  // -------------------------------------------------------------------------
  test('6a. should return HTTP 400 when fromStationId is missing', async () => {
    const res = await request(app)
      .get('/api/trains/search')
      .query({
        toStationId: stationMap.CNB,
        journeyDate: validJourneyDate,
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.message).toMatch(/fromStationId/i);
  });

  test('6b. should return HTTP 400 when toStationId is missing', async () => {
    const res = await request(app)
      .get('/api/trains/search')
      .query({
        fromStationId: stationMap.NDLS,
        journeyDate: validJourneyDate,
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.message).toMatch(/toStationId/i);
  });

  test('6c. should return HTTP 400 when station ID is not a positive integer', async () => {
    const res = await request(app)
      .get('/api/trains/search')
      .query({
        fromStationId: 'abc',
        toStationId: stationMap.CNB,
        journeyDate: validJourneyDate,
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.message).toMatch(/positive integer/i);
  });

  // -------------------------------------------------------------------------
  // 7. Journey Date Validation
  // -------------------------------------------------------------------------
  test('7a. should return HTTP 400 when journeyDate is missing', async () => {
    const res = await request(app)
      .get('/api/trains/search')
      .query({
        fromStationId: stationMap.NDLS,
        toStationId: stationMap.CNB,
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.message).toMatch(/journey date/i);
  });

  test('7b. should return HTTP 400 when journeyDate has invalid format', async () => {
    const res = await request(app)
      .get('/api/trains/search')
      .query({
        fromStationId: stationMap.NDLS,
        toStationId: stationMap.CNB,
        journeyDate: '2026/12/25',
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.message).toMatch(/YYYY-MM-DD/i);
  });

  test('7c. should return HTTP 400 when journeyDate is an impossible calendar date', async () => {
    const res = await request(app)
      .get('/api/trains/search')
      .query({
        fromStationId: stationMap.NDLS,
        toStationId: stationMap.CNB,
        journeyDate: '2026-02-31',
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.message).toMatch(/valid calendar date/i);
  });

  test('7d. should return HTTP 400 when journeyDate is in the past', async () => {
    const res = await request(app)
      .get('/api/trains/search')
      .query({
        fromStationId: stationMap.NDLS,
        toStationId: stationMap.CNB,
        journeyDate: '2020-01-01',
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.message).toMatch(/past/i);
  });

  test('7e. should reject Nov 2 as past and accept Nov 3 at 01:30 IST on Nov 3, 2026 (IST timezone boundary check)', async () => {
    // 01:30 IST on November 3, 2026 corresponds to 20:00 UTC on November 2, 2026
    const simulatedDate = new Date('2026-11-02T20:00:00.000Z');

    // 1. Direct validator function verification
    expect(getTodayIST(simulatedDate)).toBe('2026-11-03');
    expect(isDateInPast('2026-11-02', simulatedDate)).toBe(true);
    expect(isDateInPast('2026-11-03', simulatedDate)).toBe(false);

    // 2. Integration / HTTP-level verification with fake timers
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    jest.setSystemTime(simulatedDate);

    try {
      // November 2 must be rejected as past journey date
      const pastRes = await request(app)
        .get('/api/trains/search')
        .query({
          fromStationId: stationMap.NDLS,
          toStationId: stationMap.CNB,
          journeyDate: '2026-11-02',
        });

      expect(pastRes.status).toBe(400);
      expect(pastRes.body.error.code).toBe('VALIDATION_ERROR');
      expect(pastRes.body.error.message).toMatch(/past/i);

      // November 3 must be accepted (same day journey)
      const validRes = await request(app)
        .get('/api/trains/search')
        .query({
          fromStationId: stationMap.NDLS,
          toStationId: stationMap.CNB,
          journeyDate: '2026-11-03',
        });

      expect(validRes.status).toBe(200);
      expect(validRes.body).toHaveProperty('trains');
      expect(validRes.body.trains.length).toBeGreaterThan(0);
    } finally {
      jest.useRealTimers();
    }
  });

  test('7f. should correctly determine Asia/Kolkata date across midnight boundary', () => {
    // 23:45 IST on November 3, 2026 is 18:15 UTC on November 3, 2026
    const lateNightIST = new Date('2026-11-03T18:15:00.000Z');
    expect(getTodayIST(lateNightIST)).toBe('2026-11-03');
    expect(isDateInPast('2026-11-03', lateNightIST)).toBe(false);

    // 00:01 IST on November 4, 2026 is 18:31 UTC on November 3, 2026 (1 min past midnight IST)
    const justPastMidnightIST = new Date('2026-11-03T18:31:00.000Z');
    expect(getTodayIST(justPastMidnightIST)).toBe('2026-11-04');
    expect(isDateInPast('2026-11-03', justPastMidnightIST)).toBe(true);
    expect(isDateInPast('2026-11-04', justPastMidnightIST)).toBe(false);
  });

  // -------------------------------------------------------------------------
  // 8. Class Code Filtering
  // -------------------------------------------------------------------------
  test('8a. should filter by classCode=2A and return only DEMO-EXP-01', async () => {
    const res = await request(app)
      .get('/api/trains/search')
      .query({
        fromStationId: stationMap.NDLS,
        toStationId: stationMap.CNB,
        journeyDate: validJourneyDate,
        classCode: '2A',
      });

    expect(res.status).toBe(200);
    expect(res.body.trains.length).toBe(1);
    expect(res.body.trains[0].trainNumber).toBe('DEMO-EXP-01');
    expect(res.body.trains[0].classCode).toBe('2A');
  });

  test('8b. should filter by classCode=SL and return only DEMO-SF-02', async () => {
    const res = await request(app)
      .get('/api/trains/search')
      .query({
        fromStationId: stationMap.NDLS,
        toStationId: stationMap.CNB,
        journeyDate: validJourneyDate,
        classCode: 'SL',
      });

    expect(res.status).toBe(200);
    expect(res.body.trains.length).toBe(1);
    expect(res.body.trains[0].trainNumber).toBe('DEMO-SF-02');
    expect(res.body.trains[0].classCode).toBe('SL');
  });

  test('8c. should filter by classCode=3A and return both trains', async () => {
    const res = await request(app)
      .get('/api/trains/search')
      .query({
        fromStationId: stationMap.NDLS,
        toStationId: stationMap.CNB,
        journeyDate: validJourneyDate,
        classCode: '3A',
      });

    expect(res.status).toBe(200);
    expect(res.body.trains.length).toBe(2);
    expect(res.body.trains.every((t) => t.classes.includes('3A'))).toBe(true);
  });

  test('8d. should return 0 trains for valid classCode that neither train carries (1A)', async () => {
    const res = await request(app)
      .get('/api/trains/search')
      .query({
        fromStationId: stationMap.NDLS,
        toStationId: stationMap.CNB,
        journeyDate: validJourneyDate,
        classCode: '1A',
      });

    expect(res.status).toBe(200);
    expect(res.body.trains).toEqual([]);
  });

  test('8e. should return HTTP 400 for invalid classCode', async () => {
    const res = await request(app)
      .get('/api/trains/search')
      .query({
        fromStationId: stationMap.NDLS,
        toStationId: stationMap.CNB,
        journeyDate: validJourneyDate,
        classCode: 'XYZ',
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.message).toMatch(/invalid class code/i);
  });

  // -------------------------------------------------------------------------
  // 9. Aggregated Coach Classes
  // -------------------------------------------------------------------------
  test('9. should return distinct sorted classes array for each train', async () => {
    const res = await request(app)
      .get('/api/trains/search')
      .query({
        fromStationId: stationMap.NDLS,
        toStationId: stationMap.CNB,
        journeyDate: validJourneyDate,
      });

    expect(res.status).toBe(200);
    const expTrain = res.body.trains.find((t) => t.trainNumber === 'DEMO-EXP-01');
    const sfTrain = res.body.trains.find((t) => t.trainNumber === 'DEMO-SF-02');

    expect(expTrain.classes).toEqual(['2A', '3A']);
    expect(sfTrain.classes).toEqual(['3A', 'SL']);
  });

  // -------------------------------------------------------------------------
  // 10. Intermediate Leg Distance & Calculation
  // -------------------------------------------------------------------------
  test('10. should accurately calculate intermediate segment distance CNB -> DDU', async () => {
    // CNB is 440 km, DDU is 786 km. Segment distance = 786 - 440 = 346 km
    const res = await request(app)
      .get('/api/trains/search')
      .query({
        fromStationId: stationMap.CNB,
        toStationId: stationMap.DDU,
        journeyDate: validJourneyDate,
      });

    expect(res.status).toBe(200);
    expect(res.body.trains.length).toBe(2);

    for (const train of res.body.trains) {
      expect(train.distanceKm).toBe(346);
    }
  });

  // -------------------------------------------------------------------------
  // 11. Inactive Trains are Excluded
  // -------------------------------------------------------------------------
  test('11. should exclude inactive trains from search results', async () => {
    // Temporarily mark DEMO-SF-02 inactive
    await pool.query("UPDATE trains SET active = false WHERE train_number = 'DEMO-SF-02'");

    try {
      const res = await request(app)
        .get('/api/trains/search')
        .query({
          fromStationId: stationMap.NDLS,
          toStationId: stationMap.CNB,
          journeyDate: validJourneyDate,
        });

      expect(res.status).toBe(200);
      expect(res.body.trains.length).toBe(1);
      expect(res.body.trains[0].trainNumber).toBe('DEMO-EXP-01');
    } finally {
      // Restore DEMO-SF-02 active status
      await pool.query("UPDATE trains SET active = true WHERE train_number = 'DEMO-SF-02'");
    }
  });

  // -------------------------------------------------------------------------
  // 12. Non-Existent Station IDs
  // -------------------------------------------------------------------------
  test('12. should return HTTP 200 with empty array for non-existent station IDs', async () => {
    const res = await request(app)
      .get('/api/trains/search')
      .query({
        fromStationId: 999998,
        toStationId: 999999,
        journeyDate: validJourneyDate,
      });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ trains: [] });
  });

  // -------------------------------------------------------------------------
  // 13. Response Schema Adherence
  // -------------------------------------------------------------------------
  test('13. response should adhere strictly to docs/API.md structure', async () => {
    const res = await request(app)
      .get('/api/trains/search')
      .query({
        fromStationId: stationMap.NDLS,
        toStationId: stationMap.HWH,
        journeyDate: validJourneyDate,
      });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('trains');
    const train = res.body.trains[0];

    expect(train).toMatchObject({
      id: expect.any(Number),
      trainNumber: expect.any(String),
      trainName: expect.any(String),
      trainType: expect.any(String),
      departure: expect.stringMatching(/^\d{2}:\d{2}$/),
      arrival: expect.stringMatching(/^\d{2}:\d{2}$/),
      duration: expect.stringMatching(/^\d+h \d+m$/),
      distanceKm: expect.any(Number),
      classes: expect.any(Array),
    });
  });

  // -------------------------------------------------------------------------
  // 14. Database Seed Preservation Check
  // -------------------------------------------------------------------------
  test('14. database seed records must remain intact', async () => {
    const stationCount = await pool.query('SELECT COUNT(*) FROM stations');
    const trainCount = await pool.query('SELECT COUNT(*) FROM trains');
    const stopCount = await pool.query('SELECT COUNT(*) FROM train_stops');
    const coachCount = await pool.query('SELECT COUNT(*) FROM coaches');

    expect(Number(stationCount.rows[0].count)).toBe(5);
    expect(Number(trainCount.rows[0].count)).toBe(2);
    expect(Number(stopCount.rows[0].count)).toBe(9);
    expect(Number(coachCount.rows[0].count)).toBe(4);
  });
});
