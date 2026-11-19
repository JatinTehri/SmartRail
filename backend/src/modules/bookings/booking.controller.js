/**
 * booking.controller.js — HTTP Controller for Booking Operations
 *
 * Keeps controllers thin: extracts authenticated user identity and validated payload,
 * delegates to booking.service.js, and returns formatted HTTP responses.
 */

'use strict';

const bookingService = require('./booking.service');

/**
 * Creates a new booking and temporarily holds allocated seats for 10 minutes.
 *
 * POST /api/bookings
 * Status: 201 Created
 */
async function createBooking(req, res, next) {
  try {
    const userId = req.user.id;
    const result = await bookingService.createBooking(userId, req.body);

    res.status(201).json(result);
  } catch (err) {
    next(err); // Delegates to centralized errorHandler middleware
  }
}

module.exports = {
  createBooking,
};
