/**
 * booking.routes.js — Express Routes for Bookings & Seat Holds
 *
 * All booking endpoints require authentication via 'smartrail_token' cookie.
 */

'use strict';

const express = require('express');
const { authenticate } = require('../../middleware/auth');
const { validateCreateBooking } = require('./booking.validator');
const bookingController = require('./booking.controller');

const router = express.Router();

// Enforce authentication across all booking endpoints
router.use(authenticate);

// POST /api/bookings — Create booking and place 10-minute temporary seat hold
router.post('/', validateCreateBooking, bookingController.createBooking);

module.exports = router;
