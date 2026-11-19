/**
 * auth.login.test.js — Integration Tests for User Login API
 *
 * Verifies:
 *   1. Successful login with valid credentials (HTTP 200 OK)
 *   2. Correct response structure matching docs/API.md
 *   3. Presence and security attributes of the 'smartrail_token' Set-Cookie header
 *   4. HTTP-only flag, correct cookie path, and expiration
 *   5. Authentication failure for unknown email (HTTP 401 Unauthorized)
 *   6. Authentication failure for incorrect password (HTTP 401 Unauthorized)
 *   7. Uniform 401 response shape to prevent user enumeration
 *   8. Validation errors on missing email or missing password (HTTP 400)
 *   9. Strict exclusion of password_hash and raw JWT from JSON response body
 *   10. Clean teardown of disposable test users (preserving development seed data)
 */

'use strict';

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const request = require('supertest');
const app = require('../src/app');
const pool = require('../src/config/db');

describe('POST /api/auth/login', () => {
  const TEST_EMAIL_PREFIX = 'test.login.';
  const generateEmail = () => `${TEST_EMAIL_PREFIX}${Date.now()}.${Math.random().toString(36).slice(2, 7)}@example.com`;

  const validPassword = 'SecretPassword123';
  let registeredUser;

  // Cleanup helper targeting only this suite's test users
  const cleanupTestUsers = async () => {
    await pool.query("DELETE FROM users WHERE email LIKE $1", [`${TEST_EMAIL_PREFIX}%`]);
  };

  beforeAll(async () => {
    await cleanupTestUsers();

    // Register a reusable test user for login tests
    const email = generateEmail();
    const registerRes = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Aarav Patel',
        email,
        phone: '9811223344',
        password: validPassword,
      });

    expect(registerRes.status).toBe(201);
    registeredUser = registerRes.body.user;
  });

  afterAll(async () => {
    await cleanupTestUsers();
    await pool.end();
  });

  // -------------------------------------------------------------------------
  // 1. Successful Login
  // -------------------------------------------------------------------------
  test('1. should authenticate successfully with valid credentials and return HTTP 200', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({
        email: registeredUser.email,
        password: validPassword,
      });

    // HTTP status and basic shape
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('message', 'Login successful');
    expect(res.body).toHaveProperty('user');

    // Sanitized user object
    const user = res.body.user;
    expect(user.id).toBe(registeredUser.id);
    expect(user.name).toBe('Aarav Patel');
    expect(user.email).toBe(registeredUser.email);
    expect(user.role).toBe('USER');

    // Security: sensitive data must NOT be in JSON response
    expect(user).not.toHaveProperty('password');
    expect(user).not.toHaveProperty('password_hash');
    expect(res.body).not.toHaveProperty('token');
    expect(res.body).not.toHaveProperty('jwt');
  });

  // -------------------------------------------------------------------------
  // 2. Cookie Header Attributes
  // -------------------------------------------------------------------------
  test('2. should set the "smartrail_token" cookie with HttpOnly, correct Path, and SameSite attributes', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({
        email: registeredUser.email,
        password: validPassword,
      });

    expect(res.status).toBe(200);
    expect(res.headers).toHaveProperty('set-cookie');

    const cookies = res.headers['set-cookie'];
    expect(Array.isArray(cookies)).toBe(true);
    expect(cookies.length).toBeGreaterThan(0);

    const tokenCookie = cookies.find((c) => c.startsWith('smartrail_token='));
    expect(tokenCookie).toBeDefined();

    // Verify token cookie is HttpOnly (JavaScript cannot read it)
    expect(tokenCookie).toMatch(/HttpOnly/i);

    // Verify cookie path is root
    expect(tokenCookie).toMatch(/Path=\//i);

    // Verify SameSite is set
    expect(tokenCookie).toMatch(/SameSite=Lax/i);

    // Verify Max-Age / Expires is set
    expect(tokenCookie).toMatch(/(Max-Age|Expires)=/i);
  });

  // -------------------------------------------------------------------------
  // 3. Authentication Failures & Enumeration Prevention
  // -------------------------------------------------------------------------
  test('3. should return HTTP 401 with identical error responses for unknown email and wrong password', async () => {
    // A. Non-existent email
    const unknownEmailRes = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'nonexistent.user.999@example.com',
        password: validPassword,
      });

    expect(unknownEmailRes.status).toBe(401);
    expect(unknownEmailRes.body).toHaveProperty('error');
    expect(unknownEmailRes.body.error).toEqual({
      code: 'INVALID_CREDENTIALS',
      message: 'Invalid email or password',
    });
    // No auth cookie should be issued on failure
    expect(unknownEmailRes.headers['set-cookie']).toBeUndefined();

    // B. Existing email with incorrect password
    const wrongPasswordRes = await request(app)
      .post('/api/auth/login')
      .send({
        email: registeredUser.email,
        password: 'CompletelyWrongPassword!',
      });

    expect(wrongPasswordRes.status).toBe(401);
    expect(wrongPasswordRes.body).toHaveProperty('error');
    expect(wrongPasswordRes.body.error).toEqual({
      code: 'INVALID_CREDENTIALS',
      message: 'Invalid email or password',
    });
    expect(wrongPasswordRes.headers['set-cookie']).toBeUndefined();

    // C. Anti-Enumeration: Both responses must be identical
    expect(unknownEmailRes.body).toEqual(wrongPasswordRes.body);
  });

  // -------------------------------------------------------------------------
  // 4. Input Validation (HTTP 400 Bad Request)
  // -------------------------------------------------------------------------
  test('4. should return HTTP 400 when email is missing or empty', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({
        email: '   ',
        password: validPassword,
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toHaveProperty('code', 'VALIDATION_ERROR');
    expect(res.body.error.message).toMatch(/email/i);
  });

  test('5. should return HTTP 400 when email format is invalid', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'not-an-email',
        password: validPassword,
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toHaveProperty('code', 'VALIDATION_ERROR');
    expect(res.body.error.message).toMatch(/email.*format/i);
  });

  test('6. should return HTTP 400 when password is missing or empty', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({
        email: registeredUser.email,
        password: '',
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toHaveProperty('code', 'VALIDATION_ERROR');
    expect(res.body.error.message).toMatch(/password/i);
  });
});
