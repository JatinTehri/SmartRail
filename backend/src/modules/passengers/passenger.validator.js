/**
 * passenger.validator.js — Input Validation Middleware for Passenger Profiles
 */

'use strict';

const AppError = require('../../errors/AppError');

const ALLOWED_GENDERS = ['MALE', 'FEMALE', 'OTHER'];
const ALLOWED_BERTH_PREFERENCES = ['LOWER', 'MIDDLE', 'UPPER', 'SIDE_LOWER', 'SIDE_UPPER', 'NONE'];

/**
 * Validates request body for creating a passenger profile.
 */
function validateCreatePassenger(req, _res, next) {
  const { name, age, gender, berthPreference, windowPreference } = req.body;

  // 1. Validate name (required string, 1-100 characters)
  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return next(new AppError('Passenger name is required', 400, 'VALIDATION_ERROR'));
  }
  const cleanName = name.trim();
  if (cleanName.length > 100) {
    return next(new AppError('Passenger name cannot exceed 100 characters', 400, 'VALIDATION_ERROR'));
  }

  // 2. Validate age (integer between 1 and 120)
  if (age === undefined || age === null || age === '' || !/^\d+$/.test(String(age).trim())) {
    return next(new AppError('Passenger age must be an integer between 1 and 120', 400, 'VALIDATION_ERROR'));
  }
  const parsedAge = parseInt(String(age).trim(), 10);
  if (parsedAge < 1 || parsedAge > 120) {
    return next(new AppError('Passenger age must be between 1 and 120', 400, 'VALIDATION_ERROR'));
  }

  // 3. Validate gender (MALE, FEMALE, OTHER)
  if (!gender || typeof gender !== 'string' || gender.trim().length === 0) {
    return next(new AppError('Passenger gender is required', 400, 'VALIDATION_ERROR'));
  }
  const normalizedGender = gender.trim().toUpperCase();
  if (!ALLOWED_GENDERS.includes(normalizedGender)) {
    return next(
      new AppError(
        `Invalid gender "${gender}". Allowed values: ${ALLOWED_GENDERS.join(', ')}`,
        400,
        'VALIDATION_ERROR'
      )
    );
  }

  // 4. Validate optional berthPreference
  let normalizedBerth = null;
  if (berthPreference !== undefined && berthPreference !== null && String(berthPreference).trim() !== '') {
    const candidateBerth = String(berthPreference).trim().toUpperCase();
    if (!ALLOWED_BERTH_PREFERENCES.includes(candidateBerth)) {
      return next(
        new AppError(
          `Invalid berth preference "${candidateBerth}". Allowed values: ${ALLOWED_BERTH_PREFERENCES.join(', ')}`,
          400,
          'VALIDATION_ERROR'
        )
      );
    }
    normalizedBerth = candidateBerth === 'NONE' ? null : candidateBerth;
  }

  // 5. Validate optional windowPreference (boolean, default false)
  let cleanWindow = false;
  if (windowPreference !== undefined && windowPreference !== null) {
    if (typeof windowPreference !== 'boolean') {
      return next(new AppError('Window preference must be a boolean (true or false)', 400, 'VALIDATION_ERROR'));
    }
    cleanWindow = windowPreference;
  }

  // Sanitize and prevent user_id injection from payload
  delete req.body.user_id;
  delete req.body.userId;

  req.body.name = cleanName;
  req.body.age = parsedAge;
  req.body.gender = normalizedGender;
  req.body.berthPreference = normalizedBerth;
  req.body.windowPreference = cleanWindow;

  next();
}

/**
 * Validates req.params.id as a positive integer.
 */
function validatePassengerId(req, _res, next) {
  const { id } = req.params;

  if (!id || !/^\d+$/.test(String(id).trim()) || parseInt(id, 10) <= 0) {
    return next(new AppError('Passenger ID must be a positive integer', 400, 'VALIDATION_ERROR'));
  }

  req.params.id = parseInt(id, 10);
  next();
}

module.exports = {
  validateCreatePassenger,
  validatePassengerId,
  ALLOWED_GENDERS,
  ALLOWED_BERTH_PREFERENCES,
};
