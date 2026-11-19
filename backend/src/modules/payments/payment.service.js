/**
 * payment.service.js — Business Logic Layer for Payments & Booking Confirmation
 *
 * Implements:
 *   - ACID transactional payment orchestration with row-level locks
 *   - Hierarchical lock order: seat_allocations -> booking_passengers -> bookings
 *   - Live database wall-clock expiration check via clock_timestamp()
 *   - Strengthened allocation integrity verification (8 rules)
 *   - SmartRail Internal Business Policy for aggregate booking status (CONFIRMED, PARTIALLY_CONFIRMED, RAC)
 *   - Atomic PNR assignment with SAVEPOINT collision retries
 *   - Allocation activation (HELD -> ACTIVE) with row count verification
 *   - Retryable failed payment policy (audit row inserted, booking stays PENDING_PAYMENT, holds retained)
 *   - Idempotent payment replay handling and data corruption detection
 *   - Guaranteed PostgreSQL client release in finally
 */

'use strict';

const crypto = require('crypto');
const pool = require('../../config/db');
const AppError = require('../../errors/AppError');
const paymentRepository = require('./payment.repository');
const pnrUtil = require('../../utils/pnr');

/**
 * Validates the physical seat allocations against the booking passengers.
 * Enforces all 8 integrity rules using the already-locked passenger and allocation rows.
 *
 * @param {Array<object>} passengers - Locked booking_passengers rows
 * @param {Array<object>} allocations - Locked seat_allocations rows
 * @throws {AppError} 409 if any integrity constraint is violated
 */
function verifyAllocationIntegrity(passengers, allocations) {
  if (!passengers || passengers.length === 0) {
    throw new AppError('Booking contains no passengers', 409, 'ALLOCATION_INTEGRITY_ERROR');
  }

  if (!allocations || allocations.length !== passengers.length) {
    throw new AppError(
      'Mismatch between passenger count and seat allocation count',
      409,
      'ALLOCATION_INTEGRITY_ERROR'
    );
  }

  const passengerMap = new Map(passengers.map((p) => [Number(p.id), p]));
  const seenPassengerIds = new Set();
  const confirmedSeatIds = new Set();
  const racBerthSlots = new Set(); // Key: `${seatId}:${slot}`
  const racSeatIds = new Set();

  for (const alloc of allocations) {
    const passengerId = Number(alloc.booking_passenger_id);
    const passenger = passengerMap.get(passengerId);

    // Rule 3: Every allocation must belong to a passenger in this booking
    if (!passenger) {
      throw new AppError(
        `Allocation ${alloc.id} does not belong to a passenger in this booking`,
        409,
        'ALLOCATION_INTEGRITY_ERROR'
      );
    }

    // Rule 4: Exactly one allocation per passenger (no duplicates)
    if (seenPassengerIds.has(passengerId)) {
      throw new AppError(
        `Duplicate seat allocation found for passenger ${passengerId}`,
        409,
        'ALLOCATION_INTEGRITY_ERROR'
      );
    }
    seenPassengerIds.add(passengerId);

    // Rule 1: Passenger status must be strictly CONFIRMED or RAC
    if (!['CONFIRMED', 'RAC'].includes(passenger.passenger_status)) {
      throw new AppError(
        `Unsupported passenger status for confirmation: ${passenger.passenger_status}`,
        409,
        'ALLOCATION_INTEGRITY_ERROR'
      );
    }

    // Rule 5: All allocations must be HELD
    if (alloc.status !== 'HELD') {
      throw new AppError(
        `Allocation ${alloc.id} is not in HELD status (current: ${alloc.status})`,
        409,
        'ALLOCATION_INTEGRITY_ERROR'
      );
    }

    const seatId = Number(alloc.seat_id);

    // Rule 6: Status-to-type consistency & physical berth collisions
    if (passenger.passenger_status === 'CONFIRMED') {
      if (alloc.allocation_type !== 'CONFIRMED' || alloc.rac_slot !== null) {
        throw new AppError(
          `Invalid allocation type or RAC slot for CONFIRMED passenger ${passengerId}`,
          409,
          'ALLOCATION_INTEGRITY_ERROR'
        );
      }

      // Rule 7A: Two CONFIRMED passengers cannot share the same physical seat
      if (confirmedSeatIds.has(seatId)) {
        throw new AppError(
          `Multiple CONFIRMED passengers assigned to physical seat ${seatId}`,
          409,
          'ALLOCATION_INTEGRITY_ERROR'
        );
      }

      // Rule 7B: CONFIRMED passenger cannot share berth with an RAC passenger
      if (racSeatIds.has(seatId)) {
        throw new AppError(
          `Physical berth ${seatId} is shared between CONFIRMED and RAC passengers`,
          409,
          'ALLOCATION_INTEGRITY_ERROR'
        );
      }

      confirmedSeatIds.add(seatId);
    } else if (passenger.passenger_status === 'RAC') {
      const slot = Number(alloc.rac_slot);
      if (alloc.allocation_type !== 'RAC' || ![1, 2].includes(slot)) {
        throw new AppError(
          `Invalid allocation type or RAC slot for RAC passenger ${passengerId}`,
          409,
          'ALLOCATION_INTEGRITY_ERROR'
        );
      }

      // Rule 7B: RAC passenger cannot share berth with a CONFIRMED passenger
      if (confirmedSeatIds.has(seatId)) {
        throw new AppError(
          `Physical berth ${seatId} is shared between CONFIRMED and RAC passengers`,
          409,
          'ALLOCATION_INTEGRITY_ERROR'
        );
      }

      // Rule 8: Two RAC passengers cannot share the same RAC slot on the same physical berth
      const berthSlotKey = `${seatId}:${slot}`;
      if (racBerthSlots.has(berthSlotKey)) {
        throw new AppError(
          `Duplicate RAC slot ${slot} assigned on physical seat ${seatId}`,
          409,
          'ALLOCATION_INTEGRITY_ERROR'
        );
      }

      racBerthSlots.add(berthSlotKey);
      racSeatIds.add(seatId);
    }
  }
}

/**
 * Computes the aggregate booking status from the locked passenger statuses.
 * Defines SmartRail's internal business policy:
 *   - All CONFIRMED -> 'CONFIRMED'
 *   - All RAC -> 'RAC'
 *   - Mixture of CONFIRMED & RAC -> 'PARTIALLY_CONFIRMED'
 *
 * @param {Array<object>} passengers - List of booking passengers
 * @returns {string} 'CONFIRMED' | 'PARTIALLY_CONFIRMED' | 'RAC'
 */
function determineAggregateBookingStatus(passengers) {
  const hasConfirmed = passengers.some((p) => p.passenger_status === 'CONFIRMED');
  const hasRac = passengers.some((p) => p.passenger_status === 'RAC');

  if (hasConfirmed && hasRac) {
    return 'PARTIALLY_CONFIRMED';
  }
  if (hasRac && !hasConfirmed) {
    return 'RAC';
  }
  return 'CONFIRMED';
}

/**
 * Assigns a PNR and updates booking status inside a SAVEPOINT retry block.
 * Retries only PostgreSQL unique constraint violations (23505) on 'bookings_pnr_key'.
 *
 * @param {object} client - PostgreSQL transaction client
 * @param {number} bookingId - Booking ID
 * @param {string} aggregateStatus - Derived booking status
 * @returns {Promise<string>} Successfully assigned PNR
 */
async function assignPnrWithSavepoint(client, bookingId, aggregateStatus) {
  const MAX_RETRIES = 3;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const candidatePnr = pnrUtil.generatePnr();
    try {
      await client.query('SAVEPOINT pnr_attempt');

      const updatedBooking = await paymentRepository.updateBookingStatusAndPnr(client, {
        bookingId,
        pnr: candidatePnr,
        status: aggregateStatus,
      });

      if (!updatedBooking || Number(updatedBooking.id) !== Number(bookingId)) {
        throw new AppError(
          'Failed to update booking status. Row count mismatch.',
          500,
          'BOOKING_UPDATE_FAILED'
        );
      }

      await client.query('RELEASE SAVEPOINT pnr_attempt');
      return candidatePnr;
    } catch (err) {
      if (err.code === '23505' && err.constraint === 'bookings_pnr_key') {
        await client.query('ROLLBACK TO SAVEPOINT pnr_attempt');
        if (attempt === MAX_RETRIES) {
          throw new AppError(
            'Unable to generate a unique PNR after multiple attempts',
            500,
            'PNR_GENERATION_FAILED'
          );
        }
        continue;
      }
      // Any other error (unrelated unique violation or query failure) rethrows to trigger full rollback
      throw err;
    }
  }
}

/**
 * Processes mock payment and booking confirmation within an ACID transaction.
 *
 * @param {number|string} userId - Authenticated user ID (from req.user.id)
 * @param {object} paymentData - Validated payload from payment.validator.js
 * @param {number} paymentData.bookingId - Target booking ID
 * @param {string} [paymentData.paymentMethod='MOCK_UPI'] - Payment method
 * @param {boolean} [paymentData.simulateFailure=false] - Simulation flag
 * @returns {Promise<object>} Result DTO with statusCode and confirmation/failure payload
 */
async function processPayment(userId, paymentData) {
  const { bookingId, paymentMethod = 'MOCK_UPI', simulateFailure = false } = paymentData;

  const client = await pool.connect();
  let isCommitted = false;

  try {
    await client.query('BEGIN');

    // 1. Hierarchical Row Locking (seat_allocations -> booking_passengers -> bookings)
    const lockedAllocations = await paymentRepository.lockSeatAllocationsByBookingId(client, bookingId);
    const lockedPassengers = await paymentRepository.lockBookingPassengersByBookingId(client, bookingId);
    const lockedBooking = await paymentRepository.lockBookingById(client, bookingId);

    // 2. Validate Booking Existence
    if (!lockedBooking) {
      throw new AppError('Booking not found', 404, 'BOOKING_NOT_FOUND');
    }

    // 3. Validate Authenticated Ownership
    if (Number(lockedBooking.user_id) !== Number(userId)) {
      throw new AppError(
        'You do not have permission to pay for this booking',
        403,
        'FORBIDDEN'
      );
    }

    // 4. Look Up Any Existing Successful Payment (for Idempotency and Corruption Detection)
    const existingPayment = await paymentRepository.findSuccessfulPaymentByBookingId(client, bookingId);

    // 5. Handle Already-Confirmed Bookings (Idempotency vs Corruption)
    if (['CONFIRMED', 'PARTIALLY_CONFIRMED', 'RAC'].includes(lockedBooking.status)) {
      if (!existingPayment) {
        throw new AppError(
          'Booking is marked confirmed but no successful payment record was found. Data integrity violation.',
          500,
          'PAYMENT_DATA_CORRUPTION'
        );
      }

      const confirmationDetails = await paymentRepository.getBookingConfirmationDetails(client, bookingId);
      await client.query('COMMIT');
      isCommitted = true;

      return {
        success: true,
        statusCode: 200,
        message: 'Booking is already confirmed',
        isIdempotent: true,
        payment: existingPayment,
        booking: confirmationDetails ? confirmationDetails.booking : lockedBooking,
        passengers: confirmationDetails ? confirmationDetails.passengers : [],
      };
    }

    // 6. Data Corruption Guard: Pending Booking with Existing Successful Payment
    if (existingPayment) {
      throw new AppError(
        'A successful payment record already exists for this pending booking. Data integrity violation.',
        500,
        'PAYMENT_DATA_CORRUPTION'
      );
    }

    // 7. Reject Cancelled Bookings
    if (lockedBooking.status === 'CANCELLED') {
      throw new AppError(
        'Booking has been cancelled and cannot be paid',
        400,
        'BOOKING_ALREADY_CANCELLED'
      );
    }

    // 8. Reject Any Other Non-Pending Booking Status
    if (lockedBooking.status !== 'PENDING_PAYMENT') {
      throw new AppError(
        `Invalid booking status for payment: ${lockedBooking.status}`,
        400,
        'INVALID_BOOKING_STATUS'
      );
    }

    // 9. Expiration Check via PostgreSQL clock_timestamp() (after acquiring locks)
    if (lockedBooking.isExpired) {
      await paymentRepository.releaseExpiredHoldForBooking(client, bookingId);
      await client.query('COMMIT');
      isCommitted = true;

      throw new AppError(
        'Booking hold has expired and seats have been released',
        410,
        'BOOKING_HOLD_EXPIRED'
      );
    }

    // 10. Allocation Integrity Verification (Rules 1-8)
    // Must run BEFORE simulateFailure so simulated failures only apply to valid provisional bookings
    verifyAllocationIntegrity(lockedPassengers, lockedAllocations);

    // 11. Simulated Failed Payment Branch
    if (simulateFailure === true) {
      const txnRef = `TXN_FAIL_${crypto.randomUUID()}`;
      const failedPayment = await paymentRepository.createPaymentRecord(client, {
        bookingId: lockedBooking.id,
        amount: lockedBooking.total_amount,
        status: 'FAILED',
        paymentMethod,
        transactionReference: txnRef,
      });

      // Commit the failed payment audit record.
      // Booking remains PENDING_PAYMENT and allocations remain HELD within original 10-min window.
      await client.query('COMMIT');
      isCommitted = true;

      return {
        success: false,
        statusCode: 402,
        message: 'Payment simulation failed. Your seats remain held within the 10-minute window. You may retry.',
        payment: failedPayment,
        booking: {
          id: lockedBooking.id,
          status: lockedBooking.status,
        },
      };
    }

    // 12. Successful Payment Confirmation Path
    // Compute aggregate booking status from passenger composition
    const aggregateStatus = determineAggregateBookingStatus(lockedPassengers);

    // 13. Assign PNR with SAVEPOINT Collision Retry & Verify Row Count = 1
    await assignPnrWithSavepoint(client, lockedBooking.id, aggregateStatus);

    // 14. Activate Seat Allocations (HELD -> ACTIVE) & Verify Row Count = Expected Count
    const activationResult = await paymentRepository.activateSeatAllocationsByBookingId(client, lockedBooking.id);
    if (activationResult.rowCount !== lockedAllocations.length) {
      throw new AppError(
        'Seat allocation activation mismatch. Rolling back.',
        500,
        'ALLOCATION_ACTIVATION_FAILED'
      );
    }

    // 15. Insert SUCCESS Payment Record
    const txnRef = `TXN_MOCK_${crypto.randomUUID()}`;
    const successPayment = await paymentRepository.createPaymentRecord(client, {
      bookingId: lockedBooking.id,
      amount: lockedBooking.total_amount,
      status: 'SUCCESS',
      paymentMethod,
      transactionReference: txnRef,
    });

    // 16. Fetch Joined Confirmation Details BEFORE Commit
    // Ensures any assembly error triggers a clean rollback before persistence
    const confirmation = await paymentRepository.getBookingConfirmationDetails(client, lockedBooking.id);
    if (!confirmation || !confirmation.passengers || confirmation.passengers.length === 0) {
      throw new AppError(
        'Failed to retrieve booking confirmation details after payment',
        500,
        'CONFIRMATION_RETRIEVAL_FAILED'
      );
    }

    // 17. Commit All Changes Atomically
    await client.query('COMMIT');
    isCommitted = true;

    return {
      success: true,
      statusCode: 200,
      message: 'Payment successful and booking confirmed',
      isIdempotent: false,
      payment: successPayment,
      booking: confirmation.booking,
      passengers: confirmation.passengers,
    };
  } catch (err) {
    if (!isCommitted) {
      try {
        await client.query('ROLLBACK');
      } catch (_) {
        // Ignore rollback failure if connection was lost
      }
    }
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  processPayment,
  verifyAllocationIntegrity,
  determineAggregateBookingStatus,
  assignPnrWithSavepoint,
};
