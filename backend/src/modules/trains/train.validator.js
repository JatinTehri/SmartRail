/**
 * train.validator.js — Input Validation Middleware for Train Endpoints
 *
 * Validates search parameters: fromStationId, toStationId, journeyDate, and optional classCode.
 */

'use strict';

const AppError = require('../../errors/AppError');

// Valid class codes matching database check constraint on coaches(class_code)
const ALLOWED_CLASS_CODES = ['1A', '2A', '3A', 'SL', 'CC', '2S', 'EC'];

/**
 * Checks if a string is a valid ISO date (YYYY-MM-DD) representing a real calendar date.
 */
function isValidDateString(dateStr) {
  if (typeof dateStr !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return false;
  }
  const [year, month, day] = dateStr.split('-').map(Number);
  const dateObj = new Date(year, month - 1, day);
  return (
    dateObj.getFullYear() === year &&
    dateObj.getMonth() === month - 1 &&
    dateObj.getDate() === day
  );
}

/**
 * Returns the current date in YYYY-MM-DD format in the Asia/Kolkata timezone (IST).
 * Indian Railways operates strictly on Indian Standard Time.
 *
 * @param {Date} [referenceDate=new Date()] - Optional reference date for deterministic testing
 * @returns {string} Formatted date string (YYYY-MM-DD)
 */
function getTodayIST(referenceDate = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = formatter.formatToParts(referenceDate);
  const year = parts.find((p) => p.type === 'year').value;
  const month = parts.find((p) => p.type === 'month').value;
  const day = parts.find((p) => p.type === 'day').value;
  return `${year}-${month}-${day}`;
}

/**
 * Checks if a date string is in the past compared to today in the Asia/Kolkata timezone.
 *
 * @param {string} dateStr - Target date string in YYYY-MM-DD
 * @param {Date} [referenceDate=new Date()] - Optional reference date
 * @returns {boolean} True if the target date is strictly before today in IST
 */
function isDateInPast(dateStr, referenceDate = new Date()) {
  const todayIST = getTodayIST(referenceDate);
  return dateStr < todayIST;
}

/**
 * Validates query parameters for GET /api/trains/search
 *
 * Query Parameters:
 *   - fromStationId: required positive integer
 *   - toStationId: required positive integer
 *   - journeyDate: required YYYY-MM-DD, cannot be in past
 *   - classCode: optional, must match allowed class codes
 */
function validateTrainSearch(req, _res, next) {
  const { fromStationId, toStationId, journeyDate, classCode } = req.query;

  // 1. Validate fromStationId
  if (!fromStationId || !/^\d+$/.test(String(fromStationId).trim()) || parseInt(fromStationId, 10) <= 0) {
    return next(
      new AppError('Source station ID (fromStationId) must be a positive integer', 400, 'VALIDATION_ERROR')
    );
  }

  // 2. Validate toStationId
  if (!toStationId || !/^\d+$/.test(String(toStationId).trim()) || parseInt(toStationId, 10) <= 0) {
    return next(
      new AppError('Destination station ID (toStationId) must be a positive integer', 400, 'VALIDATION_ERROR')
    );
  }

  const parsedFrom = parseInt(fromStationId, 10);
  const parsedTo = parseInt(toStationId, 10);

  // 3. Origin and Destination cannot be the same
  if (parsedFrom === parsedTo) {
    return next(
      new AppError('Source and destination stations cannot be identical', 400, 'VALIDATION_ERROR')
    );
  }

  // 4. Validate journeyDate
  if (!journeyDate || typeof journeyDate !== 'string' || journeyDate.trim().length === 0) {
    return next(
      new AppError('Journey date (journeyDate) is required in YYYY-MM-DD format', 400, 'VALIDATION_ERROR')
    );
  }

  const cleanDate = journeyDate.trim();
  if (!isValidDateString(cleanDate)) {
    return next(
      new AppError('Journey date must be a valid calendar date in YYYY-MM-DD format', 400, 'VALIDATION_ERROR')
    );
  }

  if (isDateInPast(cleanDate)) {
    return next(
      new AppError('Journey date cannot be in the past', 400, 'VALIDATION_ERROR')
    );
  }

  // 5. Validate optional classCode
  let cleanClassCode = null;
  if (classCode !== undefined && classCode !== null && String(classCode).trim() !== '') {
    const candidateClass = String(classCode).trim().toUpperCase();
    if (!ALLOWED_CLASS_CODES.includes(candidateClass)) {
      return next(
        new AppError(
          `Invalid class code "${candidateClass}". Allowed codes: ${ALLOWED_CLASS_CODES.join(', ')}`,
          400,
          'VALIDATION_ERROR'
        )
      );
    }
    cleanClassCode = candidateClass;
  }

  // Attach sanitized parameters to req.query
  req.query.fromStationId = parsedFrom;
  req.query.toStationId = parsedTo;
  req.query.journeyDate = cleanDate;
  req.query.classCode = cleanClassCode;

  next();
}

/**
 * Validates path parameter for GET /api/trains/:trainId
 *
 * Path Parameters:
 *   - trainId: required positive integer (rejects decimals, negatives, zero, non-numeric)
 */
function validateTrainId(req, _res, next) {
  const { trainId } = req.params;

  if (!trainId || !/^\d+$/.test(String(trainId).trim()) || parseInt(trainId, 10) <= 0) {
    return next(
      new AppError('Train ID (trainId) must be a positive integer', 400, 'VALIDATION_ERROR')
    );
  }

  req.params.trainId = parseInt(trainId, 10);
  next();
}

/**
 * Validates path and query parameters for GET /api/trains/:trainId/availability
 *
 * Combines validateTrainId (validating req.params.trainId) and
 * validateTrainSearch (validating fromStationId, toStationId, journeyDate, classCode).
 */
function validateTrainAvailability(req, res, next) {
  validateTrainId(req, res, (err) => {
    if (err) return next(err);
    validateTrainSearch(req, res, next);
  });
}

module.exports = {
  validateTrainSearch,
  validateTrainId,
  validateTrainAvailability,
  ALLOWED_CLASS_CODES,
  isValidDateString,
  isDateInPast,
  getTodayIST,
};
