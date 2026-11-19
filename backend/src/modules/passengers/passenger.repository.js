/**
 * passenger.repository.js — Data Access Layer for Passenger Profiles
 *
 * Encapsulates all SQL queries against the 'passenger_profiles' table
 * and coordinates atomic reference cleanup in 'booking_passengers'.
 */

'use strict';

const pool = require('../../config/db');

/**
 * Retrieves all saved passenger profiles belonging to a specific user.
 *
 * @param {number|string} userId - Authenticated user ID
 * @returns {Promise<Array<object>>} List of passenger profiles ordered by created_at ASC
 */
async function findAllByUserId(userId) {
  const query = `
    SELECT id, user_id, name, age, gender, berth_preference, window_preference, created_at, updated_at
    FROM passenger_profiles
    WHERE user_id = $1
    ORDER BY created_at ASC;
  `;
  const result = await pool.query(query, [userId]);
  return result.rows;
}

/**
 * Inserts a new passenger profile for a user.
 *
 * @param {number|string} userId - Authenticated user ID
 * @param {object} profileData - Passenger profile attributes
 * @param {string} profileData.name - Full name
 * @param {number} profileData.age - Age (1-120)
 * @param {string} profileData.gender - Gender ('MALE', 'FEMALE', 'OTHER')
 * @param {string|null} [profileData.berthPreference=null] - Optional berth preference
 * @param {boolean} [profileData.windowPreference=false] - Optional window preference
 * @returns {Promise<object>} Newly created profile record
 */
async function create(userId, { name, age, gender, berthPreference = null, windowPreference = false }) {
  const query = `
    INSERT INTO passenger_profiles (user_id, name, age, gender, berth_preference, window_preference)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING id, user_id, name, age, gender, berth_preference, window_preference, created_at, updated_at;
  `;
  const values = [userId, name, age, gender, berthPreference, windowPreference];
  const result = await pool.query(query, values);
  return result.rows[0];
}

/**
 * Safely deletes a passenger profile belonging to a user inside a PostgreSQL transaction.
 *
 * Steps:
 *   1. Verifies profile existence and ownership (SELECT ... FOR UPDATE).
 *   2. Unlinks nullable passenger_profile_id in booking_passengers without altering snapshots.
 *   3. Deletes the profile from passenger_profiles.
 *   4. Commits transaction and returns true; rolls back on failure or if not found.
 *
 * @param {number|string} id - Passenger profile ID to delete
 * @param {number|string} userId - Authenticated user ID (ownership check)
 * @returns {Promise<boolean>} True if deleted, false if profile not found or belongs to another user
 */
async function deleteByIdAndUserId(id, userId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Verify existence and ownership
    const checkQuery = `
      SELECT id
      FROM passenger_profiles
      WHERE id = $1 AND user_id = $2
      FOR UPDATE;
    `;
    const checkResult = await client.query(checkQuery, [id, userId]);

    if (checkResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return false;
    }

    // 2. Safely decouple historic bookings (preserves all name/age/gender snapshots)
    const unlinkQuery = `
      UPDATE booking_passengers
      SET passenger_profile_id = NULL
      WHERE passenger_profile_id = $1;
    `;
    await client.query(unlinkQuery, [id]);

    // 3. Delete the passenger profile record
    const deleteQuery = `
      DELETE FROM passenger_profiles
      WHERE id = $1 AND user_id = $2;
    `;
    await client.query(deleteQuery, [id, userId]);

    await client.query('COMMIT');
    return true;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  findAllByUserId,
  create,
  deleteByIdAndUserId,
};
