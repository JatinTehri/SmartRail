/**
 * station.service.js — Business Logic Layer for Railway Stations
 *
 * Coordinates station lookups, query execution, and response data formatting.
 */

'use strict';

const stationRepository = require('./station.repository');

/**
 * Searches stations matching query and formats output per docs/API.md.
 *
 * @param {object} params
 * @param {string} params.query - Validated search string
 * @param {number} [params.limit=10] - Maximum records to return
 * @returns {Promise<Array<object>>} Formatted station list
 */
async function searchStations({ query, limit = 10 }) {
  const rows = await stationRepository.searchStations({ query, limit });

  return rows.map((row) => ({
    id: Number(row.id),
    code: row.code,
    name: row.name,
    city: row.city,
    state: row.state,
  }));
}

/**
 * Retrieves a single station by its ID.
 *
 * @param {number|string} id - Station ID
 * @returns {Promise<object|null>} Formatted station or null
 */
async function getStationById(id) {
  const row = await stationRepository.findById(id);
  if (!row) return null;

  return {
    id: Number(row.id),
    code: row.code,
    name: row.name,
    city: row.city,
    state: row.state,
  };
}

module.exports = {
  searchStations,
  getStationById,
};
