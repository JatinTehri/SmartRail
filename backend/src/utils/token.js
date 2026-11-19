/**
 * token.js — JWT Token Utility
 *
 * Provides standalone functions to generate and verify JSON Web Tokens (JWT)
 * for user authentication.
 *
 * Architectural Rules:
 *   - Completely independent of Express routes, controllers, and req/res objects.
 *   - Does not store passwords, hashes, or unnecessary PII in the payload.
 *   - Uses the RFC 7519 'sub' (subject) claim to identify the authenticated user.
 *   - Enforces cryptographic verification of token signature and expiration.
 *   - Fails safely with clear errors if JWT_SECRET is unconfigured or token is invalid.
 */

'use strict';

const jwt = require('jsonwebtoken');

/**
 * Generates a signed JWT with the user's ID as the subject ('sub') claim.
 *
 * @param {string|number} userId - The unique identifier of the user (e.g. users.id)
 * @returns {string} The signed JWT string (Header.Payload.Signature)
 * @throws {Error} If JWT_SECRET is not configured or userId is invalid
 */
function generateToken(userId) {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET environment variable is not configured');
  }

  if (userId === undefined || userId === null || userId === '') {
    throw new Error('A valid user ID is required to generate a token');
  }

  const expiresIn = process.env.JWT_EXPIRES_IN || '7d';

  return jwt.sign({ sub: userId }, secret, { expiresIn });
}

/**
 * Verifies a JWT's signature and expiration, returning the decoded payload.
 *
 * @param {string} token - The raw JWT string from cookie or authorization header
 * @returns {object} The verified payload containing claims (e.g. sub, iat, exp)
 * @throws {Error} If JWT_SECRET is missing, token is missing, or verification fails
 */
function verifyToken(token) {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET environment variable is not configured');
  }

  if (!token || typeof token !== 'string') {
    throw new Error('A valid token string is required for verification');
  }

  return jwt.verify(token, secret);
}

module.exports = {
  generateToken,
  verifyToken,
};
