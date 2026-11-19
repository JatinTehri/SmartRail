/**
 * booking.repository.js — Data Access Layer for Bookings & Seat Holds
 *
 * Encapsulates parameterized SQL queries for:
 *   - Releasing expired holds based on bookings.created_at (10-minute expiry)
 *   - Fetching candidate physical seats with row-level locks (SELECT ... FOR UPDATE)
 *   - Detecting overlapping active and held segment allocations
 *   - Inserting pending bookings, passenger snapshots, and held seat allocations
 *
 * All methods accept a shared transaction client managed by the service layer.
 */

'use strict';

/**
 * Releases all expired HELD seat allocations and cancels their stale pending bookings.
 * Uses bookings.created_at as the canonical 10-minute expiry deadline.
 *
 * @param {object} client - PostgreSQL client participating in transaction
 * @returns {Promise<{ releasedAllocations: number, cancelledBookings: number }>}
 */
async function releaseExpiredHolds(client) {
  // 1. Transition HELD allocations to RELEASED for expired pending bookings
  const releaseAllocationsSql = `
    UPDATE seat_allocations sa
    SET status = 'RELEASED'
    FROM booking_passengers bp
    JOIN bookings b ON b.id = bp.booking_id
    WHERE sa.booking_passenger_id = bp.id
      AND sa.status = 'HELD'
      AND b.status = 'PENDING_PAYMENT'
      AND b.created_at < NOW() - INTERVAL '10 minutes';
  `;
  const allocResult = await client.query(releaseAllocationsSql);

  // 2. Mark booking_passengers as CANCELLED for expired pending bookings
  const cancelPassengersSql = `
    UPDATE booking_passengers bp
    SET passenger_status = 'CANCELLED'
    FROM bookings b
    WHERE bp.booking_id = b.id
      AND b.status = 'PENDING_PAYMENT'
      AND b.created_at < NOW() - INTERVAL '10 minutes';
  `;
  await client.query(cancelPassengersSql);

  // 3. Mark the pending bookings as CANCELLED
  const cancelBookingsSql = `
    UPDATE bookings
    SET status = 'CANCELLED', updated_at = NOW()
    WHERE status = 'PENDING_PAYMENT'
      AND created_at < NOW() - INTERVAL '10 minutes';
  `;
  const bookingResult = await client.query(cancelBookingsSql);

  return {
    releasedAllocations: allocResult.rowCount,
    cancelledBookings: bookingResult.rowCount,
  };
}

/**
 * Retrieves physical seats for a train and class, locking candidate seat rows
 * in ascending seat ID order to prevent concurrent race conditions and deadlocks.
 *
 * @param {object} client - PostgreSQL transaction client
 * @param {object} params
 * @param {number} params.trainId - Train ID
 * @param {string} params.classCode - Travel class code (e.g. '3A', 'SL')
 * @returns {Promise<Array<object>>} Locked seat records ordered by s.id ASC
 */
async function findCandidateSeatsWithLock(client, { trainId, classCode }) {
  const sql = `
    SELECT 
      s.id AS seat_id,
      s.coach_id,
      s.seat_number,
      s.berth_type,
      s.position,
      s.is_window,
      s.rac_capable,
      c.coach_number,
      c.coach_type,
      c.class_code
    FROM seats s
    JOIN coaches c ON c.id = s.coach_id
    WHERE c.train_id = $1
      AND UPPER(c.class_code) = UPPER($2)
    ORDER BY s.id ASC
    FOR UPDATE OF s;
  `;
  const result = await client.query(sql, [trainId, classCode]);
  return result.rows;
}

/**
 * Finds all active or held seat allocations overlapping the requested journey segment.
 *
 * Overlap formula for half-open intervals [from_stop_order, to_stop_order):
 *   existing_from < requested_to AND existing_to > requested_from
 *
 * @param {object} client - PostgreSQL transaction client
 * @param {object} params
 * @param {Array<number>} params.seatIds - List of candidate physical seat IDs
 * @param {string} params.journeyDate - Journey date in YYYY-MM-DD
 * @param {number} params.fromStopOrder - Source station stop_order
 * @param {number} params.toStopOrder - Destination station stop_order
 * @returns {Promise<Array<object>>} Overlapping allocations
 */
async function findOverlappingAllocations(client, { seatIds, journeyDate, fromStopOrder, toStopOrder }) {
  if (!seatIds || seatIds.length === 0) {
    return [];
  }

  const sql = `
    SELECT 
      sa.id,
      sa.seat_id,
      sa.booking_passenger_id,
      sa.allocation_type,
      sa.rac_slot,
      sa.status,
      sa.from_stop_order,
      sa.to_stop_order
    FROM seat_allocations sa
    WHERE sa.seat_id = ANY($1)
      AND sa.journey_date = $2
      AND sa.status IN ('HELD', 'ACTIVE')
      AND sa.from_stop_order < $4
      AND sa.to_stop_order > $3;
  `;
  const result = await client.query(sql, [seatIds, journeyDate, fromStopOrder, toStopOrder]);
  return result.rows;
}

/**
 * Inserts a new booking record with status PENDING_PAYMENT and pnr = NULL.
 *
 * @param {object} client - PostgreSQL transaction client
 * @param {object} params
 * @param {number} params.userId - Authenticated user ID
 * @param {number} params.trainId - Train ID
 * @param {string} params.journeyDate - Journey date in YYYY-MM-DD
 * @param {number} params.sourceStationId - Source station ID
 * @param {number} params.destinationStationId - Destination station ID
 * @param {string} params.classCode - Class code
 * @param {number} params.totalAmount - Required total fare amount (CHECK >= 0)
 * @returns {Promise<object>} Created booking row
 */
async function createBookingRecord(client, {
  userId,
  trainId,
  journeyDate,
  sourceStationId,
  destinationStationId,
  classCode,
  totalAmount,
}) {
  const sql = `
    INSERT INTO bookings (
      user_id,
      train_id,
      journey_date,
      source_station_id,
      destination_station_id,
      class_code,
      status,
      total_amount,
      pnr
    )
    VALUES ($1, $2, $3, $4, $5, $6, 'PENDING_PAYMENT', $7, NULL)
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
  const values = [
    userId,
    trainId,
    journeyDate,
    sourceStationId,
    destinationStationId,
    classCode,
    totalAmount,
  ];
  const result = await client.query(sql, values);
  return result.rows[0];
}

/**
 * Inserts a passenger snapshot record into booking_passengers.
 *
 * @param {object} client - PostgreSQL transaction client
 * @param {object} params
 * @param {number} params.bookingId - Associated booking ID
 * @param {number|null} [params.passengerProfileId=null] - Optional reference to saved profile
 * @param {string} params.nameSnapshot - Frozen passenger name
 * @param {number} params.ageSnapshot - Frozen passenger age
 * @param {string} params.genderSnapshot - Frozen passenger gender
 * @param {string|null} [params.berthPreference=null] - Berth preference
 * @param {boolean} [params.windowPreference=false] - Window preference
 * @param {boolean} [params.seniorCitizenFlag=false] - Senior citizen flag (age >= 60)
 * @param {string} params.passengerStatus - Initial status ('CONFIRMED' or 'RAC')
 * @returns {Promise<object>} Created booking_passengers row
 */
async function createBookingPassenger(client, {
  bookingId,
  passengerProfileId = null,
  nameSnapshot,
  ageSnapshot,
  genderSnapshot,
  berthPreference = null,
  windowPreference = false,
  seniorCitizenFlag = false,
  passengerStatus,
}) {
  const sql = `
    INSERT INTO booking_passengers (
      booking_id,
      passenger_profile_id,
      name_snapshot,
      age_snapshot,
      gender_snapshot,
      berth_preference,
      window_preference,
      senior_citizen_flag,
      passenger_status
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    RETURNING 
      id,
      booking_id,
      passenger_profile_id,
      name_snapshot,
      age_snapshot,
      gender_snapshot,
      berth_preference,
      window_preference,
      senior_citizen_flag,
      passenger_status,
      created_at;
  `;
  const values = [
    bookingId,
    passengerProfileId,
    nameSnapshot,
    ageSnapshot,
    genderSnapshot,
    berthPreference,
    windowPreference,
    seniorCitizenFlag,
    passengerStatus,
  ];
  const result = await client.query(sql, values);
  return result.rows[0];
}

/**
 * Inserts a temporary HELD seat allocation for a booking passenger.
 *
 * @param {object} client - PostgreSQL transaction client
 * @param {object} params
 * @param {number} params.bookingPassengerId - Associated booking_passengers ID
 * @param {number} params.seatId - Physical seat ID
 * @param {string} params.journeyDate - Journey date in YYYY-MM-DD
 * @param {number} params.fromStopOrder - Source stop_order
 * @param {number} params.toStopOrder - Destination stop_order
 * @param {string} params.allocationType - 'CONFIRMED' or 'RAC'
 * @param {number|null} [params.racSlot=null] - RAC slot (1 or 2 for RAC, NULL for CONFIRMED)
 * @returns {Promise<object>} Created seat_allocations row with status = 'HELD'
 */
async function createSeatAllocation(client, {
  bookingPassengerId,
  seatId,
  journeyDate,
  fromStopOrder,
  toStopOrder,
  allocationType,
  racSlot = null,
}) {
  const sql = `
    INSERT INTO seat_allocations (
      booking_passenger_id,
      seat_id,
      journey_date,
      from_stop_order,
      to_stop_order,
      allocation_type,
      rac_slot,
      status
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, 'HELD')
    RETURNING 
      id,
      booking_passenger_id,
      seat_id,
      journey_date,
      from_stop_order,
      to_stop_order,
      allocation_type,
      rac_slot,
      status,
      allocated_at;
  `;
  const values = [
    bookingPassengerId,
    seatId,
    journeyDate,
    fromStopOrder,
    toStopOrder,
    allocationType,
    racSlot,
  ];
  const result = await client.query(sql, values);
  return result.rows[0];
}

module.exports = {
  releaseExpiredHolds,
  findCandidateSeatsWithLock,
  findOverlappingAllocations,
  createBookingRecord,
  createBookingPassenger,
  createSeatAllocation,
};
