/**
 * train.service.js — Business Logic Layer for Trains & Routes
 *
 * Implements route distance, duration calculation, and formatting per docs/API.md.
 */

'use strict';

const pool = require('../../config/db');
const AppError = require('../../errors/AppError');
const trainRepository = require('./train.repository');
const bookingRepository = require('../bookings/booking.repository');

/**
 * Calculates human-readable duration string between two TIME strings (e.g. '06:00:00' and '12:45:00').
 *
 * @param {string} depTime - Departure time (HH:MM:SS)
 * @param {string} arrTime - Arrival time (HH:MM:SS)
 * @returns {string} Formatted duration string, e.g. '6h 45m'
 */
function calculateDuration(depTime, arrTime) {
  if (!depTime || !arrTime) return '0h 0m';

  const [depH, depM] = depTime.split(':').map(Number);
  const [arrH, arrM] = arrTime.split(':').map(Number);

  let diffMinutes = arrH * 60 + arrM - (depH * 60 + depM);
  if (diffMinutes < 0) {
    diffMinutes += 24 * 60; // Cross-midnight fallback
  }

  const hours = Math.floor(diffMinutes / 60);
  const minutes = diffMinutes % 60;

  return `${hours}h ${minutes}m`;
}

/**
 * Formats time string 'HH:MM:SS' into 'HH:MM'.
 *
 * @param {string|null} timeStr
 * @returns {string|null}
 */
function formatTime(timeStr) {
  if (!timeStr) return null;
  const parts = String(timeStr).split(':');
  return `${parts[0]}:${parts[1]}`;
}

/**
 * Searches trains operating between source and destination stations.
 *
 * @param {object} params
 * @param {number} params.fromStationId - Source station ID
 * @param {number} params.toStationId - Destination station ID
 * @param {string} params.journeyDate - Validated ISO date (YYYY-MM-DD)
 * @param {string|null} [params.classCode] - Optional class filter
 * @returns {Promise<Array<object>>} Formatted train search results
 */
async function searchTrains({ fromStationId, toStationId, journeyDate, classCode = null }) {
  const rows = await trainRepository.findTrainsBetweenStations({
    fromStationId,
    toStationId,
    classCode,
  });

  return rows.map((row) => {
    const fromDist = Number(row.from_distance_km) || 0;
    const toDist = Number(row.to_distance_km) || 0;
    const distanceKm = Number((toDist - fromDist).toFixed(2));

    const item = {
      id: Number(row.id),
      trainNumber: row.train_number,
      trainName: row.train_name,
      trainType: row.train_type,
      departure: formatTime(row.departure),
      arrival: formatTime(row.arrival),
      duration: calculateDuration(row.departure, row.arrival),
      distanceKm,
      fromStopOrder: row.from_stop_order,
      toStopOrder: row.to_stop_order,
      classes: row.classes || [],
    };

    if (classCode) {
      item.classCode = classCode;
    }

    return item;
  });
}

/**
 * Retrieves comprehensive details for a train: metadata, ordered route stops, and coaches.
 *
 * @param {number|string} trainId - Train primary key ID
 * @returns {Promise<object>} Formatted { train, stops, coaches }
 * @throws {AppError} 404 NOT_FOUND if train does not exist or is inactive
 */
async function getTrainDetails(trainId) {
  const [train, stops, coaches] = await Promise.all([
    trainRepository.findById(trainId),
    trainRepository.findStopsByTrainId(trainId),
    trainRepository.findCoachesByTrainId(trainId),
  ]);

  if (!train || !train.active) {
    throw new AppError('Train not found', 404, 'NOT_FOUND');
  }

  const formattedTrain = {
    id: Number(train.id),
    trainNumber: train.train_number,
    trainName: train.train_name,
    trainType: train.train_type,
  };

  const formattedStops = stops.map((stop) => ({
    stationId: Number(stop.station_id),
    stationCode: stop.station_code,
    stationName: stop.station_name,
    stationCity: stop.station_city,
    stopOrder: stop.stop_order,
    arrivalTime: formatTime(stop.arrival_time),
    departureTime: formatTime(stop.departure_time),
    distanceKm: Number(stop.distance_km) || 0,
  }));

  const formattedCoaches = coaches.map((coach) => ({
    id: Number(coach.id),
    coachNumber: coach.coach_number,
    coachType: coach.coach_type,
    classCode: coach.class_code,
    seatCapacity: coach.seat_capacity,
  }));

  return {
    train: formattedTrain,
    stops: formattedStops,
    coaches: formattedCoaches,
  };
}

/**
 * Calculates confirmed and RAC seat availability for a journey segment on a train.
 *
 * Business Rules:
 *   - Only HELD and ACTIVE allocations occupy capacity.
 *   - A CONFIRMED allocation blocks the entire physical berth (confirmed = false, RAC slots = 0).
 *   - An RAC-capable berth with even one RAC slot occupied cannot be offered as confirmed.
 *   - An RAC-capable berth with no allocations has both slots [1, 2] available.
 *   - A normal berth (rac_capable = false) never offers RAC slots.
 *   - Confirmed and RAC counts are kept distinct and never added together as physical seats.
 *
 * @param {object} params
 * @param {number} params.trainId - Train primary key ID
 * @param {number} params.fromStationId - Boarding station ID
 * @param {number} params.toStationId - Alighting station ID
 * @param {string} params.journeyDate - ISO date (YYYY-MM-DD)
 * @param {string|null} [params.classCode] - Optional travel class filter
 * @returns {Promise<object>} Formatted availability details
 */
async function getTrainAvailability({
  trainId,
  fromStationId,
  toStationId,
  journeyDate,
  classCode = null,
}) {
  // 1. Resolve and validate route segment
  const segment = await trainRepository.findRouteSegment({
    trainId,
    fromStationId,
    toStationId,
  });

  if (!segment) {
    const train = await trainRepository.findById(trainId);
    if (!train || !train.active) {
      throw new AppError('Train not found', 404, 'NOT_FOUND');
    }
    throw new AppError(
      'Invalid route segment or travel direction for this train',
      400,
      'VALIDATION_ERROR'
    );
  }

  // 2. Eagerly release expired holds (> 10 mins old) before calculating seat availability.
  // Note on HTTP GET: Mutating database state during GET is an intentional SmartRail V1 architectural
  // trade-off (optimistic state reconciliation). It eliminates the need for external background
  // workers/cron daemons while ensuring real-time seat availability accuracy for browsing users.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await bookingRepository.releaseExpiredHolds(client);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  // 3. Fetch all physical seats and any active overlapping allocations
  const rows = await trainRepository.findSeatsWithSegmentAllocations({
    trainId,
    journeyDate,
    fromStopOrder: segment.from_stop_order,
    toStopOrder: segment.to_stop_order,
    classCode,
  });

  // 3. Group rows by coach and seat
  const coachesMap = new Map();

  for (const row of rows) {
    if (!coachesMap.has(row.coach_id)) {
      coachesMap.set(row.coach_id, {
        coachId: Number(row.coach_id),
        coachNumber: row.coach_number,
        coachType: row.coach_type,
        classCode: row.class_code,
        seatCapacity: Number(row.seat_capacity),
        availableConfirmed: 0,
        availableRac: 0,
        seatsMap: new Map(),
      });
    }

    const coach = coachesMap.get(row.coach_id);

    if (!coach.seatsMap.has(row.seat_id)) {
      coach.seatsMap.set(row.seat_id, {
        seatId: Number(row.seat_id),
        seatNumber: row.seat_number,
        berthType: row.berth_type,
        position: row.position,
        isWindow: row.is_window,
        racCapable: row.rac_capable,
        allocations: [],
      });
    }

    if (row.allocation_type) {
      coach.seatsMap.get(row.seat_id).allocations.push({
        type: row.allocation_type,
        racSlot: row.rac_slot,
      });
    }
  }

  // 4. Calculate confirmed and RAC availability per seat, per coach, and per class
  let totalConfirmed = 0;
  let totalRac = 0;
  const classes = {};
  const coachList = [];

  for (const coach of coachesMap.values()) {
    const classCodeKey = coach.classCode;
    if (!classes[classCodeKey]) {
      classes[classCodeKey] = { confirmed: 0, rac: 0 };
    }

    const formattedSeats = [];

    for (const seat of coach.seatsMap.values()) {
      let isConfirmedBlocked = false;
      const occupiedRacSlots = new Set();

      for (const alloc of seat.allocations) {
        if (alloc.type === 'CONFIRMED') {
          isConfirmedBlocked = true;
        } else if (alloc.type === 'RAC') {
          if (alloc.racSlot) {
            occupiedRacSlots.add(alloc.racSlot);
          }
        }
      }

      // Rule: Confirmed is available only if no confirmed allocation AND no RAC allocation
      const isAvailable = !isConfirmedBlocked && occupiedRacSlots.size === 0;

      // Rule: RAC slots calculation
      let racSlotsAvailable = [];
      if (seat.racCapable) {
        if (!isConfirmedBlocked) {
          if (!occupiedRacSlots.has(1)) racSlotsAvailable.push(1);
          if (!occupiedRacSlots.has(2)) racSlotsAvailable.push(2);
        }
      }

      if (isAvailable) {
        coach.availableConfirmed += 1;
        classes[classCodeKey].confirmed += 1;
        totalConfirmed += 1;
      }

      const racCount = racSlotsAvailable.length;
      if (racCount > 0) {
        coach.availableRac += racCount;
        classes[classCodeKey].rac += racCount;
        totalRac += racCount;
      }

      const seatItem = {
        seatId: seat.seatId,
        seatNumber: seat.seatNumber,
        berthType: seat.berthType,
        position: seat.position,
        isWindow: seat.isWindow,
        racCapable: seat.racCapable,
        isAvailable,
      };

      if (seat.racCapable) {
        seatItem.racSlotsAvailable = racSlotsAvailable;
      }

      formattedSeats.push(seatItem);
    }

    coachList.push({
      coachId: coach.coachId,
      coachNumber: coach.coachNumber,
      coachType: coach.coachType,
      classCode: coach.classCode,
      seatCapacity: coach.seatCapacity,
      availableConfirmed: coach.availableConfirmed,
      availableRac: coach.availableRac,
      seats: formattedSeats,
    });
  }

  return {
    trainId: Number(segment.train_id),
    trainNumber: segment.train_number,
    trainName: segment.train_name,
    journeyDate,
    fromStation: {
      id: Number(segment.from_station_id),
      code: segment.from_station_code,
      name: segment.from_station_name,
      stopOrder: segment.from_stop_order,
    },
    toStation: {
      id: Number(segment.to_station_id),
      code: segment.to_station_code,
      name: segment.to_station_name,
      stopOrder: segment.to_stop_order,
    },
    availability: {
      confirmed: totalConfirmed,
      rac: totalRac,
    },
    classes,
    coaches: coachList,
  };
}

module.exports = {
  searchTrains,
  getTrainDetails,
  getTrainAvailability,
  calculateDuration,
  formatTime,
};
