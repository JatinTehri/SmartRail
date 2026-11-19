/**
 * passenger.routes.js — Express Routes for Passenger Profiles
 *
 * All endpoints require authentication via 'smartrail_token' cookie.
 */

'use strict';

const express = require('express');
const { authenticate } = require('../../middleware/auth');
const passengerController = require('./passenger.controller');
const {
  validateCreatePassenger,
  validatePassengerId,
} = require('./passenger.validator');

const router = express.Router();

// Enforce authentication across all passenger profile routes
router.use(authenticate);

// GET /api/passengers — Retrieve saved profiles for current user
router.get('/', passengerController.getPassengers);

// POST /api/passengers — Create a saved passenger profile
router.post('/', validateCreatePassenger, passengerController.createPassenger);

// DELETE /api/passengers/:id — Delete a saved passenger profile
router.delete('/:id', validatePassengerId, passengerController.deletePassenger);

module.exports = router;
