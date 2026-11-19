/**
 * auth.register.test.js — Integration Tests for User Registration API
 *
 * Verifies:
 *   1. Successful registration returns 201 Created with sanitized user object
 *   2. Password is stored as a bcrypt hash in PostgreSQL, never plain text
 *   3. Password hash is omitted from API response
 *   4. Validation errors (HTTP 400) on missing name, invalid email, short password
 *   5. Validation error (HTTP 400) when attempting to inject an ADMIN role
 *   6. Duplicate email rejection (HTTP 409 Conflict)
 *   7. Safe cleanup of disposable test records (preserving seed data)
 */

'use strict';

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const request = require('supertest');
const bcrypt = require('bcryptjs');
const app = require('../src/app');
const pool = require('../src/config/db');

describe('POST /api/auth/register', () => {
  const TEST_EMAIL_PREFIX = 'test.reg.';
  const generateEmail = () => `${TEST_EMAIL_PREFIX}${Date.now()}.${Math.random().toString(36).slice(2, 7)}@example.com`;

  // Clean up any test users created during the run
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
  // 1. Successful Registration
  // -------------------------------------------------------------------------
  test('1. should register a new user successfully and return HTTP 201 with sanitized user', async () => {
    const email = generateEmail();
    const payload = {
      name: 'Rohan Verma',
      email,
      phone: '9876543210',
      password: 'StrongPassword123',
    };

    const res = await request(app)
      .post('/api/auth/register')
      .send(payload);

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('message', 'Registration successful');
    expect(res.body).toHaveProperty('user');

    const user = res.body.user;
    expect(user).toHaveProperty('id');
    expect(user.name).toBe('Rohan Verma');
    expect(user.email).toBe(email);
    expect(user.role).toBe('USER');

    // 2. Security: password_hash must be completely omitted from the response
    expect(user).not.toHaveProperty('password');
    expect(user).not.toHaveProperty('password_hash');

    // 3. Database Check: Password in database must be a valid bcrypt hash
    const dbResult = await pool.query('SELECT password_hash FROM users WHERE id = $1', [user.id]);
    expect(dbResult.rows).toHaveLength(1);
    const storedHash = dbResult.rows[0].password_hash;

    // bcrypt hash format: $2a$ or $2b$ with 10 salt rounds
    expect(storedHash.startsWith('$2a$10$') || storedHash.startsWith('$2b$10$')).toBe(true);
    expect(storedHash).not.toBe(payload.password);

    // Verify hash matches the original plain password
    const isMatch = await bcrypt.compare(payload.password, storedHash);
    expect(isMatch).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 4. Duplicate Email (HTTP 409 Conflict)
  // -------------------------------------------------------------------------
  test('2. should reject duplicate email registration with HTTP 409 Conflict', async () => {
    const email = generateEmail();
    const payload = {
      name: 'Duplicate Test User',
      email,
      password: 'StrongPassword123',
    };

    // First registration: should succeed
    const firstRes = await request(app)
      .post('/api/auth/register')
      .send(payload);
    expect(firstRes.status).toBe(201);

    // Second registration with same email: should return 409
    const duplicateRes = await request(app)
      .post('/api/auth/register')
      .send(payload);

    expect(duplicateRes.status).toBe(409);
    expect(duplicateRes.body).toHaveProperty('error');
    expect(duplicateRes.body.error).toHaveProperty('code', 'EMAIL_EXISTS');
    expect(duplicateRes.body.error.message).toMatch(/already registered/i);
  });

  // -------------------------------------------------------------------------
  // 5. Input Validation Errors (HTTP 400 Bad Request)
  // -------------------------------------------------------------------------
  test('3. should return HTTP 400 when name is missing or empty', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        name: '   ',
        email: generateEmail(),
        password: 'StrongPassword123',
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toHaveProperty('code', 'VALIDATION_ERROR');
    expect(res.body.error.message).toMatch(/name/i);
  });

  test('4. should return HTTP 400 when email format is invalid', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Invalid Email User',
        email: 'not-a-valid-email',
        password: 'StrongPassword123',
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toHaveProperty('code', 'VALIDATION_ERROR');
    expect(res.body.error.message).toMatch(/email/i);
  });

  test('5. should return HTTP 400 when password is under 8 characters', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Short Password User',
        email: generateEmail(),
        password: 'short',
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toHaveProperty('code', 'VALIDATION_ERROR');
    expect(res.body.error.message).toMatch(/at least 8 characters/i);
  });

  test('6. should return HTTP 400 when attempting to register as ADMIN', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Privilege Escalation Attempt',
        email: generateEmail(),
        password: 'StrongPassword123',
        role: 'ADMIN',
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toHaveProperty('code', 'VALIDATION_ERROR');
    expect(res.body.error.message).toMatch(/role/i);
  });
});
