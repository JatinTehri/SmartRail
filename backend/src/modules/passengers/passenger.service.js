/**
 * passenger.service.js — Business Logic Layer for Passenger Profiles
 *
 * Coordinates passenger profile management, repository interactions,
 * DTO transformations, and ownership validation errors.
 */

'use strict';

const passengerRepository = require('./passenger.repository');
const AppError = require('../../errors/AppError');

/**
 * Transforms a raw database passenger profile row into an API DTO.
 * Excludes internal fields like user_id and maps snake_case to camelCase.
 *
 * @param {object} row - Raw row from passenger_profiles table
 * @returns {object} Formatted passenger profile DTO
 */
function formatPassenger(row) {
  return {
    id: Number(row.id),
    name: row.name,
    age: Number(row.age),
    gender: row.gender,
    berthPreference: row.berth_preference,
    windowPreference: Boolean(row.window_preference),
  };
}

/**
 * Retrieves all saved passenger profiles for the authenticated user.
 *
 * @param {number|string} userId - Authenticated user ID
 * @returns {Promise<Array<object>>} List of formatted passenger profiles
 */
async function getPassengers(userId) {
  const rows = await passengerRepository.findAllByUserId(userId);
  return rows.map(formatPassenger);
}

/**
 * Creates a new passenger profile for the authenticated user.
 *
 * @param {number|string} userId - Authenticated user ID
 * @param {object} profileData - Sanitized passenger profile data
 * @returns {Promise<object>} Formatted created passenger profile
 */
async function createPassenger(userId, profileData) {
  const row = await passengerRepository.create(userId, profileData);
  return formatPassenger(row);
}

/**
 * Deletes a saved passenger profile owned by the authenticated user.
 *
 * @param {number|string} id - Passenger profile ID
 * @param {number|string} userId - Authenticated user ID
 * @returns {Promise<{ message: string }>} Success result
 * @throws {AppError} If profile does not exist or belongs to another user
 */
async function deletePassenger(id, userId) {
  const deleted = await passengerRepository.deleteByIdAndUserId(id, userId);

  if (!deleted) {
    throw new AppError('Passenger profile not found', 404, 'PASSENGER_NOT_FOUND');
  }

  return { message: 'Passenger profile deleted successfully' };
}

module.exports = {
  getPassengers,
  createPassenger,
  deletePassenger,
  formatPassenger,
};
