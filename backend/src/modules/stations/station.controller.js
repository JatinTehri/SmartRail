/**
 * station.controller.js — HTTP Controller for Station Endpoints
 *
 * Keeps controllers thin: delegates business logic to station.service.js
 * and formats HTTP responses matching docs/API.md.
 */

'use strict';

const stationService = require('./station.service');

/**
 * Searches stations by code, name, or city.
 *
 * GET /api/stations/search?q=...&limit=...
 * Status: 200 OK
 */
async function search(req, res, next) {
  try {
    const { q, limit } = req.query;
    const stations = await stationService.searchStations({ query: q, limit });

    res.status(200).json({
      stations,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  search,
};
