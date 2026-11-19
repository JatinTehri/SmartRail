/**
 * auth.js — Authentication Middleware
 *
 * Extracts and verifies the JWT from HTTP-only cookie 'smartrail_token'.
 * Attaches authenticated user identity to req.user.
 */

'use strict';

const { verifyToken } = require('../utils/token');
const AppError = require('../errors/AppError');

/**
 * Middleware that authenticates incoming requests using the 'smartrail_token' cookie.
 *
 * Rules:
 *   1. Reads 'smartrail_token' from req.cookies (parsed by cookie-parser).
 *   2. Rejects missing cookies with HTTP 401 Unauthorized.
 *   3. Verifies the cryptographic signature and expiration via verifyToken().
 *   4. Rejects tampered, expired, or malformed tokens with HTTP 401.
 *   5. Attaches { id: decoded.sub } to req.user for downstream handlers.
 *   6. Never leaks internal verification details or secret keys.
 */
function authenticate(req, _res, next) {
  const token = req.cookies && req.cookies.smartrail_token;

  if (!token) {
    return next(new AppError('Authentication required', 401, 'UNAUTHORIZED'));
  }

  try {
    const decoded = verifyToken(token);

    if (!decoded || !decoded.sub) {
      return next(new AppError('Invalid or expired token', 401, 'UNAUTHORIZED'));
    }

    // Attach minimal identity claim to request object
    req.user = {
      id: decoded.sub,
    };

    next();
  } catch (err) {
    // Return a clean, uniform 401 response without exposing internal library errors
    return next(new AppError('Invalid or expired token', 401, 'UNAUTHORIZED'));
  }
}

module.exports = {
  authenticate,
};
