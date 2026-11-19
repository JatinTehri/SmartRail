/**
 * auth.repository.js — Data Access Layer for User Authentication
 *
 * Encapsulates all SQL queries against the 'users' table.
 * Uses parameterized queries to prevent SQL injection.
 */

'use strict';

const pool = require('../../config/db');

/**
 * Finds a user by their unique email address.
 *
 * @param {string} email - The email to search for (case-insensitive search)
 * @returns {Promise<object|null>} The user record or null if not found
 */
async function findByEmail(email) {
  const query = `
    SELECT id, name, email, phone, password_hash, role, created_at, updated_at
    FROM users
    WHERE LOWER(email) = LOWER($1)
    LIMIT 1;
  `;
  const result = await pool.query(query, [email]);
  return result.rows[0] || null;
}

/**
 * Inserts a new user record into the database.
 * Never returns the password_hash in the RETURNING clause.
 *
 * @param {object} params
 * @param {string} params.name - Full name
 * @param {string} params.email - Unique email
 * @param {string|null} params.phone - Optional phone number
 * @param {string} params.passwordHash - bcrypt hashed password
 * @param {string} [params.role='USER'] - User role ('USER' or 'ADMIN')
 * @returns {Promise<object>} Created user record (sanitized: id, name, email, role, created_at)
 */
async function createUser({ name, email, phone = null, passwordHash, role = 'USER' }) {
  const query = `
    INSERT INTO users (name, email, phone, password_hash, role)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING id, name, email, role, created_at;
  `;
  const values = [name, email, phone, passwordHash, role];
  const result = await pool.query(query, values);
  return result.rows[0];
}

/**
 * Finds a user by their primary key id.
 * Excludes password_hash from the returned fields.
 *
 * @param {number|string} id - The user ID
 * @returns {Promise<object|null>} The user record or null
 */
async function findById(id) {
  const query = `
    SELECT id, name, email, phone, role, created_at, updated_at
    FROM users
    WHERE id = $1
    LIMIT 1;
  `;
  const result = await pool.query(query, [id]);
  return result.rows[0] || null;
}

module.exports = {
  findByEmail,
  createUser,
  findById,
};
