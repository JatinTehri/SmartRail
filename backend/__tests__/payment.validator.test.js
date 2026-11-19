/**
 * payment.validator.test.js — Unit Tests for Payment Input Validation Middleware
 *
 * Tests the validateProcessPayment middleware for POST /api/payments/process:
 *   - Valid request handling and sanitization
 *   - Missing, negative, zero, decimal, and non-numeric bookingId rejection
 *   - Default paymentMethod assignment ('MOCK_UPI')
 *   - All allowed payment methods acceptance ('MOCK_UPI', 'UPI', 'DEBIT_CARD', 'CREDIT_CARD', 'NET_BANKING')
 *   - Normalization of paymentMethod (trimming and uppercase conversion)
 *   - Rejection of invalid, empty, whitespace, and overlength (> 30 chars) payment methods
 *   - Boolean validation for simulateFailure (defaulting to false)
 *   - Strict rejection of client-supplied authority fields: userId, user_id, amount, status, pnr
 */

'use strict';

const {
  validateProcessPayment,
  ALLOWED_PAYMENT_METHODS,
  DEFAULT_PAYMENT_METHOD,
  FORBIDDEN_AUTHORITY_FIELDS,
} = require('../src/modules/payments/payment.validator');
const AppError = require('../src/errors/AppError');

describe('Payment Input Validation (validateProcessPayment)', () => {
  let req;
  let res;
  let next;

  beforeEach(() => {
    req = { body: {} };
    res = {};
    next = jest.fn();
  });

  // Helper to extract the error passed to next()
  function getNextError() {
    expect(next).toHaveBeenCalledTimes(1);
    const err = next.mock.calls[0][0];
    expect(err).toBeInstanceOf(AppError);
    return err;
  }

  // ---------------------------------------------------------------------------
  // 1. Valid Request Handling & Sanitization
  // ---------------------------------------------------------------------------
  describe('Valid Requests', () => {
    test('1.1. should accept valid bookingId and assign defaults for optional fields', () => {
      req.body = { bookingId: 101 };

      validateProcessPayment(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(next).toHaveBeenCalledWith(); // No error passed
      expect(req.body.bookingId).toBe(101);
      expect(req.body.paymentMethod).toBe(DEFAULT_PAYMENT_METHOD);
      expect(req.body.simulateFailure).toBe(false);
    });

    test('1.2. should parse string bookingId into integer', () => {
      req.body = { bookingId: '42' };

      validateProcessPayment(req, res, next);

      expect(next).toHaveBeenCalledWith();
      expect(req.body.bookingId).toBe(42);
    });

    test('1.3. should accept explicit simulateFailure: true and simulateFailure: false', () => {
      req.body = { bookingId: 10, simulateFailure: true };
      validateProcessPayment(req, res, next);
      expect(next).toHaveBeenCalledWith();
      expect(req.body.simulateFailure).toBe(true);

      next.mockClear();
      req.body = { bookingId: 10, simulateFailure: false };
      validateProcessPayment(req, res, next);
      expect(next).toHaveBeenCalledWith();
      expect(req.body.simulateFailure).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // 2. bookingId Validation (HTTP 400)
  // ---------------------------------------------------------------------------
  describe('bookingId Validation', () => {
    test('2.1. should reject missing bookingId with HTTP 400', () => {
      req.body = {};

      validateProcessPayment(req, res, next);

      const err = getNextError();
      expect(err.statusCode).toBe(400);
      expect(err.code).toBe('VALIDATION_ERROR');
      expect(err.message).toMatch(/Booking ID \(bookingId\) is required/i);
    });

    test('2.2. should reject null and empty string bookingId with HTTP 400', () => {
      req.body = { bookingId: null };
      validateProcessPayment(req, res, next);
      expect(getNextError().statusCode).toBe(400);

      next.mockClear();
      req.body = { bookingId: '   ' };
      validateProcessPayment(req, res, next);
      expect(getNextError().statusCode).toBe(400);
    });

    test('2.3. should reject zero and negative bookingId with HTTP 400', () => {
      req.body = { bookingId: 0 };
      validateProcessPayment(req, res, next);
      expect(getNextError().statusCode).toBe(400);

      next.mockClear();
      req.body = { bookingId: -5 };
      validateProcessPayment(req, res, next);
      expect(getNextError().statusCode).toBe(400);
    });

    test('2.4. should reject decimal bookingId with HTTP 400', () => {
      req.body = { bookingId: 12.5 };
      validateProcessPayment(req, res, next);
      const err = getNextError();
      expect(err.statusCode).toBe(400);
      expect(err.message).toMatch(/positive integer/i);
    });

    test('2.5. should reject non-numeric string bookingId with HTTP 400', () => {
      req.body = { bookingId: 'abc' };
      validateProcessPayment(req, res, next);
      const err = getNextError();
      expect(err.statusCode).toBe(400);
      expect(err.message).toMatch(/positive integer/i);
    });

    test('2.6. should reject boolean bookingId with HTTP 400', () => {
      req.body = { bookingId: true };
      validateProcessPayment(req, res, next);
      const err = getNextError();
      expect(err.statusCode).toBe(400);
      expect(err.message).toMatch(/positive integer/i);
    });
  });

  // ---------------------------------------------------------------------------
  // 3. paymentMethod Validation & Normalization
  // ---------------------------------------------------------------------------
  describe('paymentMethod Validation', () => {
    test.each(ALLOWED_PAYMENT_METHODS)(
      '3.1. should accept allowed payment method: %s',
      (method) => {
        req.body = { bookingId: 101, paymentMethod: method };
        validateProcessPayment(req, res, next);
        expect(next).toHaveBeenCalledWith();
        expect(req.body.paymentMethod).toBe(method);
      }
    );

    test('3.2. should normalize paymentMethod to uppercase and trim whitespace', () => {
      req.body = { bookingId: 101, paymentMethod: '  upi  ' };
      validateProcessPayment(req, res, next);
      expect(next).toHaveBeenCalledWith();
      expect(req.body.paymentMethod).toBe('UPI');

      next.mockClear();
      req.body = { bookingId: 101, paymentMethod: 'debit_card' };
      validateProcessPayment(req, res, next);
      expect(next).toHaveBeenCalledWith();
      expect(req.body.paymentMethod).toBe('DEBIT_CARD');
    });

    test('3.3. should reject unsupported paymentMethod with HTTP 400', () => {
      req.body = { bookingId: 101, paymentMethod: 'BITCOIN' };
      validateProcessPayment(req, res, next);
      const err = getNextError();
      expect(err.statusCode).toBe(400);
      expect(err.code).toBe('VALIDATION_ERROR');
      expect(err.message).toMatch(/Invalid payment method/i);
    });

    test('3.4. should reject empty string or whitespace-only paymentMethod with HTTP 400', () => {
      req.body = { bookingId: 101, paymentMethod: '' };
      validateProcessPayment(req, res, next);
      expect(getNextError().statusCode).toBe(400);

      next.mockClear();
      req.body = { bookingId: 101, paymentMethod: '    ' };
      validateProcessPayment(req, res, next);
      expect(getNextError().statusCode).toBe(400);
    });

    test('3.5. should reject non-string paymentMethod with HTTP 400', () => {
      req.body = { bookingId: 101, paymentMethod: 1234 };
      validateProcessPayment(req, res, next);
      expect(getNextError().statusCode).toBe(400);
    });

    test('3.6. should reject paymentMethod exceeding 30 characters (VARCHAR(30) DB limit)', () => {
      req.body = {
        bookingId: 101,
        paymentMethod: 'A'.repeat(31),
      };
      validateProcessPayment(req, res, next);
      const err = getNextError();
      expect(err.statusCode).toBe(400);
      expect(err.message).toMatch(/cannot exceed 30 characters/i);
    });
  });

  // ---------------------------------------------------------------------------
  // 4. simulateFailure Validation
  // ---------------------------------------------------------------------------
  describe('simulateFailure Validation', () => {
    test('4.1. should reject non-boolean string for simulateFailure', () => {
      req.body = { bookingId: 101, simulateFailure: 'true' };
      validateProcessPayment(req, res, next);
      const err = getNextError();
      expect(err.statusCode).toBe(400);
      expect(err.message).toMatch(/simulateFailure must be a boolean/i);
    });

    test('4.2. should reject numeric value for simulateFailure', () => {
      req.body = { bookingId: 101, simulateFailure: 1 };
      validateProcessPayment(req, res, next);
      const err = getNextError();
      expect(err.statusCode).toBe(400);
      expect(err.message).toMatch(/simulateFailure must be a boolean/i);
    });
  });

  // ---------------------------------------------------------------------------
  // 5. Authority Fields Protection (Security Checks)
  // ---------------------------------------------------------------------------
  describe('Client-Supplied Authority Fields Rejection', () => {
    test.each(FORBIDDEN_AUTHORITY_FIELDS)(
      '5.1. should reject request containing client-supplied authority field: %s',
      (forbiddenField) => {
        req.body = {
          bookingId: 101,
          [forbiddenField]: 'tampered_value',
        };

        validateProcessPayment(req, res, next);

        const err = getNextError();
        expect(err.statusCode).toBe(400);
        expect(err.code).toBe('VALIDATION_ERROR');
        expect(err.message).toContain(forbiddenField);
        expect(err.message).toMatch(/not permitted/i);
      }
    );

    test('5.2. should reject when authority field is null or false', () => {
      req.body = {
        bookingId: 101,
        status: null,
      };

      validateProcessPayment(req, res, next);

      const err = getNextError();
      expect(err.statusCode).toBe(400);
      expect(err.message).toContain('status');
    });
  });
});
