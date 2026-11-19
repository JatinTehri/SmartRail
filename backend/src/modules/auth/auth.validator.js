/**
 * auth.validator.js — Input Validation Middleware for Authentication
 *
 * Validates and sanitizes incoming request payloads before they reach controllers.
 * Uses centralized AppError to return HTTP 400 with machine-readable error codes.
 */

'use strict';

const AppError = require('../../errors/AppError');

// Standard RFC 5322 simplified email regex
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Validates the registration request body.
 *
 * Requirements:
 *   - name: required string, non-empty, max 100 chars
 *   - email: required string, valid email format, max 150 chars
 *   - password: required string, min 8 chars, max 100 chars
 *   - phone: optional string, max 20 chars
 *   - role: must NOT be set to 'ADMIN' (public registration is USER only)
 */
function validateRegister(req, _res, next) {
  const { name, email, password, phone, role } = req.body;

  // 1. Validate name
  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return next(new AppError('Full name is required', 400, 'VALIDATION_ERROR'));
  }
  if (name.trim().length > 100) {
    return next(new AppError('Name cannot exceed 100 characters', 400, 'VALIDATION_ERROR'));
  }

  // 2. Validate email
  if (!email || typeof email !== 'string' || email.trim().length === 0) {
    return next(new AppError('Email address is required', 400, 'VALIDATION_ERROR'));
  }
  const cleanEmail = email.trim().toLowerCase();
  if (!EMAIL_REGEX.test(cleanEmail)) {
    return next(new AppError('Invalid email address format', 400, 'VALIDATION_ERROR'));
  }
  if (cleanEmail.length > 150) {
    return next(new AppError('Email cannot exceed 150 characters', 400, 'VALIDATION_ERROR'));
  }

  // 3. Validate password
  if (!password || typeof password !== 'string') {
    return next(new AppError('Password is required', 400, 'VALIDATION_ERROR'));
  }
  if (password.length < 8) {
    return next(new AppError('Password must be at least 8 characters long', 400, 'VALIDATION_ERROR'));
  }
  if (password.length > 100) {
    return next(new AppError('Password cannot exceed 100 characters', 400, 'VALIDATION_ERROR'));
  }

  // 4. Validate phone (optional)
  if (phone !== undefined && phone !== null && phone !== '') {
    if (typeof phone !== 'string' || phone.trim().length > 20) {
      return next(new AppError('Phone number cannot exceed 20 characters', 400, 'VALIDATION_ERROR'));
    }
  }

  // 5. Prevent role escalation from registration payload
  if (role && role !== 'USER') {
    return next(new AppError('Invalid role specified for registration', 400, 'VALIDATION_ERROR'));
  }

  // Sanitize cleaned fields onto req.body
  req.body.name = name.trim();
  req.body.email = cleanEmail;
  req.body.phone = phone && typeof phone === 'string' && phone.trim() !== '' ? phone.trim() : null;

  next();
}

/**
 * Validates the login request body.
 *
 * Requirements:
 *   - email: required string, non-empty, valid email format
 *   - password: required string, non-empty
 */
function validateLogin(req, _res, next) {
  const { email, password } = req.body;

  // 1. Validate email
  if (!email || typeof email !== 'string' || email.trim().length === 0) {
    return next(new AppError('Email address is required', 400, 'VALIDATION_ERROR'));
  }
  const cleanEmail = email.trim().toLowerCase();
  if (!EMAIL_REGEX.test(cleanEmail)) {
    return next(new AppError('Invalid email address format', 400, 'VALIDATION_ERROR'));
  }

  // 2. Validate password
  if (!password || typeof password !== 'string' || password.length === 0) {
    return next(new AppError('Password is required', 400, 'VALIDATION_ERROR'));
  }

  // Sanitize cleaned fields
  req.body.email = cleanEmail;
  next();
}

module.exports = {
  validateRegister,
  validateLogin,
};
