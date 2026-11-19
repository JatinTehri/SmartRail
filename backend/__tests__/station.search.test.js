/**
 * station.search.test.js — Integration Tests for Station Search API
 *
 * Verifies:
 *   1. Search by station code (e.g. 'NDLS') returns exact match first
 *   2. Search by station name (e.g. 'Kanpur Central')
 *   3. Search by city (e.g. 'Kolkata')
 *   4. Case-insensitive matching ('ndls', 'NdLs')
 *   5. Partial substring matching ('del')
 *   6. Missing query parameter returns HTTP 400 Bad Request
 *   7. Empty or whitespace-only query returns HTTP 400
 *   8. Query exceeding 100 characters returns HTTP 400
 *   9. SQL injection-like queries are safely handled with parameterized inputs
 *   10. Wildcard characters '%' and '_' are escaped and do not return all records
 *   11. Result limit parameter is respected
 *   12. Response structure strictly matches docs/API.md: { stations: [...] }
 *   13. Seed records are preserved intact (no database mutations)
 */

'use strict';

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const request = require('supertest');
const app = require('../src/app');
const pool = require('../src/config/db');

describe('GET /api/stations/search', () => {
  afterAll(async () => {
    await pool.end();
  });

  // -------------------------------------------------------------------------
  // 1. Search by Station Code
  // -------------------------------------------------------------------------
  test('1. should search by station code and rank exact code match first', async () => {
    const res = await request(app)
      .get('/api/stations/search?q=NDLS');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('stations');
    expect(Array.isArray(res.body.stations)).toBe(true);
    expect(res.body.stations.length).toBeGreaterThan(0);

    const firstMatch = res.body.stations[0];
    expect(firstMatch.code).toBe('NDLS');
    expect(firstMatch.name).toBe('New Delhi');
    expect(firstMatch.city).toBe('New Delhi');
    expect(firstMatch.state).toBe('Delhi');
    expect(typeof firstMatch.id).toBe('number');
  });

  // -------------------------------------------------------------------------
  // 2. Search by Station Name
  // -------------------------------------------------------------------------
  test('2. should search by station name (e.g. "Kanpur")', async () => {
    const res = await request(app)
      .get('/api/stations/search?q=Kanpur');

    expect(res.status).toBe(200);
    expect(res.body.stations.length).toBeGreaterThan(0);

    const found = res.body.stations.find((s) => s.code === 'CNB');
    expect(found).toBeDefined();
    expect(found.name).toBe('Kanpur Central');
  });

  // -------------------------------------------------------------------------
  // 3. Search by City
  // -------------------------------------------------------------------------
  test('3. should search by city (e.g. "Kolkata" for Howrah Junction)', async () => {
    const res = await request(app)
      .get('/api/stations/search?q=Kolkata');

    expect(res.status).toBe(200);
    expect(res.body.stations.length).toBeGreaterThan(0);

    const found = res.body.stations.find((s) => s.code === 'HWH');
    expect(found).toBeDefined();
    expect(found.city).toBe('Kolkata');
    expect(found.name).toBe('Howrah Junction');
  });

  // -------------------------------------------------------------------------
  // 4. Case-Insensitive Matching
  // -------------------------------------------------------------------------
  test('4. should perform case-insensitive matching ("ndls", "NdLs")', async () => {
    const lowerRes = await request(app).get('/api/stations/search?q=ndls');
    const mixedRes = await request(app).get('/api/stations/search?q=NdLs');

    expect(lowerRes.status).toBe(200);
    expect(mixedRes.status).toBe(200);
    expect(lowerRes.body.stations[0].code).toBe('NDLS');
    expect(mixedRes.body.stations[0].code).toBe('NDLS');
  });

  // -------------------------------------------------------------------------
  // 5. Partial Substring Matching
  // -------------------------------------------------------------------------
  test('5. should support partial substring matching (e.g. "del" for New Delhi)', async () => {
    const res = await request(app).get('/api/stations/search?q=del');

    expect(res.status).toBe(200);
    const found = res.body.stations.find((s) => s.code === 'NDLS');
    expect(found).toBeDefined();
    expect(found.name).toContain('Delhi');
  });

  // -------------------------------------------------------------------------
  // 6. Missing Query Parameter
  // -------------------------------------------------------------------------
  test('6. should return HTTP 400 when "q" parameter is missing', async () => {
    const res = await request(app).get('/api/stations/search');

    expect(res.status).toBe(400);
    expect(res.body.error).toHaveProperty('code', 'VALIDATION_ERROR');
    expect(res.body.error.message).toMatch(/required/i);
  });

  // -------------------------------------------------------------------------
  // 7. Empty or Whitespace Query
  // -------------------------------------------------------------------------
  test('7. should return HTTP 400 when "q" is empty or whitespace-only', async () => {
    const emptyRes = await request(app).get('/api/stations/search?q=');
    const spaceRes = await request(app).get('/api/stations/search?q=%20%20%20');

    expect(emptyRes.status).toBe(400);
    expect(emptyRes.body.error.code).toBe('VALIDATION_ERROR');
    expect(spaceRes.status).toBe(400);
    expect(spaceRes.body.error.code).toBe('VALIDATION_ERROR');
  });

  // -------------------------------------------------------------------------
  // 8. Query Exceeding Max Length
  // -------------------------------------------------------------------------
  test('8. should return HTTP 400 when "q" exceeds 100 characters', async () => {
    const longQuery = 'a'.repeat(101);
    const res = await request(app).get(`/api/stations/search?q=${longQuery}`);

    expect(res.status).toBe(400);
    expect(res.body.error).toHaveProperty('code', 'VALIDATION_ERROR');
    expect(res.body.error.message).toMatch(/cannot exceed 100 characters/i);
  });

  // -------------------------------------------------------------------------
  // 9. SQL Injection-Like Input
  // -------------------------------------------------------------------------
  test('9. should handle SQL injection-like inputs safely via parameterized queries', async () => {
    const injectionQueries = [
      "' OR '1'='1",
      "'; DROP TABLE stations; --",
      "UNION SELECT * FROM users --",
    ];

    for (const sqlAttempt of injectionQueries) {
      const res = await request(app)
        .get('/api/stations/search')
        .query({ q: sqlAttempt });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('stations');
      expect(res.body.stations).toEqual([]);
    }

    // Verify stations table is completely intact
    const verifyDb = await pool.query('SELECT COUNT(*) FROM stations');
    expect(Number(verifyDb.rows[0].count)).toBe(5);
  });

  // -------------------------------------------------------------------------
  // 10. Wildcard Character Escaping (% and _)
  // -------------------------------------------------------------------------
  test('10. should escape wildcards % and _ so they are not treated as unescaped wildcards', async () => {
    // Searching '%' should NOT return all stations in the database
    const percentRes = await request(app).get('/api/stations/search?q=%25');
    expect(percentRes.status).toBe(200);
    expect(percentRes.body.stations).toEqual([]);

    // Searching '_' should NOT match single characters across all stations
    const underscoreRes = await request(app).get('/api/stations/search?q=_');
    expect(underscoreRes.status).toBe(200);
    expect(underscoreRes.body.stations).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // 11. Result Limiting
  // -------------------------------------------------------------------------
  test('11. should respect the limit query parameter', async () => {
    const res = await request(app).get('/api/stations/search?q=a&limit=2');

    expect(res.status).toBe(200);
    expect(res.body.stations.length).toBeLessThanOrEqual(2);
  });

  // -------------------------------------------------------------------------
  // 12. Response Formatting Matching docs/API.md
  // -------------------------------------------------------------------------
  test('12. should format response matching docs/API.md specification', async () => {
    const res = await request(app).get('/api/stations/search?q=PRYJ');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('stations');
    const station = res.body.stations[0];

    // Must match the exact documented keys: id, code, name, city, state
    expect(station).toEqual({
      id: expect.any(Number),
      code: 'PRYJ',
      name: 'Prayagraj Junction',
      city: 'Prayagraj',
      state: 'Uttar Pradesh',
    });
  });
});
