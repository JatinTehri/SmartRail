/**
 * train.controller.js — HTTP Controller for Train Endpoints
 *
 * Keeps controllers thin: delegates business logic to train.service.js
 * and formats HTTP responses matching docs/API.md.
 */

'use strict';

const trainService = require('./train.service');

/**
 * Searches trains between source and destination stations.
 *
 * GET /api/trains/search?fromStationId=...&toStationId=...&journeyDate=...&classCode=...
 * Status: 200 OK
 */
async function search(req, res, next) {
  try {
    const { fromStationId, toStationId, journeyDate, classCode } = req.query;
    const trains = await trainService.searchTrains({
      fromStationId,
      toStationId,
      journeyDate,
      classCode,
    });

    res.status(200).json({
      trains,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Retrieves train metadata, ordered route stops, and coaches.
 *
 * GET /api/trains/:trainId
 * Status: 200 OK
 */
async function getDetails(req, res, next) {
  try {
    const { trainId } = req.params;
    const details = await trainService.getTrainDetails(trainId);

    res.status(200).json(details);
  } catch (err) {
    next(err);
  }
}

/**
 * Calculates confirmed and RAC seat availability for a journey segment on a train.
 *
 * GET /api/trains/:trainId/availability?fromStationId=...&toStationId=...&journeyDate=...&classCode=...
 * Status: 200 OK
 */
async function getAvailability(req, res, next) {
  try {
    const { trainId } = req.params;
    const { fromStationId, toStationId, journeyDate, classCode } = req.query;

    const availability = await trainService.getTrainAvailability({
      trainId,
      fromStationId,
      toStationId,
      journeyDate,
      classCode,
    });

    res.status(200).json(availability);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  search,
  getDetails,
  getAvailability,
};
