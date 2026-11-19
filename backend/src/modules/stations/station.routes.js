/**
 * station.routes.js — Station Route Definitions
 *
 * Defines endpoints for /api/stations.
 */

'use strict';

const express = require('express');
const router = express.Router();
const stationController = require('./station.controller');
const { validateStationSearch } = require('./station.validator');

/**
 * GET /api/stations/search?q=...&limit=...
 * Public endpoint to search stations by code, name, or city.
 */
router.get('/search', validateStationSearch, stationController.search);

module.exports = router;
