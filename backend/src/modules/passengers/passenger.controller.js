/**
 * passenger.controller.js — HTTP Controller for Passenger Profiles
 *
 * Keeps controllers thin: extracts authenticated user identity and parameters,
 * delegates to passenger.service.js, and sends formatted HTTP responses.
 */

'use strict';

const passengerService = require('./passenger.service');

/**
 * Returns saved passenger profiles for the authenticated user.
 *
 * GET /api/passengers
 * Status: 200 OK
 */
async function getPassengers(req, res, next) {
  try {
    const userId = req.user.id;
    const passengers = await passengerService.getPassengers(userId);

    res.status(200).json({
      passengers,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Creates a saved passenger profile for the authenticated user.
 *
 * POST /api/passengers
 * Status: 201 Created
 */
async function createPassenger(req, res, next) {
  try {
    const userId = req.user.id;
    const passenger = await passengerService.createPassenger(userId, req.body);

    res.status(201).json({
      passenger,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Deletes a saved passenger profile owned by the authenticated user.
 *
 * DELETE /api/passengers/:id
 * Status: 200 OK
 */
async function deletePassenger(req, res, next) {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const result = await passengerService.deletePassenger(id, userId);

    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getPassengers,
  createPassenger,
  deletePassenger,
};
