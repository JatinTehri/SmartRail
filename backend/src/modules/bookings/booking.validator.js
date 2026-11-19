/**
 * booking.validator.js — Input Validation Middleware for Booking Endpoints
 *
 * Validates request payload for creating bookings and temporary seat holds.
 * Reuses existing date, class code, and passenger enum validators.
 */

'use strict';

const AppError = require('../../errors/AppError');
const {
  ALLOWED_CLASS_CODES,
  isValidDateString,
  isDateInPast,
} = require('../trains/train.validator');
const {
  ALLOWED_GENDERS,
  ALLOWED_BERTH_PREFERENCES,
} = require('../passengers/passenger.validator');

const MAX_PASSENGERS_PER_BOOKING = 6;

/**
 * Validates request body for POST /api/bookings
 *
 * Requirements:
 *   - trainId: required positive integer
 *   - journeyDate: required YYYY-MM-DD, not in past in Asia/Kolkata
 *   - sourceStationId: required positive integer
 *   - destinationStationId: required positive integer (distinct from source)
 *   - classCode: required string matching allowed class codes
 *   - passengers: required array of 1 to 6 passenger objects
 */
function validateCreateBooking(req, _res, next) {
  const {
    trainId,
    journeyDate,
    sourceStationId,
    destinationStationId,
    fromStationId,
    toStationId,
    classCode,
    passengers,
  } = req.body;

  // 1. Strip any client-supplied user ownership properties
  delete req.body.user_id;
  delete req.body.userId;

  // 2. Validate trainId
  if (!trainId || !/^\d+$/.test(String(trainId).trim()) || parseInt(trainId, 10) <= 0) {
    return next(new AppError('Train ID (trainId) must be a positive integer', 400, 'VALIDATION_ERROR'));
  }
  const parsedTrainId = parseInt(trainId, 10);

  // 3. Validate journeyDate
  if (!journeyDate || typeof journeyDate !== 'string' || journeyDate.trim().length === 0) {
    return next(new AppError('Journey date (journeyDate) is required', 400, 'VALIDATION_ERROR'));
  }
  const cleanDate = journeyDate.trim();
  if (!isValidDateString(cleanDate)) {
    return next(new AppError('Journey date must be a valid date in YYYY-MM-DD format', 400, 'VALIDATION_ERROR'));
  }
  if (isDateInPast(cleanDate)) {
    return next(new AppError('Journey date cannot be in the past', 400, 'VALIDATION_ERROR'));
  }

  // 4. Validate sourceStationId & destinationStationId (accepting fromStationId/toStationId aliases)
  const srcId = sourceStationId !== undefined ? sourceStationId : fromStationId;
  const destId = destinationStationId !== undefined ? destinationStationId : toStationId;

  if (!srcId || !/^\d+$/.test(String(srcId).trim()) || parseInt(srcId, 10) <= 0) {
    return next(new AppError('Source station ID (sourceStationId) must be a positive integer', 400, 'VALIDATION_ERROR'));
  }
  if (!destId || !/^\d+$/.test(String(destId).trim()) || parseInt(destId, 10) <= 0) {
    return next(new AppError('Destination station ID (destinationStationId) must be a positive integer', 400, 'VALIDATION_ERROR'));
  }

  const parsedSourceId = parseInt(srcId, 10);
  const parsedDestId = parseInt(destId, 10);

  if (parsedSourceId === parsedDestId) {
    return next(new AppError('Source and destination stations cannot be identical', 400, 'VALIDATION_ERROR'));
  }

  // 5. Validate classCode
  if (!classCode || typeof classCode !== 'string' || classCode.trim().length === 0) {
    return next(new AppError('Class code (classCode) is required', 400, 'VALIDATION_ERROR'));
  }
  const cleanClassCode = classCode.trim().toUpperCase();
  if (!ALLOWED_CLASS_CODES.includes(cleanClassCode)) {
    return next(
      new AppError(
        `Invalid class code "${cleanClassCode}". Allowed codes: ${ALLOWED_CLASS_CODES.join(', ')}`,
        400,
        'VALIDATION_ERROR'
      )
    );
  }

  // 6. Validate passengers array (1 to 6 passengers)
  if (!passengers || !Array.isArray(passengers) || passengers.length === 0) {
    return next(new AppError('Passengers array is required and must contain at least 1 passenger', 400, 'VALIDATION_ERROR'));
  }
  if (passengers.length > MAX_PASSENGERS_PER_BOOKING) {
    return next(
      new AppError(
        `A maximum of ${MAX_PASSENGERS_PER_BOOKING} passengers can be booked at once`,
        400,
        'VALIDATION_ERROR'
      )
    );
  }

  // 7. Validate each passenger object
  const sanitizedPassengers = [];
  for (let i = 0; i < passengers.length; i++) {
    const p = passengers[i];
    const index = i + 1;

    if (!p || typeof p !== 'object' || Array.isArray(p)) {
      return next(new AppError(`Invalid passenger data at index ${index}`, 400, 'VALIDATION_ERROR'));
    }

    // 7.1 Validate passengerProfileId if provided
    let parsedProfileId = null;
    if (p.passengerProfileId !== undefined && p.passengerProfileId !== null && String(p.passengerProfileId).trim() !== '') {
      if (!/^\d+$/.test(String(p.passengerProfileId).trim()) || parseInt(p.passengerProfileId, 10) <= 0) {
        return next(
          new AppError(`Passenger profile ID at index ${index} must be a positive integer`, 400, 'VALIDATION_ERROR')
        );
      }
      parsedProfileId = parseInt(String(p.passengerProfileId).trim(), 10);
    }
    const isSavedProfile = parsedProfileId !== null;

    // 7.2 Validate name (mandatory for manual passengers, optional for saved profiles)
    let cleanName;
    if (p.name !== undefined && p.name !== null) {
      if (typeof p.name !== 'string' || p.name.trim().length === 0) {
        return next(new AppError(`Passenger name is required for passenger ${index}`, 400, 'VALIDATION_ERROR'));
      }
      const trimmedName = p.name.trim();
      if (trimmedName.length > 100) {
        return next(
          new AppError(`Passenger name at index ${index} cannot exceed 100 characters`, 400, 'VALIDATION_ERROR')
        );
      }
      cleanName = trimmedName;
    } else if (!isSavedProfile) {
      return next(new AppError(`Passenger name is required for passenger ${index}`, 400, 'VALIDATION_ERROR'));
    }

    // 7.3 Validate age (mandatory for manual passengers, optional for saved profiles)
    let parsedAge;
    if (p.age !== undefined && p.age !== null && String(p.age).trim() !== '') {
      if (typeof p.age === 'boolean' || !/^\d+$/.test(String(p.age).trim())) {
        return next(
          new AppError(
            `Passenger age must be an integer between 1 and 120 for passenger ${index}`,
            400,
            'VALIDATION_ERROR'
          )
        );
      }
      const ageNum = parseInt(String(p.age).trim(), 10);
      if (ageNum < 1 || ageNum > 120) {
        return next(
          new AppError(`Passenger age must be between 1 and 120 for passenger ${index}`, 400, 'VALIDATION_ERROR')
        );
      }
      parsedAge = ageNum;
    } else if (!isSavedProfile) {
      return next(
        new AppError(
          `Passenger age must be an integer between 1 and 120 for passenger ${index}`,
          400,
          'VALIDATION_ERROR'
        )
      );
    }

    // 7.4 Validate gender (mandatory for manual passengers, optional for saved profiles)
    let normalizedGender;
    if (p.gender !== undefined && p.gender !== null) {
      if (typeof p.gender !== 'string' || p.gender.trim().length === 0) {
        return next(new AppError(`Passenger gender is required for passenger ${index}`, 400, 'VALIDATION_ERROR'));
      }
      const candidateGender = p.gender.trim().toUpperCase();
      if (!ALLOWED_GENDERS.includes(candidateGender)) {
        return next(
          new AppError(
            `Invalid gender "${p.gender}" for passenger ${index}. Allowed values: ${ALLOWED_GENDERS.join(', ')}`,
            400,
            'VALIDATION_ERROR'
          )
        );
      }
      normalizedGender = candidateGender;
    } else if (!isSavedProfile) {
      return next(new AppError(`Passenger gender is required for passenger ${index}`, 400, 'VALIDATION_ERROR'));
    }

    // 7.5 Validate berthPreference:
    //     - Saved passenger + omitted: preserve omission (undefined) for service fallback
    //     - Saved passenger + explicit 'NONE': preserve 'NONE' so service knows not to fallback
    //     - Manual passenger + omitted or 'NONE': default to null
    let normalizedBerth;
    if (p.berthPreference !== undefined && p.berthPreference !== null && String(p.berthPreference).trim() !== '') {
      const candidateBerth = String(p.berthPreference).trim().toUpperCase();
      if (!ALLOWED_BERTH_PREFERENCES.includes(candidateBerth)) {
        return next(
          new AppError(
            `Invalid berth preference "${candidateBerth}" for passenger ${index}. Allowed values: ${ALLOWED_BERTH_PREFERENCES.join(', ')}`,
            400,
            'VALIDATION_ERROR'
          )
        );
      }
      if (isSavedProfile) {
        normalizedBerth = candidateBerth; // Preserves 'NONE' or specific berth override
      } else {
        normalizedBerth = candidateBerth === 'NONE' ? null : candidateBerth;
      }
    } else if (!isSavedProfile) {
      normalizedBerth = null; // Default for manual passengers
    }

    // 7.6 Validate windowPreference:
    //     - Saved passenger + omitted: preserve omission (undefined) for service fallback
    //     - Saved passenger + explicit boolean: preserve true or false
    //     - Manual passenger + omitted: default to false
    let cleanWindow;
    if (p.windowPreference !== undefined && p.windowPreference !== null) {
      if (typeof p.windowPreference !== 'boolean') {
        return next(
          new AppError(
            `Window preference for passenger ${index} must be a boolean (true or false)`,
            400,
            'VALIDATION_ERROR'
          )
        );
      }
      cleanWindow = p.windowPreference;
    } else if (!isSavedProfile) {
      cleanWindow = false; // Default for manual passengers
    }

    // 7.7 Assemble sanitized passenger object
    if (isSavedProfile) {
      const savedObj = {
        passengerProfileId: parsedProfileId,
      };
      if (cleanName !== undefined) savedObj.name = cleanName;
      if (parsedAge !== undefined) savedObj.age = parsedAge;
      if (normalizedGender !== undefined) savedObj.gender = normalizedGender;
      if (normalizedBerth !== undefined) savedObj.berthPreference = normalizedBerth;
      if (cleanWindow !== undefined) savedObj.windowPreference = cleanWindow;
      sanitizedPassengers.push(savedObj);
    } else {
      sanitizedPassengers.push({
        passengerProfileId: null,
        name: cleanName,
        age: parsedAge,
        gender: normalizedGender,
        berthPreference: normalizedBerth,
        windowPreference: cleanWindow,
      });
    }
  }

  // Attach sanitized parameters to req.body
  req.body.trainId = parsedTrainId;
  req.body.journeyDate = cleanDate;
  req.body.sourceStationId = parsedSourceId;
  req.body.destinationStationId = parsedDestId;
  req.body.classCode = cleanClassCode;
  req.body.passengers = sanitizedPassengers;

  next();
}

module.exports = {
  validateCreateBooking,
  MAX_PASSENGERS_PER_BOOKING,
};
