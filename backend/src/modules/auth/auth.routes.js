/**
 * auth.routes.js — Authentication Route Definitions
 *
 * Defines endpoints for /api/auth.
 */

'use strict';

const express = require('express');
const router = express.Router();
const authController = require('./auth.controller');
const { validateRegister, validateLogin } = require('./auth.validator');
const { authenticate } = require('../../middleware/auth');

/**
 * POST /api/auth/register
 * Public route for user registration
 */
router.post('/register', validateRegister, authController.register);

/**
 * POST /api/auth/login
 * Public route for user authentication
 */
router.post('/login', validateLogin, authController.login);

/**
 * GET /api/auth/me
 * Protected route returning the current authenticated user's profile
 */
router.get('/me', authenticate, authController.getMe);

/**
 * POST /api/auth/logout
 * Public route for user logout (clears auth cookie)
 */
router.post('/logout', authController.logout);

module.exports = router;
