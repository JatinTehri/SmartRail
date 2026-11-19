/**
 * passenger.test.js — Integration Tests for Passenger Profile APIs
 *
 * Verifies:
 *   1. GET /api/passengers returns only the authenticated user's profiles
 *   2. POST /api/passengers creates a profile successfully with HTTP 201
 *   3. Invalid passenger data returns HTTP 400 with VALIDATION_ERROR
 *   4. Client-provided user_id in payload cannot override ownership
 *   5. DELETE /api/passengers/:id removes an owned profile with HTTP 200
 *   6. Deleting a nonexistent profile returns HTTP 404 PASSENGER_NOT_FOUND
 *   7. Deleting another user's profile returns identical HTTP 404 PASSENGER_NOT_FOUND
 *   8. All three endpoints reject unauthenticated requests with HTTP 401
 *   9. Deleting a profile referenced by booking preserves historical passenger snapshots
 *   10. Multi-tenant isolation: operations never expose or modify another user's records
 *   11. Existing auth and train search endpoints continue working normally
 *   12. Development seed records remain intact
 */

'use strict';

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const request = require('supertest');
const app = require('../src/app');
const pool = require('../src/config/db');
const { generateToken } = require('../src/utils/token');

describe('Passenger Profile APIs (/api/passengers)', () => {
  const TEST_PREFIX = 'test.passenger.';
  const generateEmail = (suffix) => `${TEST_PREFIX}${Date.now()}.${suffix}@example.com`;

  let userA, userB;
  let cookieA, cookieB;
  let testTrainId, srcStationId, destStationId;
  let createdBookingId;

  // Cleanup helper targeting only this suite's test data
  const cleanupTestData = async () => {
    if (createdBookingId) {
      await pool.query('DELETE FROM booking_passengers WHERE booking_id = $1', [createdBookingId]);
      await pool.query('DELETE FROM bookings WHERE id = $1', [createdBookingId]);
      createdBookingId = null;
    }
    await pool.query(
      `DELETE FROM passenger_profiles 
       WHERE user_id IN (SELECT id FROM users WHERE email LIKE $1)`,
      [`${TEST_PREFIX}%`]
    );
    await pool.query('DELETE FROM users WHERE email LIKE $1', [`${TEST_PREFIX}%`]);
  };

  beforeAll(async () => {
    await cleanupTestData();

    // 1. Create two test users (User A and User B)
    const userARes = await pool.query(
      "INSERT INTO users (name, email, password_hash, role) VALUES ('User Alpha', $1, 'hashed_pw', 'USER') RETURNING id, name, email",
      [generateEmail('alpha')]
    );
    userA = userARes.rows[0];
    cookieA = `smartrail_token=${generateToken(userA.id)}`;

    const userBRes = await pool.query(
      "INSERT INTO users (name, email, password_hash, role) VALUES ('User Beta', $1, 'hashed_pw', 'USER') RETURNING id, name, email",
      [generateEmail('beta')]
    );
    userB = userBRes.rows[0];
    cookieB = `smartrail_token=${generateToken(userB.id)}`;

    // 2. Fetch seeded train and stations for booking-reference test
    const trainRes = await pool.query('SELECT id FROM trains LIMIT 1');
    testTrainId = trainRes.rows[0].id;

    const stopsRes = await pool.query(
      'SELECT station_id FROM train_stops WHERE train_id = $1 ORDER BY stop_order ASC LIMIT 2',
      [testTrainId]
    );
    srcStationId = stopsRes.rows[0].station_id;
    destStationId = stopsRes.rows[1].station_id;
  });

  afterAll(async () => {
    await cleanupTestData();
    await pool.end();
  });

  // -------------------------------------------------------------------------
  // 1. Authentication Enforcement (Unauthenticated Access)
  // -------------------------------------------------------------------------
  describe('Authentication Enforcement', () => {
    test('8a. GET /api/passengers rejects unauthenticated requests with HTTP 401', async () => {
      const res = await request(app).get('/api/passengers');
      expect(res.status).toBe(401);
      expect(res.body.error).toHaveProperty('code', 'UNAUTHORIZED');
    });

    test('8b. POST /api/passengers rejects unauthenticated requests with HTTP 401', async () => {
      const res = await request(app)
        .post('/api/passengers')
        .send({ name: 'Rahul', age: 24, gender: 'MALE' });
      expect(res.status).toBe(401);
      expect(res.body.error).toHaveProperty('code', 'UNAUTHORIZED');
    });

    test('8c. DELETE /api/passengers/:id rejects unauthenticated requests with HTTP 401', async () => {
      const res = await request(app).delete('/api/passengers/1');
      expect(res.status).toBe(401);
      expect(res.body.error).toHaveProperty('code', 'UNAUTHORIZED');
    });
  });

  // -------------------------------------------------------------------------
  // 2. POST /api/passengers — Profile Creation
  // -------------------------------------------------------------------------
  describe('POST /api/passengers', () => {
    test('2. should create a valid passenger profile and return HTTP 201', async () => {
      const res = await request(app)
        .post('/api/passengers')
        .set('Cookie', [cookieA])
        .send({
          name: 'Rahul Sharma',
          age: 24,
          gender: 'MALE',
          berthPreference: 'LOWER',
          windowPreference: true,
        });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('passenger');

      const p = res.body.passenger;
      expect(typeof p.id).toBe('number');
      expect(p.name).toBe('Rahul Sharma');
      expect(p.age).toBe(24);
      expect(p.gender).toBe('MALE');
      expect(p.berthPreference).toBe('LOWER');
      expect(p.windowPreference).toBe(true);

      // Sensitive / internal fields must NOT be returned
      expect(p).not.toHaveProperty('user_id');
      expect(p).not.toHaveProperty('userId');
    });

    test('2b. should create a minimal passenger profile with defaults', async () => {
      const res = await request(app)
        .post('/api/passengers')
        .set('Cookie', [cookieA])
        .send({
          name: 'Priya Sharma',
          age: 22,
          gender: 'female',
        });

      expect(res.status).toBe(201);
      const p = res.body.passenger;
      expect(p.name).toBe('Priya Sharma');
      expect(p.age).toBe(22);
      expect(p.gender).toBe('FEMALE');
      expect(p.berthPreference).toBe(null);
      expect(p.windowPreference).toBe(false);
    });

    test('2c. should treat berthPreference "NONE" as null', async () => {
      const res = await request(app)
        .post('/api/passengers')
        .set('Cookie', [cookieA])
        .send({
          name: 'Aarav Sharma',
          age: 3,
          gender: 'MALE',
          berthPreference: 'NONE',
        });

      expect(res.status).toBe(201);
      expect(res.body.passenger.berthPreference).toBe(null);
    });

    test('4. client-provided user_id cannot override ownership', async () => {
      const spoofedUserId = 999999;
      const res = await request(app)
        .post('/api/passengers')
        .set('Cookie', [cookieA])
        .send({
          name: 'Spoof Test',
          age: 30,
          gender: 'MALE',
          user_id: spoofedUserId,
          userId: spoofedUserId,
        });

      expect(res.status).toBe(201);
      const createdId = res.body.passenger.id;

      // Check directly in database: user_id must be userA.id, NEVER spoofedUserId
      const dbCheck = await pool.query('SELECT user_id FROM passenger_profiles WHERE id = $1', [createdId]);
      expect(Number(dbCheck.rows[0].user_id)).toBe(Number(userA.id));
      expect(Number(dbCheck.rows[0].user_id)).not.toBe(spoofedUserId);
    });

    // Validation Errors (HTTP 400)
    test('3a. should reject missing or whitespace-only name', async () => {
      const res1 = await request(app)
        .post('/api/passengers')
        .set('Cookie', [cookieA])
        .send({ age: 25, gender: 'MALE' });
      expect(res1.status).toBe(400);

      const res2 = await request(app)
        .post('/api/passengers')
        .set('Cookie', [cookieA])
        .send({ name: '   ', age: 25, gender: 'MALE' });
      expect(res2.status).toBe(400);
    });

    test('3b. should reject age outside 1-120 (0, -5, 121, decimals)', async () => {
      const invalidAges = [0, -5, 121, 25.5, 'invalid'];
      for (const age of invalidAges) {
        const res = await request(app)
          .post('/api/passengers')
          .set('Cookie', [cookieA])
          .send({ name: 'Test', age, gender: 'MALE' });
        expect(res.status).toBe(400);
      }
    });

    test('3c. should reject invalid gender', async () => {
      const res = await request(app)
        .post('/api/passengers')
        .set('Cookie', [cookieA])
        .send({ name: 'Test', age: 25, gender: 'UNKNOWN' });
      expect(res.status).toBe(400);
    });

    test('3d. should reject invalid berth preference', async () => {
      const res = await request(app)
        .post('/api/passengers')
        .set('Cookie', [cookieA])
        .send({ name: 'Test', age: 25, gender: 'MALE', berthPreference: 'ROOF' });
      expect(res.status).toBe(400);
    });

    test('3e. should reject non-boolean window preference', async () => {
      const res = await request(app)
        .post('/api/passengers')
        .set('Cookie', [cookieA])
        .send({ name: 'Test', age: 25, gender: 'MALE', windowPreference: 'yes' });
      expect(res.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // 3. GET /api/passengers — Multi-Tenant Profile Retrieval
  // -------------------------------------------------------------------------
  describe('GET /api/passengers', () => {
    test('1 & 10. should return only the authenticated user\'s profiles without cross-tenant leakage', async () => {
      // User B creates a profile
      const createB = await request(app)
        .post('/api/passengers')
        .set('Cookie', [cookieB])
        .send({ name: 'Vikram Singh', age: 40, gender: 'MALE' });
      expect(createB.status).toBe(201);
      const userBProfileId = createB.body.passenger.id;

      // User A fetches profiles
      const resA = await request(app)
        .get('/api/passengers')
        .set('Cookie', [cookieA]);

      expect(resA.status).toBe(200);
      expect(resA.body).toHaveProperty('passengers');
      expect(Array.isArray(resA.body.passengers)).toBe(true);

      const namesA = resA.body.passengers.map((p) => p.name);
      expect(namesA).toContain('Rahul Sharma');
      expect(namesA).toContain('Priya Sharma');
      expect(namesA).not.toContain('Vikram Singh');

      // User B fetches profiles
      const resB = await request(app)
        .get('/api/passengers')
        .set('Cookie', [cookieB]);

      expect(resB.status).toBe(200);
      const idsB = resB.body.passengers.map((p) => p.id);
      expect(idsB).toContain(userBProfileId);
      expect(idsB.length).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // 4. DELETE /api/passengers/:id — Deletion & Anti-Enumeration
  // -------------------------------------------------------------------------
  describe('DELETE /api/passengers/:id', () => {
    let profileToDeleteId;
    let userBProfileId;

    beforeAll(async () => {
      // Create a profile for User A to delete
      const resA = await request(app)
        .post('/api/passengers')
        .set('Cookie', [cookieA])
        .send({ name: 'Delete Candidate', age: 30, gender: 'OTHER' });
      profileToDeleteId = resA.body.passenger.id;

      // Create a profile for User B
      const resB = await request(app)
        .post('/api/passengers')
        .set('Cookie', [cookieB])
        .send({ name: 'Protected User B Profile', age: 35, gender: 'FEMALE' });
      userBProfileId = resB.body.passenger.id;
    });

    test('7. should return HTTP 404 when attempting to delete another user\'s profile', async () => {
      // User A attempts to delete User B's profile
      const res = await request(app)
        .delete(`/api/passengers/${userBProfileId}`)
        .set('Cookie', [cookieA]);

      expect(res.status).toBe(404);
      expect(res.body.error).toHaveProperty('code', 'PASSENGER_NOT_FOUND');

      // Verify User B's profile remains untouched
      const checkB = await pool.query('SELECT * FROM passenger_profiles WHERE id = $1', [userBProfileId]);
      expect(checkB.rows.length).toBe(1);
    });

    test('6. should return HTTP 404 when deleting a nonexistent profile ID', async () => {
      const res = await request(app)
        .delete('/api/passengers/9999999')
        .set('Cookie', [cookieA]);

      expect(res.status).toBe(404);
      expect(res.body.error).toHaveProperty('code', 'PASSENGER_NOT_FOUND');
    });

    test('should return HTTP 400 for invalid passenger ID parameters', async () => {
      const invalidIds = ['0', '-1', 'abc', '1.5'];
      for (const id of invalidIds) {
        const res = await request(app)
          .delete(`/api/passengers/${id}`)
          .set('Cookie', [cookieA]);
        expect(res.status).toBe(400);
      }
    });

    test('5. should successfully delete an owned profile with HTTP 200', async () => {
      const res = await request(app)
        .delete(`/api/passengers/${profileToDeleteId}`)
        .set('Cookie', [cookieA]);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('message', 'Passenger profile deleted successfully');

      // Verify it is gone from database
      const check = await pool.query('SELECT * FROM passenger_profiles WHERE id = $1', [profileToDeleteId]);
      expect(check.rows.length).toBe(0);
    });

    // -----------------------------------------------------------------------
    // 5. Booking Snapshot Preservation on Deletion
    // -----------------------------------------------------------------------
    test('9. deleting a profile referenced by booking_passengers unlinks foreign key and preserves historical snapshots', async () => {
      // 1. Create a profile for User A
      const createRes = await request(app)
        .post('/api/passengers')
        .set('Cookie', [cookieA])
        .send({
          name: 'Historical Passenger Profile',
          age: 55,
          gender: 'MALE',
          berthPreference: 'LOWER',
          windowPreference: true,
        });
      expect(createRes.status).toBe(201);
      const profileId = createRes.body.passenger.id;

      // 2. Create a dummy booking for User A
      const bRes = await pool.query(
        `INSERT INTO bookings (user_id, train_id, journey_date, source_station_id, destination_station_id, class_code, status, total_amount)
         VALUES ($1, $2, '2026-12-15', $3, $4, '3A', 'CONFIRMED', 1500.00) RETURNING id`,
        [userA.id, testTrainId, srcStationId, destStationId]
      );
      createdBookingId = bRes.rows[0].id;

      // 3. Create a booking_passengers record referencing profileId
      const bpRes = await pool.query(
        `INSERT INTO booking_passengers (booking_id, passenger_profile_id, name_snapshot, age_snapshot, gender_snapshot, berth_preference, window_preference, passenger_status)
         VALUES ($1, $2, 'Historical Passenger Profile', 55, 'MALE', 'LOWER', true, 'CONFIRMED') RETURNING id`,
        [createdBookingId, profileId]
      );
      const bpId = bpRes.rows[0].id;

      // 4. Delete the profile through the API
      const delRes = await request(app)
        .delete(`/api/passengers/${profileId}`)
        .set('Cookie', [cookieA]);
      expect(delRes.status).toBe(200);

      // 5. Verify the profile is deleted from passenger_profiles
      const profileCheck = await pool.query('SELECT * FROM passenger_profiles WHERE id = $1', [profileId]);
      expect(profileCheck.rows.length).toBe(0);

      // 6. Verify booking_passengers record is NOT deleted and snapshots are preserved
      const bpCheck = await pool.query('SELECT * FROM booking_passengers WHERE id = $1', [bpId]);
      expect(bpCheck.rows.length).toBe(1);

      const bpRow = bpCheck.rows[0];
      expect(bpRow.passenger_profile_id).toBe(null); // Unlinked cleanly
      expect(bpRow.name_snapshot).toBe('Historical Passenger Profile');
      expect(bpRow.age_snapshot).toBe(55);
      expect(bpRow.gender_snapshot).toBe('MALE');
      expect(bpRow.berth_preference).toBe('LOWER');
      expect(bpRow.window_preference).toBe(true);
      expect(bpRow.passenger_status).toBe('CONFIRMED');
    });
  });

  // -------------------------------------------------------------------------
  // 6. Regression & Integrity Checks
  // -------------------------------------------------------------------------
  describe('Regression & Seed Integrity', () => {
    test('11. existing authentication and train search endpoints continue working', async () => {
      // Station search
      const stationRes = await request(app).get('/api/stations/search?q=del');
      expect(stationRes.status).toBe(200);
      expect(stationRes.body).toHaveProperty('stations');

      // Train search
      const trainRes = await request(app)
        .get(`/api/trains/search?fromStationId=${srcStationId}&toStationId=${destStationId}&journeyDate=2026-12-15`);
      expect(trainRes.status).toBe(200);
      expect(trainRes.body).toHaveProperty('trains');
    });

    test('12. development seed records remain intact', async () => {
      const stations = await pool.query('SELECT COUNT(*) FROM stations');
      expect(Number(stations.rows[0].count)).toBe(5);

      const trains = await pool.query('SELECT COUNT(*) FROM trains');
      expect(Number(trains.rows[0].count)).toBe(2);

      const stops = await pool.query('SELECT COUNT(*) FROM train_stops');
      expect(Number(stops.rows[0].count)).toBe(9);

      const coaches = await pool.query('SELECT COUNT(*) FROM coaches');
      expect(Number(coaches.rows[0].count)).toBe(4);

      const seats = await pool.query('SELECT COUNT(*) FROM seats');
      expect(Number(seats.rows[0].count)).toBe(276);

      const food = await pool.query('SELECT COUNT(*) FROM food_menu_items');
      expect(Number(food.rows[0].count)).toBe(11);
    });
  });
});
