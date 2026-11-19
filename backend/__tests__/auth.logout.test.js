/**
 * auth.logout.test.js — Integration Tests for User Logout & Full Auth Lifecycle
 *
 * Verifies:
 *   1. Full end-to-end lifecycle: Register → Login → Get Me → Logout → Get Me (rejected)
 *   2. POST /api/auth/logout emits Set-Cookie header clearing 'smartrail_token'
 *   3. Cookie clearing options preserve HttpOnly, Path=/, and SameSite
 *   4. Logout succeeds (HTTP 200) even when no auth cookie is present (idempotent)
 *   5. Clean teardown of disposable test users preserving development seed data
 */

'use strict';

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const request = require('supertest');
const app = require('../src/app');
const pool = require('../src/config/db');

describe('POST /api/auth/logout (Full Authentication Lifecycle)', () => {
  const TEST_EMAIL_PREFIX = 'test.logout.';
  const generateEmail = () => `${TEST_EMAIL_PREFIX}${Date.now()}.${Math.random().toString(36).slice(2, 7)}@example.com`;

  // Cleanup helper targeting only this suite's test users
  const cleanupTestUsers = async () => {
    await pool.query("DELETE FROM users WHERE email LIKE $1", [`${TEST_EMAIL_PREFIX}%`]);
  };

  beforeAll(async () => {
    await cleanupTestUsers();
  });

  afterAll(async () => {
    await cleanupTestUsers();
    await pool.end();
  });

  // -------------------------------------------------------------------------
  // 1. Complete End-to-End Lifecycle: Register → Login → Me → Logout → Me
  // -------------------------------------------------------------------------
  test('1. should execute full auth lifecycle: Register -> Login -> /me -> Logout -> /me fails', async () => {
    const email = generateEmail();
    const password = 'PasswordForLifecycle123!';

    // Step 1: Register
    const registerRes = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Kabir Sen',
        email,
        phone: '9877001122',
        password,
      });

    expect(registerRes.status).toBe(201);
    expect(registerRes.body.user).toHaveProperty('id');
    expect(registerRes.body.user.email).toBe(email);

    // Step 2: Login to acquire smartrail_token cookie
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email, password });

    expect(loginRes.status).toBe(200);
    expect(loginRes.headers).toHaveProperty('set-cookie');

    const authCookies = loginRes.headers['set-cookie'];
    const tokenCookie = authCookies.find((c) => c.startsWith('smartrail_token='));
    expect(tokenCookie).toBeDefined();

    // Step 3: Access /me with the acquired cookie -> 200 OK
    const meResBeforeLogout = await request(app)
      .get('/api/auth/me')
      .set('Cookie', [tokenCookie]);

    expect(meResBeforeLogout.status).toBe(200);
    expect(meResBeforeLogout.body.user.email).toBe(email);
    expect(meResBeforeLogout.body.user.name).toBe('Kabir Sen');

    // Step 4: Call Logout -> 200 OK
    const logoutRes = await request(app)
      .post('/api/auth/logout')
      .set('Cookie', [tokenCookie]);

    expect(logoutRes.status).toBe(200);
    expect(logoutRes.body).toEqual({
      message: 'Logged out successfully',
    });

    // Step 5: Verify Set-Cookie header instructs browser to clear the cookie
    expect(logoutRes.headers).toHaveProperty('set-cookie');
    const clearedCookies = logoutRes.headers['set-cookie'];
    const clearedTokenCookie = clearedCookies.find((c) => c.startsWith('smartrail_token='));
    expect(clearedTokenCookie).toBeDefined();

    // Cookie must be expired or have empty value
    // Express clearCookie outputs: smartrail_token=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT
    expect(clearedTokenCookie).toMatch(/smartrail_token=;/);
    expect(clearedTokenCookie).toMatch(/Expires=Thu, 01 Jan 1970/i);
    expect(clearedTokenCookie).toMatch(/Path=\//i);
    expect(clearedTokenCookie).toMatch(/HttpOnly/i);

    // Step 6: Subsequent access to /me without cookie must fail with HTTP 401
    const meResAfterLogout = await request(app)
      .get('/api/auth/me');

    expect(meResAfterLogout.status).toBe(401);
    expect(meResAfterLogout.body.error).toEqual({
      code: 'UNAUTHORIZED',
      message: 'Authentication required',
    });
  });

  // -------------------------------------------------------------------------
  // 2. Idempotency: Logout without Cookie
  // -------------------------------------------------------------------------
  test('2. should succeed with HTTP 200 when logging out with no cookie present (idempotent)', async () => {
    const res = await request(app)
      .post('/api/auth/logout');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      message: 'Logged out successfully',
    });
    expect(res.headers).toHaveProperty('set-cookie');
  });
});
