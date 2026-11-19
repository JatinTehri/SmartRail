/**
 * station.repository.js — Data Access Layer for Railway Stations
 *
 * Encapsulates all SQL queries against the 'stations' table.
 * Uses parameterized queries to prevent SQL injection.
 */

'use strict';

const pool = require('../../config/db');

/**
 * Escapes SQL LIKE special wildcard characters (%, _, \) so they are treated literally.
 *
 * @param {string} str - Raw input string
 * @returns {string} String with special characters escaped
 */
function escapeLikePattern(str) {
  return str.replace(/([%_\\])/g, '\\$1');
}

/**
 * Searches stations by code, name, or city with ranked relevance.
 *
 * Ranking order:
 *   1. Exact station code match (e.g. 'NDLS' when searching 'ndls')
 *   2. Code prefix match (e.g. 'ND%' when searching 'nd')
 *   3. Name prefix match (e.g. 'New%' when searching 'new')
 *   4. City prefix match (e.g. 'Del%' when searching 'del')
 *   5. Substring partial match anywhere in code, name, or city
 *
 * @param {object} params
 * @param {string} params.query - Clean search query string
 * @param {number} [params.limit=10] - Maximum number of stations to return
 * @returns {Promise<Array<object>>} Matching station records
 */
async function searchStations({ query, limit = 10 }) {
  const escaped = escapeLikePattern(query.trim());
  const exactTerm = query.trim().toLowerCase();
  const prefixPattern = `${escaped.toLowerCase()}%`;
  const wildcardPattern = `%${escaped.toLowerCase()}%`;

  const sql = `
    SELECT id, code, name, city, state
    FROM stations
    WHERE LOWER(code) LIKE $1
       OR LOWER(name) LIKE $1
       OR LOWER(city) LIKE $1
    ORDER BY
      CASE
        WHEN LOWER(code) = $2 THEN 1
        WHEN LOWER(code) LIKE $3 THEN 2
        WHEN LOWER(name) LIKE $3 THEN 3
        WHEN LOWER(city) LIKE $3 THEN 4
        ELSE 5
      END,
      name ASC
    LIMIT $4;
  `;

  const values = [wildcardPattern, exactTerm, prefixPattern, limit];
  const result = await pool.query(sql, values);
  return result.rows;
}

/**
 * Finds a station by its primary key ID.
 *
 * @param {number|string} id - Station ID
 * @returns {Promise<object|null>} Station record or null
 */
async function findById(id) {
  const sql = `
    SELECT id, code, name, city, state
    FROM stations
    WHERE id = $1
    LIMIT 1;
  `;
  const result = await pool.query(sql, [id]);
  return result.rows[0] || null;
}

/**
 * Finds a station by its unique code (e.g. 'NDLS').
 *
 * @param {string} code - Station code
 * @returns {Promise<object|null>} Station record or null
 */
async function findByCode(code) {
  const sql = `
    SELECT id, code, name, city, state
    FROM stations
    WHERE UPPER(code) = UPPER($1)
    LIMIT 1;
  `;
  const result = await pool.query(sql, [code]);
  return result.rows[0] || null;
}

module.exports = {
  searchStations,
  findById,
  findByCode,
  escapeLikePattern,
};
