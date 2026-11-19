/**
 * train.routes.js — Train Route Definitions
 *
 * Defines endpoints for /api/trains.
 */

'use strict';

const express = require('express');
const router = express.Router();
const trainController = require('./train.controller');
const {
  validateTrainSearch,
  validateTrainId,
  validateTrainAvailability,
} = require('./train.validator');

/**
 * GET /api/trains/search?fromStationId=...&toStationId=...&journeyDate=...&classCode=...
 * Public endpoint to search trains operating between stations.
 */
router.get('/search', validateTrainSearch, trainController.search);

/**
 * GET /api/trains/:trainId/availability?fromStationId=...&toStationId=...&journeyDate=...&classCode=...
 * Public endpoint to check seat and RAC availability for a train segment.
 */
router.get('/:trainId/availability', validateTrainAvailability, trainController.getAvailability);

/**
 * GET /api/trains/:trainId
 * Public endpoint to retrieve train information, complete ordered route, and coaches.
 */
router.get('/:trainId', validateTrainId, trainController.getDetails);

module.exports = router;
