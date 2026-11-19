/**
 * payment.controller.js — HTTP Controller for Payment Operations
 *
 * Keeps controllers thin:
 *   - Extracts authenticated userId from req.user.id
 *   - Passes sanitized request payload (req.body) to paymentService.processPayment(userId, req.body)
 *   - Formats HTTP responses using the statusCode returned by the service (200 for SUCCESS / replay, 402 for FAILED simulation)
 *   - Forwards any thrown operational / unexpected errors to next(err) for centralized error handling
 *   - Contains zero SQL queries or transactional logic
 */

'use strict';

const paymentService = require('./payment.service');

/**
 * Process a mock payment for a provisional booking.
 *
 * POST /api/payments/process
 *
 * Success (new confirmation or idempotent replay): 200 OK
 * Simulated failure: 402 Payment Required
 */
async function processPayment(req, res, next) {
  try {
    const userId = req.user.id;
    const result = await paymentService.processPayment(userId, req.body);

    const statusCode = result.statusCode || (result.success ? 200 : 402);
    res.status(statusCode).json(result);
  } catch (err) {
    next(err); // Delegates to centralized errorHandler middleware
  }
}

module.exports = {
  processPayment,
};
