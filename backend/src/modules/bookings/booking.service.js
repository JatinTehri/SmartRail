/**
 * booking.service.js — Business Logic Layer for Bookings & Seat Holds
 *
 * Implements:
 *   - Route segment validation and class availability checking
 *   - SmartRail Demo Fare Model calculation across all 7 supported travel classes
 *   - Authoritative saved passenger profile resolution and preference fallback
 *   - ACID transactional seat hold orchestration with row-level locks
 *   - Segregated allocation pools (Confirmed pool vs RAC pool)
 *   - DTO formatting clearly communicating provisional hold status (PENDING_PAYMENT, HELD)
 */

'use strict';

const pool = require('../../config/db');
const AppError = require('../../errors/AppError');
const trainRepository = require('../trains/train.repository');
const passengerRepository = require('../passengers/passenger.repository');
const bookingRepository = require('./booking.repository');

/**
 * SmartRail Demonstration Fare Configuration
 *
 * Note: These rates and minimum fares are simplified SmartRail demonstration values
 * for educational and portfolio testing purposes. They do NOT represent official
 * Indian Railways passenger fare tables, which use telescopic slabs, superfast surcharges,
 * reservation fees, dynamic pricing, and GST.
 */
const SMARTRAIL_DEMO_FARE_CONFIG = {
  '1A': { ratePerKm: 2.50, minFare: 750 },
  'EC': { ratePerKm: 2.00, minFare: 600 },
  '2A': { ratePerKm: 1.60, minFare: 500 },
  '3A': { ratePerKm: 1.15, minFare: 350 },
  'CC': { ratePerKm: 0.90, minFare: 250 },
  'SL': { ratePerKm: 0.45, minFare: 150 },
  '2S': { ratePerKm: 0.25, minFare: 60 },
};

/**
 * Calculates total ticket fare based on segment distance, class rate, and passenger count.
 *
 * Formula:
 *   perPassengerFare = Math.max(minFare, Math.round(distanceKm * ratePerKm))
 *   totalAmount = perPassengerFare * passengerCount
 *
 * @param {number} distanceKm - Route distance in kilometers (> 0)
 * @param {string} classCode - Travel class code (e.g. '3A', 'SL')
 * @param {number} passengerCount - Positive integer passenger count
 * @returns {number} Calculated total fare in INR
 */
function calculateTotalFare(distanceKm, classCode, passengerCount) {
  const normalizedClass = String(classCode).trim().toUpperCase();
  const config = SMARTRAIL_DEMO_FARE_CONFIG[normalizedClass];
  if (!config) {
    throw new AppError(`Unsupported travel class: ${classCode}`, 400, 'VALIDATION_ERROR');
  }

  if (!Number.isFinite(distanceKm) || distanceKm <= 0) {
    throw new AppError('Journey route distance must be greater than zero', 400, 'VALIDATION_ERROR');
  }

  const rawFare = distanceKm * config.ratePerKm;
  const perPassengerFare = Math.max(config.minFare, Math.round(rawFare));
  return perPassengerFare * passengerCount;
}

/**
 * Resolves passenger identities and preferences.
 * For saved profiles (passengerProfileId supplied), queries DB as authoritative source
 * for name, age, and gender, and applies request preference overrides or profile fallbacks.
 *
 * @param {number} userId - Authenticated user ID
 * @param {Array<object>} rawPassengers - Validated passenger objects from req.body
 * @returns {Promise<Array<object>>} Fully resolved passenger objects with snapshot data
 */
async function resolvePassengers(userId, rawPassengers) {
  const hasProfileId = rawPassengers.some((p) => p.passengerProfileId !== null && p.passengerProfileId !== undefined);
  const profileMap = new Map();

  if (hasProfileId) {
    const userProfiles = await passengerRepository.findAllByUserId(userId);
    for (const prof of userProfiles) {
      profileMap.set(Number(prof.id), prof);
    }
  }

  const resolved = [];
  for (let i = 0; i < rawPassengers.length; i++) {
    const p = rawPassengers[i];
    const index = i + 1;

    if (p.passengerProfileId !== null && p.passengerProfileId !== undefined) {
      const profile = profileMap.get(Number(p.passengerProfileId));
      if (!profile) {
        throw new AppError(
          `Passenger profile not found or does not belong to user at passenger ${index}`,
          404,
          'PASSENGER_NOT_FOUND'
        );
      }

      // Authoritative identity from database profile
      const name = profile.name;
      const age = Number(profile.age);
      const gender = profile.gender;

      // Berth preference handling:
      // - Explicit in request: if 'NONE', client chose no preference -> null; else use requested berth
      // - Omitted in request (undefined): fallback to saved profile preference
      let berthPreference;
      if (p.berthPreference !== undefined) {
        berthPreference = p.berthPreference === 'NONE' ? null : p.berthPreference;
      } else {
        berthPreference = profile.berth_preference || null;
      }

      // Window preference handling:
      // - Explicit boolean in request: preserve explicit true/false
      // - Omitted in request (undefined): fallback to saved profile preference
      let windowPreference;
      if (p.windowPreference !== undefined) {
        windowPreference = Boolean(p.windowPreference);
      } else {
        windowPreference = Boolean(profile.window_preference);
      }

      resolved.push({
        passengerProfileId: Number(profile.id),
        name,
        age,
        gender,
        berthPreference,
        windowPreference,
        seniorCitizenFlag: age >= 60,
      });
    } else {
      // Manual walk-in passenger
      const age = Number(p.age);
      resolved.push({
        passengerProfileId: null,
        name: p.name,
        age,
        gender: p.gender,
        berthPreference: p.berthPreference || null,
        windowPreference: Boolean(p.windowPreference),
        seniorCitizenFlag: age >= 60,
      });
    }
  }

  return resolved;
}

/**
 * Creates a new railway booking and places temporary 10-minute HELD seat allocations.
 *
 * Concurrency & Integrity:
 *   - Runs entirely in one PostgreSQL transaction using pool.connect().
 *   - Eagerly cleans up expired holds (>10 mins) before evaluating availability.
 *   - Locks candidate seats in deterministic ascending order (ORDER BY s.id ASC FOR UPDATE).
 *   - Segregates candidate seats into Confirmed pool (rac_capable = false) and RAC pool (rac_capable = true).
 *   - Allocates available Confirmed berths first, then RAC slot 1, then RAC slot 2 across available RAC berths.
 *   - If capacity is insufficient, rolls back completely and throws HTTP 409 SEATS_UNAVAILABLE.
 *
 * @param {number} userId - Authenticated user ID
 * @param {object} bookingData - Validated booking payload
 * @returns {Promise<object>} Response DTO adhering to docs/API.md
 */
async function createBooking(userId, bookingData) {
  const fromStationId = bookingData.sourceStationId !== undefined ? bookingData.sourceStationId : bookingData.fromStationId;
  const toStationId = bookingData.destinationStationId !== undefined ? bookingData.destinationStationId : bookingData.toStationId;
  const classCodeUpper = String(bookingData.classCode).trim().toUpperCase();

  // 1. Verify train existence, active status, and forward route direction
  const segment = await trainRepository.findRouteSegment({
    trainId: bookingData.trainId,
    fromStationId,
    toStationId,
  });

  if (!segment) {
    const train = await trainRepository.findById(bookingData.trainId);
    if (!train || !train.active) {
      throw new AppError('Train not found', 404, 'NOT_FOUND');
    }
    throw new AppError(
      'Invalid route segment or travel direction for this train',
      400,
      'VALIDATION_ERROR'
    );
  }

  // 2. Verify that the requested class is attached to this train
  const coaches = await trainRepository.findCoachesByTrainId(bookingData.trainId);
  const classAvailable = coaches.some((c) => c.class_code.toUpperCase() === classCodeUpper);
  if (!classAvailable) {
    throw new AppError(
      `Class ${classCodeUpper} is not available on this train`,
      400,
      'VALIDATION_ERROR'
    );
  }

  // 3. Resolve route segment distance from stops
  const stops = await trainRepository.findStopsByTrainId(bookingData.trainId);
  const fromStop = stops.find((s) => Number(s.station_id) === Number(fromStationId));
  const toStop = stops.find((s) => Number(s.station_id) === Number(toStationId));
  if (!fromStop || !toStop) {
    throw new AppError('Route stops not found for the specified stations', 400, 'VALIDATION_ERROR');
  }

  const distanceKm = Number(toStop.distance_km) - Number(fromStop.distance_km);
  if (!Number.isFinite(distanceKm) || distanceKm <= 0) {
    throw new AppError('Journey route distance must be greater than zero', 400, 'VALIDATION_ERROR');
  }

  // 4. Calculate total fare amount using SmartRail Demo Fare Model
  const totalAmount = calculateTotalFare(distanceKm, classCodeUpper, bookingData.passengers.length);

  // 5. Resolve passenger identities and preferences (saved profile vs manual)
  const resolvedPassengers = await resolvePassengers(userId, bookingData.passengers);

  // 6. Begin transaction for seat locking, hold creation, and record insertion
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 6.1 Eagerly release any expired holds older than 10 minutes
    await bookingRepository.releaseExpiredHolds(client);

    // 6.2 Fetch candidate physical seats with row-level locks in deterministic order (ORDER BY s.id ASC FOR UPDATE)
    const candidateSeats = await bookingRepository.findCandidateSeatsWithLock(client, {
      trainId: bookingData.trainId,
      classCode: classCodeUpper,
    });

    // 6.3 Query all overlapping active and held allocations for this train segment
    const seatIds = candidateSeats.map((s) => s.seat_id);
    const overlappingAllocations = await bookingRepository.findOverlappingAllocations(client, {
      seatIds,
      journeyDate: bookingData.journeyDate,
      fromStopOrder: segment.from_stop_order,
      toStopOrder: segment.to_stop_order,
    });

    // 6.4 Group overlapping allocations by seat_id
    const allocationsBySeat = new Map();
    for (const alloc of overlappingAllocations) {
      const sid = Number(alloc.seat_id);
      if (!allocationsBySeat.has(sid)) {
        allocationsBySeat.set(sid, []);
      }
      allocationsBySeat.get(sid).push(alloc);
    }

    // 6.5 Segregate candidate seats into separated pools per approved V1 policy:
    //     - Confirmed Pool: non-RAC-capable seats (s.rac_capable === false)
    //     - RAC Pool: RAC-capable seats (s.rac_capable === true)
    const confirmedPool = candidateSeats.filter((s) => !s.rac_capable);
    const racPool = candidateSeats.filter((s) => s.rac_capable);

    // Available Confirmed Berths: Non-RAC seats with zero overlapping allocations
    const availableConfirmedSeats = confirmedPool.filter((seat) => {
      const allocs = allocationsBySeat.get(Number(seat.seat_id));
      return !allocs || allocs.length === 0;
    });

    // Available RAC Slots:
    // Slot 1 is available if no overlapping allocation has rac_slot === 1.
    // Slot 2 is available if no overlapping allocation has rac_slot === 2.
    // (A confirmed allocation would block both slots, though our policy keeps confirmed on non-RAC seats).
    const availableRacSlots = [];

    // Pass 1: Collect available Slot 1 across RAC-capable berths
    for (const seat of racPool) {
      const existing = allocationsBySeat.get(Number(seat.seat_id)) || [];
      const isConfirmedBlocked = existing.some((a) => a.allocation_type === 'CONFIRMED');
      if (!isConfirmedBlocked) {
        const hasSlot1 = existing.some((a) => a.rac_slot === 1);
        if (!hasSlot1) {
          availableRacSlots.push({ seat, racSlot: 1 });
        }
      }
    }

    // Pass 2: Collect available Slot 2 across RAC-capable berths
    for (const seat of racPool) {
      const existing = allocationsBySeat.get(Number(seat.seat_id)) || [];
      const isConfirmedBlocked = existing.some((a) => a.allocation_type === 'CONFIRMED');
      if (!isConfirmedBlocked) {
        const hasSlot2 = existing.some((a) => a.rac_slot === 2);
        if (!hasSlot2) {
          availableRacSlots.push({ seat, racSlot: 2 });
        }
      }
    }

    // 6.6 Verify sufficient capacity (Confirmed + RAC)
    const totalAvailable = availableConfirmedSeats.length + availableRacSlots.length;
    if (totalAvailable < resolvedPassengers.length) {
      throw new AppError(
        'Insufficient seats available for this journey',
        409,
        'SEATS_UNAVAILABLE'
      );
    }

    // 6.7 Greedily assign seats:
    //     - Exhaust available Confirmed berths first
    //     - Then allocate RAC Slot 1, followed by RAC Slot 2
    const assignedAllocations = [];
    let confirmedIdx = 0;
    let racIdx = 0;

    for (let i = 0; i < resolvedPassengers.length; i++) {
      if (confirmedIdx < availableConfirmedSeats.length) {
        const seat = availableConfirmedSeats[confirmedIdx++];
        assignedAllocations.push({
          seat,
          allocationType: 'CONFIRMED',
          racSlot: null,
          passengerStatus: 'CONFIRMED',
        });
      } else if (racIdx < availableRacSlots.length) {
        const racItem = availableRacSlots[racIdx++];
        assignedAllocations.push({
          seat: racItem.seat,
          allocationType: 'RAC',
          racSlot: racItem.racSlot,
          passengerStatus: 'RAC',
        });
      } else {
        throw new AppError(
          'Insufficient seats available for this journey',
          409,
          'SEATS_UNAVAILABLE'
        );
      }
    }

    // 6.8 Insert the booking record (status: 'PENDING_PAYMENT', pnr: NULL)
    const bookingRecord = await bookingRepository.createBookingRecord(client, {
      userId,
      trainId: bookingData.trainId,
      journeyDate: bookingData.journeyDate,
      sourceStationId: fromStationId,
      destinationStationId: toStationId,
      classCode: classCodeUpper,
      totalAmount,
    });

    // 6.9 Insert passenger snapshot records and provisional HELD seat allocations
    const passengerResponses = [];
    for (let i = 0; i < resolvedPassengers.length; i++) {
      const p = resolvedPassengers[i];
      const alloc = assignedAllocations[i];

      const bp = await bookingRepository.createBookingPassenger(client, {
        bookingId: bookingRecord.id,
        passengerProfileId: p.passengerProfileId,
        nameSnapshot: p.name,
        ageSnapshot: p.age,
        genderSnapshot: p.gender,
        berthPreference: p.berthPreference,
        windowPreference: p.windowPreference,
        seniorCitizenFlag: p.seniorCitizenFlag,
        passengerStatus: alloc.passengerStatus,
      });

      await bookingRepository.createSeatAllocation(client, {
        bookingPassengerId: bp.id,
        seatId: alloc.seat.seat_id,
        journeyDate: bookingData.journeyDate,
        fromStopOrder: segment.from_stop_order,
        toStopOrder: segment.to_stop_order,
        allocationType: alloc.allocationType,
        racSlot: alloc.racSlot,
      });

      passengerResponses.push({
        name: p.name,
        allocationType: alloc.allocationType,
        allocationStatus: 'HELD',
        coach: alloc.seat.coach_number,
        seatNumber: alloc.seat.seat_number,
        berthType: alloc.seat.berth_type,
        racSlot: alloc.racSlot,
      });
    }

    // 6.10 Commit the temporary hold
    await client.query('COMMIT');

    // 7. Format and return response DTO clearly communicating provisional hold status
    return {
      message: 'Booking created and seats temporarily held',
      booking: {
        bookingId: Number(bookingRecord.id),
        pnr: null,
        status: 'PENDING_PAYMENT',
        trainNumber: segment.train_number,
        journeyDate: bookingData.journeyDate,
        source: segment.from_station_name,
        destination: segment.to_station_name,
        classCode: classCodeUpper,
        passengers: passengerResponses,
        totalAmount,
        paymentRequired: true,
      },
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  createBooking,
  calculateTotalFare,
  resolvePassengers,
  SMARTRAIL_DEMO_FARE_CONFIG,
};
