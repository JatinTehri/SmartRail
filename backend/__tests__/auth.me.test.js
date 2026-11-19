/**
 * auth.me.test.js — Integration Tests for Current User API & Auth Middleware
 *
 * Verifies:
 *   1. GET /api/auth/me with valid JWT cookie returns HTTP 200 and profile
 *   2. Response contains the correct authenticated user's profile
 *   3. Missing authentication cookie is rejected with HTTP 401 Unauthorized
 *   4. Tampered JWT signature is rejected with HTTP 401
 *   5. Expired JWT is rejected with HTTP 401
 *   6. Malformed JWT string is rejected with HTTP 401
 *   7. Valid token for a non-existent/deleted user is rejected with HTTP 401
 *   8. Sensitive data (password_hash, internal secrets) is excluded from response
 *   9. Clean teardown of disposable test users preserving development seed data
 */

'use strict';

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../src/app');
const pool = require('../src/config/db');
const { generateToken } = require('../src/utils/token');

describe('GET /api/auth/me (Auth Middleware & Current User)', () => {
  const TEST_EMAIL_PREFIX = 'test.me.';
  const generateEmail = () => `${TEST_EMAIL_PREFIX}${Date.now()}.${Math.random().toString(36).slice(2, 7)}@example.com`;

  let testUser;
  let authCookie;

  // Cleanup helper targeting only this suite's test users
  const cleanupTestUsers = async () => {
    await pool.query("DELETE FROM users WHERE email LIKE $1", [`${TEST_EMAIL_PREFIX}%`]);
  };

  beforeAll(async () => {
    await cleanupTestUsers();

    const email = generateEmail();
    const password = 'StrongPassword123';

    // 1. Register a test user
    const registerRes = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Meera Deshmukh',
        email,
        phone: '9822334455',
        password,
      });

    expect(registerRes.status).toBe(201);
    testUser = registerRes.body.user;

    // 2. Log in to acquire a real Set-Cookie header
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email, password });

    expect(loginRes.status).toBe(200);
    expect(loginRes.headers['set-cookie']).toBeDefined();

    // Extract the raw cookie string for subsequent requests
    authCookie = loginRes.headers['set-cookie'][0];
  });

  afterAll(async () => {
    await cleanupTestUsers();
    await pool.end();
  });

  // -------------------------------------------------------------------------
  // 1. Successful Authentication & Profile Retrieval
  // -------------------------------------------------------------------------
  test('1. should return HTTP 200 with sanitized user profile when valid cookie is provided', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Cookie', [authCookie]);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('user');

    const user = res.body.user;
    expect(user.id).toBe(testUser.id);
    expect(user.name).toBe('Meera Deshmukh');
    expect(user.email).toBe(testUser.email);
    expect(user.role).toBe('USER');

    // Security: sensitive data must NOT be present
    expect(user).not.toHaveProperty('password');
    expect(user).not.toHaveProperty('password_hash');
    expect(res.body).not.toHaveProperty('token');
  });

  // -------------------------------------------------------------------------
  // 2. Missing Authentication Cookie
  // -------------------------------------------------------------------------
  test('2. should reject request with HTTP 401 when no auth cookie is provided', async () => {
    const res = await request(app)
      .get('/api/auth/me');

    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
    expect(res.body.error).toEqual({
      code: 'UNAUTHORIZED',
      message: 'Authentication required',
    });
  });

  // -------------------------------------------------------------------------
  // 3. Tampered Token
  // -------------------------------------------------------------------------
  test('3. should reject request with HTTP 401 when token has been tampered with', async () => {
    const validToken = generateToken(testUser.id);
    const parts = validToken.split('.');
    const tamperedToken = `${parts[0]}.${parts[1]}.tampered_signature_bytes`;

    const res = await request(app)
      .get('/api/auth/me')
      .set('Cookie', [`smartrail_token=${tamperedToken}`]);

    expect(res.status).toBe(401);
    expect(res.body.error).toEqual({
      code: 'UNAUTHORIZED',
      message: 'Invalid or expired token',
    });
  });

  // -------------------------------------------------------------------------
  // 4. Expired Token
  // -------------------------------------------------------------------------
  test('4. should reject request with HTTP 401 when token is expired', async () => {
    const expiredToken = jwt.sign(
      { sub: testUser.id },
      process.env.JWT_SECRET,
      { expiresIn: '-10s' }
    );

    const res = await request(app)
      .get('/api/auth/me')
      .set('Cookie', [`smartrail_token=${expiredToken}`]);

    expect(res.status).toBe(401);
    expect(res.body.error).toEqual({
      code: 'UNAUTHORIZED',
      message: 'Invalid or expired token',
    });
  });

  // -------------------------------------------------------------------------
  // 5. Malformed Token
  // -------------------------------------------------------------------------
  test('5. should reject request with HTTP 401 when token is malformed', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Cookie', ['smartrail_token=not-a-valid-jwt-token-string']);

    expect(res.status).toBe(401);
    expect(res.body.error).toEqual({
      code: 'UNAUTHORIZED',
      message: 'Invalid or expired token',
    });
  });

  // -------------------------------------------------------------------------
  // 6. Valid Token for Non-Existent User
  // -------------------------------------------------------------------------
  test('6. should reject request with HTTP 401 when token is valid but user does not exist in DB', async () => {
    const nonExistentUserId = 99999999;
    const tokenForNonExistentUser = generateToken(nonExistentUserId);

    const res = await request(app)
      .get('/api/auth/me')
      .set('Cookie', [`smartrail_token=${tokenForNonExistentUser}`]);

    expect(res.status).toBe(401);
    expect(res.body.error).toHaveProperty('code', 'UNAUTHORIZED');
    expect(res.body.error.message).toMatch(/not found|deactivated/i);
  });
});
