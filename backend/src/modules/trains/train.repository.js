/**
 * train.repository.js — Data Access Layer for Trains & Routes
 *
 * Encapsulates all SQL queries against 'trains', 'train_stops', and 'coaches'.
 * Uses parameterized queries to prevent SQL injection.
 */

'use strict';

const pool = require('../../config/db');

/**
 * Finds all active trains operating between source and destination stations.
 *
 * Requirements:
 *   - Self-joins train_stops on train_id
 *   - Enforces forward direction of travel (ts_from.stop_order < ts_to.stop_order)
 *   - Filters active trains (t.active = true)
 *   - Aggregates distinct available coach classes
 *   - Filters by classCode if provided
 *
 * @param {object} params
 * @param {number} params.fromStationId - Origin station ID
 * @param {number} params.toStationId - Destination station ID
 * @param {string|null} [params.classCode] - Optional class filter (e.g. '3A', 'SL')
 * @returns {Promise<Array<object>>} Matching train records
 */
async function findTrainsBetweenStations({ fromStationId, toStationId, classCode = null }) {
  const values = [fromStationId, toStationId];

  let classFilterSql = '';
  if (classCode) {
    values.push(classCode);
    classFilterSql = `AND EXISTS (
      SELECT 1 FROM coaches c2 
      WHERE c2.train_id = t.id AND UPPER(c2.class_code) = UPPER($${values.length})
    )`;
  }

  const sql = `
    SELECT 
      t.id,
      t.train_number,
      t.train_name,
      t.train_type,
      ts_from.departure_time AS departure,
      ts_to.arrival_time AS arrival,
      ts_from.stop_order AS from_stop_order,
      ts_to.stop_order AS to_stop_order,
      ts_from.distance_km AS from_distance_km,
      ts_to.distance_km AS to_distance_km,
      s_from.code AS from_station_code,
      s_from.name AS from_station_name,
      s_to.code AS to_station_code,
      s_to.name AS to_station_name,
      COALESCE(
        ARRAY_AGG(DISTINCT c.class_code ORDER BY c.class_code ASC) FILTER (WHERE c.class_code IS NOT NULL),
        '{}'
      ) AS classes
    FROM trains t
    JOIN train_stops ts_from ON ts_from.train_id = t.id AND ts_from.station_id = $1
    JOIN train_stops ts_to   ON ts_to.train_id = t.id AND ts_to.station_id = $2
    JOIN stations s_from     ON s_from.id = ts_from.station_id
    JOIN stations s_to       ON s_to.id = ts_to.station_id
    LEFT JOIN coaches c      ON c.train_id = t.id
    WHERE t.active = true
      AND ts_from.stop_order < ts_to.stop_order
      ${classFilterSql}
    GROUP BY 
      t.id,
      t.train_number,
      t.train_name,
      t.train_type,
      ts_from.departure_time,
      ts_to.arrival_time,
      ts_from.stop_order,
      ts_to.stop_order,
      ts_from.distance_km,
      ts_to.distance_km,
      s_from.code,
      s_from.name,
      s_to.code,
      s_to.name
    ORDER BY ts_from.departure_time ASC;
  `;

  const result = await pool.query(sql, values);
  return result.rows;
}

/**
 * Retrieves a train by its primary key ID.
 *
 * @param {number|string} id - Train ID
 * @returns {Promise<object|null>} Train record or null
 */
async function findById(id) {
  const sql = `
    SELECT id, train_number, train_name, train_type, active, created_at
    FROM trains
    WHERE id = $1
    LIMIT 1;
  `;
  const result = await pool.query(sql, [id]);
  return result.rows[0] || null;
}

/**
 * Retrieves all scheduled stops for a train, ordered by stop_order ASC.
 * Joins stations to include station details (code, name, city, state).
 *
 * @param {number|string} trainId - Train ID
 * @returns {Promise<Array<object>>} Ordered stop records
 */
async function findStopsByTrainId(trainId) {
  const sql = `
    SELECT 
      ts.id,
      ts.station_id,
      s.code AS station_code,
      s.name AS station_name,
      s.city AS station_city,
      s.state AS station_state,
      ts.stop_order,
      ts.arrival_time,
      ts.departure_time,
      ts.distance_km
    FROM train_stops ts
    JOIN stations s ON s.id = ts.station_id
    WHERE ts.train_id = $1
    ORDER BY ts.stop_order ASC;
  `;
  const result = await pool.query(sql, [trainId]);
  return result.rows;
}

/**
 * Retrieves all physical coaches belonging to a train, ordered by coach_number ASC.
 *
 * @param {number|string} trainId - Train ID
 * @returns {Promise<Array<object>>} Coach records
 */
async function findCoachesByTrainId(trainId) {
  const sql = `
    SELECT 
      id,
      train_id,
      coach_number,
      coach_type,
      class_code,
      seat_capacity
    FROM coaches
    WHERE train_id = $1
    ORDER BY coach_number ASC;
  `;
  const result = await pool.query(sql, [trainId]);
  return result.rows;
}

/**
 * Finds the source and destination stops for a train route segment.
 *
 * Enforces:
 *   - Train must be active (active = true)
 *   - Both stations must exist on the train's route
 *   - Forward direction of travel (from_stop_order < to_stop_order)
 *
 * @param {object} params
 * @param {number} params.trainId - Train primary key ID
 * @param {number} params.fromStationId - Source station ID
 * @param {number} params.toStationId - Destination station ID
 * @returns {Promise<object|null>} Segment stop details or null
 */
async function findRouteSegment({ trainId, fromStationId, toStationId }) {
  const sql = `
    SELECT 
      t.id AS train_id,
      t.train_number,
      t.train_name,
      ts_from.stop_order AS from_stop_order,
      ts_to.stop_order AS to_stop_order,
      s_from.id AS from_station_id,
      s_from.code AS from_station_code,
      s_from.name AS from_station_name,
      s_to.id AS to_station_id,
      s_to.code AS to_station_code,
      s_to.name AS to_station_name
    FROM trains t
    JOIN train_stops ts_from ON ts_from.train_id = t.id AND ts_from.station_id = $2
    JOIN train_stops ts_to   ON ts_to.train_id = t.id AND ts_to.station_id = $3
    JOIN stations s_from     ON s_from.id = ts_from.station_id
    JOIN stations s_to       ON s_to.id = ts_to.station_id
    WHERE t.id = $1 
      AND t.active = true
      AND ts_from.stop_order < ts_to.stop_order
    LIMIT 1;
  `;
  const result = await pool.query(sql, [trainId, fromStationId, toStationId]);
  return result.rows[0] || null;
}

/**
 * Retrieves all physical seats for a train along with any overlapping active/held allocations.
 *
 * Requirements:
 *   - Retrieves all coaches and seats belonging to the train (filtered by optional classCode)
 *   - LEFT JOINs seat_allocations so unallocated seats are never excluded
 *   - Filters allocations inside the LEFT JOIN ON condition to preserve free seats
 *   - Considers allocations matching journey_date and status IN ('HELD', 'ACTIVE')
 *   - Applies segment overlap condition: existing_from < requested_to AND existing_to > requested_from
 *   - Preserves multiple RAC allocation rows (slots 1 and 2) per berth without collapsing them
 *
 * Note on HELD allocation expiration:
 *   The current schema does not have an automated expiration background worker; HELD allocations
 *   are treated as occupied until transitioned to RELEASED by the booking/payment lifecycle.
 *
 * @param {object} params
 * @param {number} params.trainId - Train primary key ID
 * @param {string} params.journeyDate - ISO date (YYYY-MM-DD)
 * @param {number} params.fromStopOrder - Journey source stop_order
 * @param {number} params.toStopOrder - Journey destination stop_order
 * @param {string|null} [params.classCode] - Optional coach class filter
 * @returns {Promise<Array<object>>} Physical seat rows with joined allocation details
 */
async function findSeatsWithSegmentAllocations({
  trainId,
  journeyDate,
  fromStopOrder,
  toStopOrder,
  classCode = null,
}) {
  const values = [trainId, journeyDate, fromStopOrder, toStopOrder];

  let classFilterSql = '';
  if (classCode) {
    values.push(classCode);
    classFilterSql = `AND UPPER(c.class_code) = UPPER($${values.length})`;
  }

  const sql = `
    SELECT 
      c.id AS coach_id,
      c.coach_number,
      c.coach_type,
      c.class_code,
      c.seat_capacity,
      s.id AS seat_id,
      s.seat_number,
      s.berth_type,
      s.position,
      s.is_window,
      s.rac_capable,
      sa.allocation_type,
      sa.rac_slot
    FROM coaches c
    JOIN seats s ON s.coach_id = c.id
    LEFT JOIN seat_allocations sa ON sa.seat_id = s.id
      AND sa.journey_date = $2
      AND sa.status IN ('HELD', 'ACTIVE')
      AND sa.from_stop_order < $4
      AND sa.to_stop_order > $3
    WHERE c.train_id = $1
      ${classFilterSql}
    ORDER BY c.coach_number ASC, s.id ASC;
  `;

  const result = await pool.query(sql, values);
  return result.rows;
}

module.exports = {
  findTrainsBetweenStations,
  findById,
  findStopsByTrainId,
  findCoachesByTrainId,
  findRouteSegment,
  findSeatsWithSegmentAllocations,
};
