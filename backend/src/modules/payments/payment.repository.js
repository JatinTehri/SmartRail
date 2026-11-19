/**
 * payment.repository.js — Data Access Layer for Payments & Booking Confirmation
 *
 * Encapsulates parameterized SQL queries for:
 *   1. Hierarchical row-level locking (seat_allocations -> booking_passengers -> bookings)
 *   2. Database wall-clock expiration checking via clock_timestamp()
 *   3. Successful payment record lookup (for idempotency)
 *   4. Payment attempt insertion (SUCCESS or FAILED)
 *   5. Booking status and PNR updates
 *   6. Transitioning HELD seat allocations to ACTIVE
 *   7. Targeted release of expired holds and cancellation
 *   8. Retrieving joined booking and passenger confirmation details
 *
 * All methods accept an active PostgreSQL transaction client managed by the service layer.
 */

'use strict';

/**
 * Locks seat allocations linked to a booking in ascending allocation ID order.
 * Follows Step 1 in the deadlock-avoidance hierarchy (matching releaseExpiredHolds).
 *
 * @param {object} client - PostgreSQL transaction client
 * @param {number} bookingId - Primary key ID of the booking
 * @returns {Promise<Array<object>>} Locked seat allocation rows
 */
async function lockSeatAllocationsByBookingId(client, bookingId) {
  const sql = `
    SELECT 
      sa.id,
      sa.booking_passenger_id,
      sa.seat_id,
      sa.journey_date,
      sa.from_stop_order,
      sa.to_stop_order,
      sa.allocation_type,
      sa.rac_slot,
      sa.status,
      sa.allocated_at
    FROM seat_allocations sa
    JOIN booking_passengers bp ON bp.id = sa.booking_passenger_id
    WHERE bp.booking_id = $1
    ORDER BY sa.id ASC
    FOR UPDATE OF sa;
  `;
  const result = await client.query(sql, [bookingId]);
  return result.rows;
}

/**
 * Locks booking passengers for a booking in ascending passenger ID order.
 * Follows Step 2 in the deadlock-avoidance hierarchy.
 * Returns passenger statuses required to compute the aggregate booking status.
 *
 * @param {object} client - PostgreSQL transaction client
 * @param {number} bookingId - Primary key ID of the booking
 * @returns {Promise<Array<object>>} Locked booking passenger rows
 */
async function lockBookingPassengersByBookingId(client, bookingId) {
  const sql = `
    SELECT 
      bp.id,
      bp.booking_id,
      bp.passenger_profile_id,
      bp.name_snapshot,
      bp.age_snapshot,
      bp.gender_snapshot,
      bp.berth_preference,
      bp.window_preference,
      bp.senior_citizen_flag,
      bp.passenger_status,
      bp.created_at
    FROM booking_passengers bp
    WHERE bp.booking_id = $1
    ORDER BY bp.id ASC
    FOR UPDATE;
  `;
  const result = await client.query(sql, [bookingId]);
  return result.rows;
}

/**
 * Locks the single booking row in Step 3 of the deadlock-avoidance hierarchy.
 *
 * Two-phase execution:
 *   1. Acquires row lock using SELECT ... FOR UPDATE.
 *   2. Evaluates expiration against the live database wall clock using clock_timestamp().
 *
 * @param {object} client - PostgreSQL transaction client
 * @param {number} bookingId - Primary key ID of the booking
 * @returns {Promise<object|null>} Locked booking row with isExpired boolean, or null if not found
 */
async function lockBookingById(client, bookingId) {
  // Phase 1: Acquire row lock on the booking record
  const lockSql = `
    SELECT 
      b.id,
      b.pnr,
      b.user_id,
      b.train_id,
      b.journey_date,
      b.source_station_id,
      b.destination_station_id,
      b.class_code,
      b.status,
      b.total_amount,
      b.created_at,
      b.updated_at
    FROM bookings b
    WHERE b.id = $1
    ORDER BY b.id ASC
    FOR UPDATE;
  `;
  const lockResult = await client.query(lockSql, [bookingId]);
  if (lockResult.rows.length === 0) {
    return null;
  }

  const booking = lockResult.rows[0];

  // Phase 2: After the lock is acquired, evaluate expiration against clock_timestamp()
  const expirySql = `
    SELECT (created_at < clock_timestamp() - INTERVAL '10 minutes') AS is_expired
    FROM bookings
    WHERE id = $1;
  `;
  const expiryResult = await client.query(expirySql, [bookingId]);
  const isExpired = Boolean(expiryResult.rows[0] && expiryResult.rows[0].is_expired);

  return {
    ...booking,
    isExpired,
  };
}

/**
 * Searches for an existing successful payment record for a booking.
 * Used by the service layer to implement idempotent confirmation responses.
 *
 * @param {object} client - PostgreSQL transaction client
 * @param {number} bookingId - Primary key ID of the booking
 * @returns {Promise<object|null>} Most recent SUCCESS payment record, or null
 */
async function findSuccessfulPaymentByBookingId(client, bookingId) {
  const sql = `
    SELECT 
      id,
      booking_id,
      amount,
      status,
      payment_method,
      transaction_reference,
      created_at
    FROM payments
    WHERE booking_id = $1
      AND status = 'SUCCESS'
    ORDER BY created_at DESC, id DESC
    LIMIT 1;
  `;
  const result = await client.query(sql, [bookingId]);
  return result.rows[0] || null;
}

/**
 * Inserts a new payment record (SUCCESS or FAILED) into the payments table.
 * Does not calculate amounts or generate references; persists service-supplied parameters.
 *
 * @param {object} client - PostgreSQL transaction client
 * @param {object} params
 * @param {number} params.bookingId - Booking ID
 * @param {number|string} params.amount - Payment amount matching total_amount
 * @param {string} params.status - 'SUCCESS' or 'FAILED'
 * @param {string} params.paymentMethod - Validated payment method (e.g. 'MOCK_UPI')
 * @param {string|null} [params.transactionReference=null] - Unique transaction reference string
 * @returns {Promise<object>} Created payment row
 */
async function createPaymentRecord(client, {
  bookingId,
  amount,
  status,
  paymentMethod,
  transactionReference = null,
}) {
  const sql = `
    INSERT INTO payments (
      booking_id,
      amount,
      status,
      payment_method,
      transaction_reference,
      created_at
    )
    VALUES ($1, $2, $3, $4, $5, clock_timestamp())
    RETURNING 
      id,
      booking_id,
      amount,
      status,
      payment_method,
      transaction_reference,
      created_at;
  `;
  const values = [
    bookingId,
    amount,
    status,
    paymentMethod,
    transactionReference,
  ];
  const result = await client.query(sql, values);
  return result.rows[0];
}

/**
 * Updates booking status, issues PNR, and updates updated_at timestamp.
 * Called within a SAVEPOINT retry block in the service layer.
 *
 * @param {object} client - PostgreSQL transaction client
 * @param {object} params
 * @param {number} params.bookingId - Booking ID
 * @param {string} params.pnr - Unique 10-character PNR string
 * @param {string} params.status - Aggregate status ('CONFIRMED', 'PARTIALLY_CONFIRMED', 'RAC')
 * @returns {Promise<object|null>} Updated booking row
 */
async function updateBookingStatusAndPnr(client, { bookingId, pnr, status }) {
  const sql = `
    UPDATE bookings
    SET 
      pnr = $1,
      status = $2,
      updated_at = clock_timestamp()
    WHERE id = $3
    RETURNING 
      id,
      pnr,
      user_id,
      train_id,
      journey_date,
      source_station_id,
      destination_station_id,
      class_code,
      status,
      total_amount,
      created_at,
      updated_at;
  `;
  const result = await client.query(sql, [pnr, status, bookingId]);
  return result.rows[0] || null;
}

/**
 * Transitions all HELD seat allocations for a booking to ACTIVE.
 * Returns both the updated rows and rowCount for service-level verification.
 *
 * @param {object} client - PostgreSQL transaction client
 * @param {number} bookingId - Booking ID
 * @returns {Promise<{ activatedAllocations: Array<object>, rowCount: number }>}
 */
async function activateSeatAllocationsByBookingId(client, bookingId) {
  const sql = `
    UPDATE seat_allocations sa
    SET status = 'ACTIVE'
    FROM booking_passengers bp
    WHERE sa.booking_passenger_id = bp.id
      AND bp.booking_id = $1
      AND sa.status = 'HELD'
    RETURNING 
      sa.id,
      sa.booking_passenger_id,
      sa.seat_id,
      sa.allocation_type,
      sa.rac_slot,
      sa.status;
  `;
  const result = await client.query(sql, [bookingId]);
  return {
    activatedAllocations: result.rows,
    rowCount: result.rowCount,
  };
}

/**
 * Releases expired HELD seat allocations and marks passengers and booking as CANCELLED.
 * Laser-targeted to this specific booking without sweeping unrelated database records.
 *
 * @param {object} client - PostgreSQL transaction client
 * @param {number} bookingId - Booking ID
 * @returns {Promise<{ releasedAllocationsCount: number, cancelledPassengersCount: number, cancelledBooking: object|null }>}
 */
async function releaseExpiredHoldForBooking(client, bookingId) {
  // 1. Release HELD allocations for this booking
  const releaseAllocSql = `
    UPDATE seat_allocations sa
    SET status = 'RELEASED'
    FROM booking_passengers bp
    WHERE sa.booking_passenger_id = bp.id
      AND bp.booking_id = $1
      AND sa.status = 'HELD';
  `;
  const allocResult = await client.query(releaseAllocSql, [bookingId]);

  // 2. Mark booking passengers as CANCELLED
  const cancelPassSql = `
    UPDATE booking_passengers
    SET passenger_status = 'CANCELLED'
    WHERE booking_id = $1;
  `;
  const passResult = await client.query(cancelPassSql, [bookingId]);

  // 3. Mark booking as CANCELLED
  const cancelBookingSql = `
    UPDATE bookings
    SET 
      status = 'CANCELLED',
      updated_at = clock_timestamp()
    WHERE id = $1
    RETURNING id, status, updated_at;
  `;
  const bookingResult = await client.query(cancelBookingSql, [bookingId]);

  return {
    releasedAllocationsCount: allocResult.rowCount,
    cancelledPassengersCount: passResult.rowCount,
    cancelledBooking: bookingResult.rows[0] || null,
  };
}

/**
 * Retrieves full booking, passenger, coach, seat, berth, and RAC details via parameterized JOIN queries.
 *
 * @param {object} client - PostgreSQL transaction client
 * @param {number} bookingId - Booking ID
 * @returns {Promise<object|null>} Structured confirmation data { booking, passengers } or null if not found
 */
async function getBookingConfirmationDetails(client, bookingId) {
  const sql = `
    SELECT 
      b.id AS booking_id,
      b.pnr,
      b.user_id,
      b.train_id,
      b.journey_date,
      b.source_station_id,
      b.destination_station_id,
      b.class_code,
      b.status AS booking_status,
      b.total_amount,
      b.created_at AS booking_created_at,
      b.updated_at AS booking_updated_at,
      bp.id AS passenger_id,
      bp.name_snapshot,
      bp.age_snapshot,
      bp.gender_snapshot,
      bp.passenger_status,
      sa.id AS allocation_id,
      sa.allocation_type,
      sa.rac_slot,
      sa.status AS allocation_status,
      s.id AS seat_id,
      s.seat_number,
      s.berth_type,
      c.id AS coach_id,
      c.coach_number,
      c.coach_type
    FROM bookings b
    JOIN booking_passengers bp ON bp.booking_id = b.id
    LEFT JOIN seat_allocations sa ON sa.booking_passenger_id = bp.id
    LEFT JOIN seats s ON s.id = sa.seat_id
    LEFT JOIN coaches c ON c.id = s.coach_id
    WHERE b.id = $1
    ORDER BY bp.id ASC, sa.id ASC;
  `;
  const result = await client.query(sql, [bookingId]);
  if (result.rows.length === 0) {
    return null;
  }

  const first = result.rows[0];
  const booking = {
    id: Number(first.booking_id),
    pnr: first.pnr,
    userId: Number(first.user_id),
    trainId: Number(first.train_id),
    journeyDate: first.journey_date,
    sourceStationId: Number(first.source_station_id),
    destinationStationId: Number(first.destination_station_id),
    classCode: first.class_code,
    status: first.booking_status,
    totalAmount: first.total_amount,
    createdAt: first.booking_created_at,
    updatedAt: first.booking_updated_at,
  };

  const passengers = result.rows.map((r) => ({
    id: Number(r.passenger_id),
    name: r.name_snapshot,
    age: Number(r.age_snapshot),
    gender: r.gender_snapshot,
    passengerStatus: r.passenger_status,
    allocationType: r.allocation_type || null,
    racSlot: r.rac_slot !== null && r.rac_slot !== undefined ? Number(r.rac_slot) : null,
    allocationStatus: r.allocation_status || null,
    seatId: r.seat_id ? Number(r.seat_id) : null,
    seatNumber: r.seat_number || null,
    berthType: r.berth_type || null,
    coachNumber: r.coach_number || null,
    coachType: r.coach_type || null,
  }));

  return {
    booking,
    passengers,
  };
}

module.exports = {
  lockSeatAllocationsByBookingId,
  lockBookingPassengersByBookingId,
  lockBookingById,
  findSuccessfulPaymentByBookingId,
  createPaymentRecord,
  updateBookingStatusAndPnr,
  activateSeatAllocationsByBookingId,
  releaseExpiredHoldForBooking,
  getBookingConfirmationDetails,
};
