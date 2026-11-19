/**
 * train.details.test.js — Integration Tests for Train Details & Route API
 *
 * Verifies:
 *   1. DEMO-EXP-01 details, including all 5 stops and 2 coaches
 *   2. DEMO-SF-02 details, including all 4 stops and 2 coaches
 *   3. Stops are strictly ordered by stopOrder (1, 2, 3...)
 *   4. Station metadata (code, name, city) is accurate
 *   5. Coach capacities and class codes match specifications
 *   6. NULL arrival time at the origin stop
 *   7. NULL departure time at the terminus stop
 *   8. Correct time formatting ('HH:MM' or null)
 *   9. Correct distance progression (monotonically non-decreasing)
 *   10. Invalid train IDs (non-numeric, decimals, zero, negatives) return HTTP 400
 *   11. Non-existent train ID returns HTTP 404
 *   12. Inactive train returns HTTP 404
 *   13. Train with no stops and coaches returns empty arrays (stops: [], coaches: [])
 *   14. Existing /api/trains/search continues working (no route shadowing)
 *   15. Database seed records remain intact
 */

'use strict';

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const request = require('supertest');
const app = require('../src/app');
const pool = require('../src/config/db');

describe('GET /api/trains/:trainId', () => {
  let expTrainId;
  let sfTrainId;

  beforeAll(async () => {
    const res = await pool.query(
      "SELECT id, train_number FROM trains WHERE train_number IN ('DEMO-EXP-01', 'DEMO-SF-02')"
    );
    for (const row of res.rows) {
      if (row.train_number === 'DEMO-EXP-01') expTrainId = Number(row.id);
      if (row.train_number === 'DEMO-SF-02') sfTrainId = Number(row.id);
    }
  });

  afterAll(async () => {
    await pool.end();
  });

  // -------------------------------------------------------------------------
  // 1. DEMO-EXP-01 Complete Details
  // -------------------------------------------------------------------------
  test('1. should return full details for DEMO-EXP-01 (5 stops, 2 coaches)', async () => {
    const res = await request(app).get(`/api/trains/${expTrainId}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('train');
    expect(res.body).toHaveProperty('stops');
    expect(res.body).toHaveProperty('coaches');

    // Train metadata
    expect(res.body.train).toEqual({
      id: expTrainId,
      trainNumber: 'DEMO-EXP-01',
      trainName: 'SmartRail Express',
      trainType: 'EXPRESS',
    });

    // 5 stops
    expect(res.body.stops).toHaveLength(5);

    // 2 coaches
    expect(res.body.coaches).toHaveLength(2);
    expect(res.body.coaches.map((c) => c.coachNumber)).toEqual(['A1', 'B1']);
  });

  // -------------------------------------------------------------------------
  // 2. DEMO-SF-02 Complete Details
  // -------------------------------------------------------------------------
  test('2. should return full details for DEMO-SF-02 (4 stops, 2 coaches)', async () => {
    const res = await request(app).get(`/api/trains/${sfTrainId}`);

    expect(res.status).toBe(200);
    expect(res.body.train).toEqual({
      id: sfTrainId,
      trainNumber: 'DEMO-SF-02',
      trainName: 'SmartRail Superfast',
      trainType: 'SUPERFAST',
    });

    expect(res.body.stops).toHaveLength(4);
    expect(res.body.coaches).toHaveLength(2);
    expect(res.body.coaches.map((c) => c.coachNumber)).toEqual(['B1', 'S1']);
  });

  // -------------------------------------------------------------------------
  // 3. Stop Ordering
  // -------------------------------------------------------------------------
  test('3. stops must be strictly ordered by stopOrder ascending', async () => {
    const res = await request(app).get(`/api/trains/${expTrainId}`);

    expect(res.status).toBe(200);
    const stopOrders = res.body.stops.map((s) => s.stopOrder);
    expect(stopOrders).toEqual([1, 2, 3, 4, 5]);
  });

  // -------------------------------------------------------------------------
  // 4. Station Metadata
  // -------------------------------------------------------------------------
  test('4. station metadata (code, name, city) must be accurate', async () => {
    const res = await request(app).get(`/api/trains/${expTrainId}`);

    expect(res.status).toBe(200);
    const stations = res.body.stops.map((s) => ({
      code: s.stationCode,
      name: s.stationName,
      city: s.stationCity,
    }));

    expect(stations).toEqual([
      { code: 'NDLS', name: 'New Delhi', city: 'New Delhi' },
      { code: 'CNB', name: 'Kanpur Central', city: 'Kanpur' },
      { code: 'PRYJ', name: 'Prayagraj Junction', city: 'Prayagraj' },
      { code: 'DDU', name: 'Pt. Deen Dayal Upadhyaya Junction', city: 'Mughalsarai' },
      { code: 'HWH', name: 'Howrah Junction', city: 'Kolkata' },
    ]);
  });

  // -------------------------------------------------------------------------
  // 5. Coach Capacities & Class Codes
  // -------------------------------------------------------------------------
  test('5. coaches must contain accurate capacities and class codes', async () => {
    const expRes = await request(app).get(`/api/trains/${expTrainId}`);
    expect(expRes.status).toBe(200);

    const a1 = expRes.body.coaches.find((c) => c.coachNumber === 'A1');
    const b1Exp = expRes.body.coaches.find((c) => c.coachNumber === 'B1');

    expect(a1).toMatchObject({
      coachNumber: 'A1',
      coachType: 'AC_2_TIER',
      classCode: '2A',
      seatCapacity: 52,
    });
    expect(b1Exp).toMatchObject({
      coachNumber: 'B1',
      coachType: 'AC_3_TIER',
      classCode: '3A',
      seatCapacity: 72,
    });

    const sfRes = await request(app).get(`/api/trains/${sfTrainId}`);
    expect(sfRes.status).toBe(200);

    const s1 = sfRes.body.coaches.find((c) => c.coachNumber === 'S1');
    expect(s1).toMatchObject({
      coachNumber: 'S1',
      coachType: 'SLEEPER',
      classCode: 'SL',
      seatCapacity: 80,
    });
  });

  // -------------------------------------------------------------------------
  // 6. Origin Arrival Time is NULL
  // -------------------------------------------------------------------------
  test('6. origin stop must have arrivalTime: null and valid departureTime', async () => {
    const res = await request(app).get(`/api/trains/${expTrainId}`);

    expect(res.status).toBe(200);
    const originStop = res.body.stops[0];
    expect(originStop.stopOrder).toBe(1);
    expect(originStop.arrivalTime).toBeNull();
    expect(originStop.departureTime).toBe('06:00');
  });

  // -------------------------------------------------------------------------
  // 7. Terminus Departure Time is NULL
  // -------------------------------------------------------------------------
  test('7. terminus stop must have departureTime: null and valid arrivalTime', async () => {
    const res = await request(app).get(`/api/trains/${expTrainId}`);

    expect(res.status).toBe(200);
    const terminusStop = res.body.stops[res.body.stops.length - 1];
    expect(terminusStop.stopOrder).toBe(5);
    expect(terminusStop.arrivalTime).toBe('22:30');
    expect(terminusStop.departureTime).toBeNull();
  });

  // -------------------------------------------------------------------------
  // 8. Time Formatting
  // -------------------------------------------------------------------------
  test('8. intermediate stops must have both arrival and departure in HH:MM format', async () => {
    const res = await request(app).get(`/api/trains/${expTrainId}`);

    expect(res.status).toBe(200);
    const intermediateStops = res.body.stops.slice(1, -1);
    for (const stop of intermediateStops) {
      expect(stop.arrivalTime).toMatch(/^\d{2}:\d{2}$/);
      expect(stop.departureTime).toMatch(/^\d{2}:\d{2}$/);
    }
  });

  // -------------------------------------------------------------------------
  // 9. Distance Progression
  // -------------------------------------------------------------------------
  test('9. distanceKm must be numeric and monotonically non-decreasing', async () => {
    const res = await request(app).get(`/api/trains/${expTrainId}`);

    expect(res.status).toBe(200);
    const distances = res.body.stops.map((s) => s.distanceKm);

    expect(distances).toEqual([0, 440, 635, 786, 1447]);
    for (let i = 1; i < distances.length; i++) {
      expect(distances[i]).toBeGreaterThan(distances[i - 1]);
    }
  });

  // -------------------------------------------------------------------------
  // 10. Invalid Train IDs (HTTP 400)
  // -------------------------------------------------------------------------
  test('10a. should return HTTP 400 for non-numeric trainId string', async () => {
    const res = await request(app).get('/api/trains/abc');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.message).toMatch(/positive integer/i);
  });

  test('10b. should return HTTP 400 for decimal trainId', async () => {
    const res = await request(app).get('/api/trains/1.5');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.message).toMatch(/positive integer/i);
  });

  test('10c. should return HTTP 400 for zero trainId', async () => {
    const res = await request(app).get('/api/trains/0');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.message).toMatch(/positive integer/i);
  });

  test('10d. should return HTTP 400 for negative trainId', async () => {
    const res = await request(app).get('/api/trains/-5');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.message).toMatch(/positive integer/i);
  });

  // -------------------------------------------------------------------------
  // 11. Non-Existent Train ID (HTTP 404)
  // -------------------------------------------------------------------------
  test('11. should return HTTP 404 when trainId does not exist', async () => {
    const res = await request(app).get('/api/trains/999999');

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(res.body.error.message).toMatch(/not found/i);
  });

  // -------------------------------------------------------------------------
  // 12. Inactive Train Returns HTTP 404
  // -------------------------------------------------------------------------
  test('12. should return HTTP 404 when train is inactive (active = false)', async () => {
    // Temporarily mark DEMO-SF-02 inactive
    await pool.query('UPDATE trains SET active = false WHERE id = $1', [sfTrainId]);

    try {
      const res = await request(app).get(`/api/trains/${sfTrainId}`);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
      expect(res.body.error.message).toMatch(/not found/i);
    } finally {
      // Restore active status
      await pool.query('UPDATE trains SET active = true WHERE id = $1', [sfTrainId]);
    }
  });

  // -------------------------------------------------------------------------
  // 13. Train with Empty Stops and Coaches Returns Empty Arrays
  // -------------------------------------------------------------------------
  test('13. should return empty stops: [] and coaches: [] when none configured', async () => {
    // Insert disposable train with no stops and no coaches
    const insertRes = await pool.query(`
      INSERT INTO trains (train_number, train_name, train_type, active)
      VALUES ('DISPOSABLE-99', 'Ghost Train', 'LOCAL', true)
      RETURNING id
    `);
    const disposableId = insertRes.rows[0].id;

    try {
      const res = await request(app).get(`/api/trains/${disposableId}`);

      expect(res.status).toBe(200);
      expect(res.body.train.trainNumber).toBe('DISPOSABLE-99');
      expect(res.body.stops).toEqual([]);
      expect(res.body.coaches).toEqual([]);
    } finally {
      // Clean up disposable train
      await pool.query('DELETE FROM trains WHERE id = $1', [disposableId]);
    }
  });

  // -------------------------------------------------------------------------
  // 14. Existing /api/trains/search Continues Working (No Route Shadowing)
  // -------------------------------------------------------------------------
  test('14. should ensure /api/trains/search is not shadowed by /api/trains/:trainId', async () => {
    const stationRes = await pool.query("SELECT id, code FROM stations WHERE code IN ('NDLS', 'CNB')");
    let ndlsId, cnbId;
    for (const r of stationRes.rows) {
      if (r.code === 'NDLS') ndlsId = r.id;
      if (r.code === 'CNB') cnbId = r.id;
    }

    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 7);
    const journeyDate = futureDate.toISOString().split('T')[0];

    const res = await request(app)
      .get('/api/trains/search')
      .query({
        fromStationId: ndlsId,
        toStationId: cnbId,
        journeyDate,
      });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('trains');
    expect(res.body.trains.length).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // 15. Database Seed Records Integrity Check
  // -------------------------------------------------------------------------
  test('15. database seed records must remain untouched', async () => {
    const stationCount = await pool.query('SELECT COUNT(*) FROM stations');
    const trainCount = await pool.query('SELECT COUNT(*) FROM trains');
    const stopCount = await pool.query('SELECT COUNT(*) FROM train_stops');
    const coachCount = await pool.query('SELECT COUNT(*) FROM coaches');
    const userCount = await pool.query('SELECT COUNT(*) FROM users');

    expect(Number(stationCount.rows[0].count)).toBe(5);
    expect(Number(trainCount.rows[0].count)).toBe(2);
    expect(Number(stopCount.rows[0].count)).toBe(9);
    expect(Number(coachCount.rows[0].count)).toBe(4);
    expect(Number(userCount.rows[0].count)).toBe(0);
  });
});
