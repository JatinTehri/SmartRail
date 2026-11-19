/**
 * auth.controller.js — HTTP Controller for Authentication Routes
 *
 * Keeps controllers thin: delegates business logic to auth.service.js
 * and formats the HTTP response per docs/API.md.
 */

'use strict';

const authService = require('./auth.service');

/**
 * Handles user registration.
 *
 * POST /api/auth/register
 * Status: 201 Created
 */
async function register(req, res, next) {
  try {
    const { name, email, password, phone } = req.body;
    const user = await authService.registerUser({ name, email, password, phone });

    res.status(201).json({
      message: 'Registration successful',
      user,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Computes cookie maxAge in milliseconds from JWT_EXPIRES_IN (default: 7d).
 */
function getCookieMaxAge(expiresIn = process.env.JWT_EXPIRES_IN || '7d') {
  if (typeof expiresIn === 'number') return expiresIn;
  const match = String(expiresIn).match(/^(\d+)([dhms])?$/i);
  if (!match) return 7 * 24 * 60 * 60 * 1000;
  const val = parseInt(match[1], 10);
  const unit = (match[2] || 'd').toLowerCase();
  switch (unit) {
    case 'd': return val * 24 * 60 * 60 * 1000;
    case 'h': return val * 60 * 60 * 1000;
    case 'm': return val * 60 * 1000;
    case 's': return val * 1000;
    default: return 7 * 24 * 60 * 60 * 1000;
  }
}

/**
 * Returns cookie options based on environment variables.
 */
function getAuthCookieOptions() {
  const isProduction = process.env.NODE_ENV === 'production';
  const secure = process.env.COOKIE_SECURE !== undefined
    ? process.env.COOKIE_SECURE === 'true'
    : isProduction;
  const sameSite = process.env.COOKIE_SAME_SITE || 'lax';

  return {
    httpOnly: true,
    secure,
    sameSite,
    path: '/',
    maxAge: getCookieMaxAge(process.env.JWT_EXPIRES_IN),
  };
}

/**
 * Handles user login.
 *
 * POST /api/auth/login
 * Status: 200 OK
 * Sets HTTP-only 'smartrail_token' cookie.
 */
async function login(req, res, next) {
  try {
    const { email, password } = req.body;
    const { user, token } = await authService.loginUser({ email, password });

    res.cookie('smartrail_token', token, getAuthCookieOptions());

    res.status(200).json({
      message: 'Login successful',
      user,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Returns the currently authenticated user's profile.
 *
 * GET /api/auth/me
 * Status: 200 OK
 */
async function getMe(req, res, next) {
  try {
    const user = await authService.getCurrentUser(req.user.id);

    res.status(200).json({
      user,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Handles user logout by clearing the authentication cookie.
 *
 * POST /api/auth/logout
 * Status: 200 OK
 * Idempotent: Succeeds whether or not an auth cookie is present.
 */
function logout(_req, res) {
  const { maxAge, ...clearOptions } = getAuthCookieOptions();
  res.clearCookie('smartrail_token', clearOptions);

  res.status(200).json({
    message: 'Logged out successfully',
  });
}

module.exports = {
  register,
  login,
  getMe,
  logout,
  getAuthCookieOptions,
};
