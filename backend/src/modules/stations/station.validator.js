/**
 * station.validator.js — Input Validation Middleware for Station Endpoints
 *
 * Validates and sanitizes query parameters for station search.
 */

'use strict';

const AppError = require('../../errors/AppError');

const MAX_QUERY_LENGTH = 100;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 20;

/**
 * Validates query parameters for GET /api/stations/search?q=...&limit=...
 */
function validateStationSearch(req, _res, next) {
  const { q, limit } = req.query;

  // 1. Validate search query 'q'
  if (q === undefined || q === null || typeof q !== 'string') {
    return next(new AppError('Search query parameter "q" is required', 400, 'VALIDATION_ERROR'));
  }

  const cleanQuery = q.trim();
  if (cleanQuery.length === 0) {
    return next(new AppError('Search query cannot be empty', 400, 'VALIDATION_ERROR'));
  }

  if (cleanQuery.length > MAX_QUERY_LENGTH) {
    return next(
      new AppError(`Search query cannot exceed ${MAX_QUERY_LENGTH} characters`, 400, 'VALIDATION_ERROR')
    );
  }

  // 2. Validate optional 'limit'
  let parsedLimit = DEFAULT_LIMIT;
  if (limit !== undefined && limit !== null && limit !== '') {
    const num = parseInt(limit, 10);
    if (isNaN(num) || num < 1) {
      return next(new AppError('Limit parameter must be a positive integer', 400, 'VALIDATION_ERROR'));
    }
    parsedLimit = Math.min(num, MAX_LIMIT);
  }

  // Sanitize onto req.query
  req.query.q = cleanQuery;
  req.query.limit = parsedLimit;

  next();
}

module.exports = {
  validateStationSearch,
  MAX_QUERY_LENGTH,
  DEFAULT_LIMIT,
  MAX_LIMIT,
};
