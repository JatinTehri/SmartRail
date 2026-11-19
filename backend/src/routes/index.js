const express = require('express');

const router = express.Router();

/**
 * GET /api/health
 * Basic health check to verify the backend is running.
 */
router.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// ---------------------------------------------------------------------------
// TEMPORARY — db connection verification only.
// Remove this route after Phase 1B Step 1 is verified.
// ---------------------------------------------------------------------------
/**
 * GET /api/db-health
 * Verifies that the PostgreSQL connection pool can reach the database.
 * Runs `SELECT NOW()` — the simplest possible query that returns the
 * current database timestamp.  Not a production endpoint.
 */
router.get('/db-health', async (req, res, next) => {
  try {
    const pool = require('../config/db');
    const result = await pool.query('SELECT NOW() AS db_time');
    res.status(200).json({
      status: 'ok',
      db_time: result.rows[0].db_time,
    });
  } catch (err) {
    next(err); // passes to centralized error handler
  }
});

const authRoutes = require('../modules/auth/auth.routes');
const stationRoutes = require('../modules/stations/station.routes');
const trainRoutes = require('../modules/trains/train.routes');
const passengerRoutes = require('../modules/passengers/passenger.routes');
const bookingRoutes = require('../modules/bookings/booking.routes');
const paymentRoutes = require('../modules/payments/payment.routes');

// Mount module routes
router.use('/auth', authRoutes);
router.use('/stations', stationRoutes);
router.use('/trains', trainRoutes);
router.use('/passengers', passengerRoutes);
router.use('/bookings', bookingRoutes);
router.use('/payments', paymentRoutes);

// Future module routes will be mounted here incrementally:
// router.use('/food',          foodRoutes);
// router.use('/complaints',    complaintRoutes);
// router.use('/emergency',     emergencyRoutes);
// router.use('/notifications', notificationRoutes);
// router.use('/admin',         adminRoutes);

module.exports = router;
