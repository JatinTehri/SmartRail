/**
 * payment.routes.js — Express Routes for Mock Payment Processing
 *
 * All payment endpoints require authentication via 'smartrail_token' cookie.
 */

'use strict';

const express = require('express');
const { authenticate } = require('../../middleware/auth');
const { validateProcessPayment } = require('./payment.validator');
const paymentController = require('./payment.controller');

const router = express.Router();

// Enforce authentication across all payment endpoints
router.use(authenticate);

// POST /api/payments/process — Process mock payment and confirm provisional booking
router.post('/process', validateProcessPayment, paymentController.processPayment);

module.exports = router;
