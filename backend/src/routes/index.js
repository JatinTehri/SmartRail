const express = require('express');

const router = express.Router();

/**
 * GET /api/health
 * Basic health check to verify the backend is running.
 */
router.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Future module routes will be mounted here incrementally:
// router.use('/auth',          authRoutes);
// router.use('/stations',      stationRoutes);
// router.use('/trains',        trainRoutes);
// router.use('/passengers',    passengerRoutes);
// router.use('/bookings',      bookingRoutes);
// router.use('/payments',      paymentRoutes);
// router.use('/food',          foodRoutes);
// router.use('/complaints',    complaintRoutes);
// router.use('/emergency',     emergencyRoutes);
// router.use('/notifications', notificationRoutes);
// router.use('/admin',         adminRoutes);

module.exports = router;
