/**
 * token.test.js — Unit Tests for JWT Token Utility
 *
 * Verifies:
 *   1. Successful token generation and verification
 *   2. Correct user ID preserved in the 'sub' claim
 *   3. Rejection of tampered tokens (altered payload or signature)
 *   4. Rejection of expired tokens
 *   5. Rejection of tokens signed with an invalid / mismatched secret
 *   6. Safe failure when JWT_SECRET is missing or unconfigured
 */

'use strict';

const jwt = require('jsonwebtoken');
const { generateToken, verifyToken } = require('../src/utils/token');

describe('JWT Token Utility (src/utils/token.js)', () => {
  const TEST_SECRET = 'test_jwt_secret_key_for_smartrail_unit_tests_32chars';
  let originalSecret;
  let originalExpiresIn;

  beforeAll(() => {
    originalSecret = process.env.JWT_SECRET;
    originalExpiresIn = process.env.JWT_EXPIRES_IN;
  });

  beforeEach(() => {
    process.env.JWT_SECRET = TEST_SECRET;
    process.env.JWT_EXPIRES_IN = '1h';
  });

  afterAll(() => {
    process.env.JWT_SECRET = originalSecret;
    process.env.JWT_EXPIRES_IN = originalExpiresIn;
  });

  // -------------------------------------------------------------------------
  // 1. Successful token generation and verification
  // -------------------------------------------------------------------------
  test('1. should successfully generate and verify a valid JWT token', () => {
    const userId = 101;
    const token = generateToken(userId);

    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(0);

    // A valid JWT consists of three base64url segments separated by dots
    const parts = token.split('.');
    expect(parts).toHaveLength(3);

    const decoded = verifyToken(token);
    expect(decoded).toBeDefined();
    expect(typeof decoded).toBe('object');
  });

  // -------------------------------------------------------------------------
  // 2. Correct user ID in the verified payload
  // -------------------------------------------------------------------------
  test('2. should preserve the exact user ID in the JWT "sub" claim and include standard claims', () => {
    const numericUserId = 42;
    const numericToken = generateToken(numericUserId);
    const decodedNumeric = verifyToken(numericToken);

    expect(decodedNumeric.sub).toBe(numericUserId);
    expect(decodedNumeric).toHaveProperty('iat');
    expect(decodedNumeric).toHaveProperty('exp');
    expect(decodedNumeric.exp).toBeGreaterThan(decodedNumeric.iat);

    const stringUserId = 'usr_998877';
    const stringToken = generateToken(stringUserId);
    const decodedString = verifyToken(stringToken);

    expect(decodedString.sub).toBe(stringUserId);
  });

  // -------------------------------------------------------------------------
  // 3. Rejection of a tampered token
  // -------------------------------------------------------------------------
  test('3. should reject a tampered token where payload or signature was altered', () => {
    const token = generateToken(1);
    const parts = token.split('.');

    // Tamper with the signature portion (third part)
    const tamperedSignature = parts[0] + '.' + parts[1] + '.tampered_signature_bytes';
    expect(() => verifyToken(tamperedSignature)).toThrow();

    // Tamper with the payload (attempting privilege escalation or claim mutation)
    const forgedPayload = Buffer.from(JSON.stringify({ sub: 999, role: 'ADMIN' })).toString('base64url');
    const tamperedPayload = parts[0] + '.' + forgedPayload + '.' + parts[2];
    expect(() => verifyToken(tamperedPayload)).toThrow();
  });

  // -------------------------------------------------------------------------
  // 4. Rejection of an expired token
  // -------------------------------------------------------------------------
  test('4. should reject an expired token', () => {
    // Generate a token that expired 10 seconds ago
    const expiredToken = jwt.sign(
      { sub: 55 },
      TEST_SECRET,
      { expiresIn: '-10s' }
    );

    expect(() => verifyToken(expiredToken)).toThrow(jwt.TokenExpiredError);
  });

  // -------------------------------------------------------------------------
  // 5. Rejection when the wrong secret is used
  // -------------------------------------------------------------------------
  test('5. should reject a token signed with a different or wrong secret', () => {
    const wrongSecret = 'completely_different_unauthorized_secret_key';
    const foreignToken = jwt.sign({ sub: 77 }, wrongSecret, { expiresIn: '1h' });

    // Verifying foreignToken against TEST_SECRET must throw JsonWebTokenError
    expect(() => verifyToken(foreignToken)).toThrow(jwt.JsonWebTokenError);
  });

  // -------------------------------------------------------------------------
  // 6. Safe failure when JWT_SECRET is missing
  // -------------------------------------------------------------------------
  test('6. should fail safely when JWT_SECRET is unconfigured or empty', () => {
    const validToken = generateToken(1);

    delete process.env.JWT_SECRET;

    expect(() => generateToken(1)).toThrow('JWT_SECRET environment variable is not configured');
    expect(() => verifyToken(validToken)).toThrow('JWT_SECRET environment variable is not configured');
  });

  // -------------------------------------------------------------------------
  // Edge Case: Missing User ID
  // -------------------------------------------------------------------------
  test('should throw an error when generating a token without a valid user ID', () => {
    expect(() => generateToken(null)).toThrow('A valid user ID is required');
    expect(() => generateToken(undefined)).toThrow('A valid user ID is required');
    expect(() => generateToken('')).toThrow('A valid user ID is required');
  });
});
