/**
 * payment.validator.js — Input Validation Middleware for Payment Processing
 *
 * Validates request payload for POST /api/payments/process.
 *
 * Contract:
 *   - bookingId: Required positive integer.
 *   - paymentMethod: Optional string, defaults to 'MOCK_UPI'.
 *                    Allowed: 'MOCK_UPI', 'UPI', 'DEBIT_CARD', 'CREDIT_CARD', 'NET_BANKING'.
 *                    Normalized to uppercase, trimmed, max 30 chars (matches VARCHAR(30)).
 *   - simulateFailure: Optional boolean, defaults to false.
 *                      Explicitly documented as a mock-payment demonstration/testing option.
 *
 * Security:
 *   - Rejects client-supplied authority fields: userId, user_id, amount, status, pnr.
 *   - The authenticated user identity is retrieved solely from req.user.id in the controller.
 */

'use strict';

const AppError = require('../../errors/AppError');

const ALLOWED_PAYMENT_METHODS = Object.freeze([
  'MOCK_UPI',
  'UPI',
  'DEBIT_CARD',
  'CREDIT_CARD',
  'NET_BANKING',
]);

const DEFAULT_PAYMENT_METHOD = 'MOCK_UPI';
const MAX_PAYMENT_METHOD_LENGTH = 30;

const FORBIDDEN_AUTHORITY_FIELDS = Object.freeze([
  'userId',
  'user_id',
  'amount',
  'status',
  'pnr',
]);

/**
 * Express middleware validating request body for POST /api/payments/process
 *
 * @param {object} req - Express request object
 * @param {object} _res - Express response object
 * @param {function} next - Express next middleware callback
 */
function validateProcessPayment(req, _res, next) {
  const body = req.body || {};

  // 1. Strictly reject client-supplied authority fields
  for (const field of FORBIDDEN_AUTHORITY_FIELDS) {
    if (body[field] !== undefined) {
      return next(
        new AppError(
          `Client-supplied authority field "${field}" is not permitted`,
          400,
          'VALIDATION_ERROR'
        )
      );
    }
  }

  // 2. Validate bookingId (required positive integer)
  const { bookingId } = body;
  if (bookingId === undefined || bookingId === null || String(bookingId).trim() === '') {
    return next(
      new AppError('Booking ID (bookingId) is required', 400, 'VALIDATION_ERROR')
    );
  }

  if (
    typeof bookingId === 'boolean' ||
    !/^\d+$/.test(String(bookingId).trim()) ||
    parseInt(bookingId, 10) <= 0
  ) {
    return next(
      new AppError('Booking ID (bookingId) must be a positive integer', 400, 'VALIDATION_ERROR')
    );
  }

  const parsedBookingId = parseInt(bookingId, 10);

  // 3. Validate and normalize paymentMethod (optional, defaults to 'MOCK_UPI')
  let normalizedPaymentMethod = DEFAULT_PAYMENT_METHOD;
  const { paymentMethod } = body;

  if (paymentMethod !== undefined && paymentMethod !== null) {
    if (typeof paymentMethod !== 'string' || paymentMethod.trim().length === 0) {
      return next(
        new AppError('Payment method must be a non-empty string', 400, 'VALIDATION_ERROR')
      );
    }

    const trimmed = paymentMethod.trim().toUpperCase();

    if (trimmed.length > MAX_PAYMENT_METHOD_LENGTH) {
      return next(
        new AppError(
          `Payment method cannot exceed ${MAX_PAYMENT_METHOD_LENGTH} characters`,
          400,
          'VALIDATION_ERROR'
        )
      );
    }

    if (!ALLOWED_PAYMENT_METHODS.includes(trimmed)) {
      return next(
        new AppError(
          `Invalid payment method. Allowed methods: ${ALLOWED_PAYMENT_METHODS.join(', ')}`,
          400,
          'VALIDATION_ERROR'
        )
      );
    }

    normalizedPaymentMethod = trimmed;
  }

  // 4. Validate simulateFailure (optional boolean, defaults to false)
  // Explicit note: This is a demonstration/testing parameter for simulated mock payments only.
  let normalizedSimulateFailure = false;
  const { simulateFailure } = body;

  if (simulateFailure !== undefined && simulateFailure !== null) {
    if (typeof simulateFailure !== 'boolean') {
      return next(
        new AppError(
          'simulateFailure must be a boolean (true or false)',
          400,
          'VALIDATION_ERROR'
        )
      );
    }
    normalizedSimulateFailure = simulateFailure;
  }

  // 5. Attach sanitized, canonical values to req.body
  req.body.bookingId = parsedBookingId;
  req.body.paymentMethod = normalizedPaymentMethod;
  req.body.simulateFailure = normalizedSimulateFailure;

  return next();
}

module.exports = {
  validateProcessPayment,
  ALLOWED_PAYMENT_METHODS,
  DEFAULT_PAYMENT_METHOD,
  MAX_PAYMENT_METHOD_LENGTH,
  FORBIDDEN_AUTHORITY_FIELDS,
};
