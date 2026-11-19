/**
 * seed.js — SmartRail Development Database Seeder
 *
 * Populates:
 *   - 5 Stations
 *   - 2 Demonstration Trains
 *   - 9 Train Stops (single-day schedules)
 *   - 4 Coaches
 *   - 276 Physical Seats (generated via coachLayout helper)
 *   - 11 Food Menu Items
 *
 * Rules:
 *   - Strictly forbidden outside 'development' environment (NODE_ENV !== 'development').
 *   - Runs inside a single ACID transaction.
 *   - Uses PostgreSQL advisory lock: pg_advisory_xact_lock(hashtext('smartrail_seed_lock')::bigint).
 *   - 100% idempotent: safe to run multiple times.
 */

'use strict';

const path = require('path');

// 1. Load backend environment file FIRST, before inspecting any variables:
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });

// 2. Strict production and environment guard:
if (process.env.NODE_ENV !== 'development') {
  console.error(`[FATAL] Database seeding is permitted ONLY when NODE_ENV === 'development'. Current NODE_ENV: '${process.env.NODE_ENV}'. Aborting.`);
  process.exit(1);
}

const pool = require('../../config/db');
const stationsData = require('./data/stations');
const trainsData = require('./data/trains');
const foodMenuData = require('./data/foodMenu');
const { generateLhbSeats } = require('./helpers/coachLayout');

async function runSeed() {
  console.log('SmartRail — Development Seed Runner');
  console.log('Environment: development');
  console.log('─'.repeat(55));

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Acquire transaction-level advisory lock to serialize seed execution
    await client.query("SELECT pg_advisory_xact_lock(hashtext('smartrail_seed_lock')::bigint)");

    // -------------------------------------------------------------------------
    // 1. Seed Stations
    // -------------------------------------------------------------------------
    const stationIdMap = new Map(); // code -> id

    for (const s of stationsData) {
      const res = await client.query(`
        INSERT INTO stations (code, name, city, state)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (code)
        DO UPDATE SET name = EXCLUDED.name, city = EXCLUDED.city, state = EXCLUDED.state
        RETURNING id, code
      `, [s.code, s.name, s.city, s.state]);

      stationIdMap.set(res.rows[0].code, res.rows[0].id);
    }
    console.log(`✓ Stations seeded: ${stationIdMap.size}`);

    // -------------------------------------------------------------------------
    // 2. Seed Trains, Stops, Coaches, and Seats
    // -------------------------------------------------------------------------
    let totalStopsCount = 0;
    let totalCoachesCount = 0;
    let totalSeatsCount = 0;

    for (const t of trainsData) {
      // 2a. Train record
      const tRes = await client.query(`
        INSERT INTO trains (train_number, train_name, train_type, active)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (train_number)
        DO UPDATE SET train_name = EXCLUDED.train_name, train_type = EXCLUDED.train_type, active = EXCLUDED.active
        RETURNING id
      `, [t.train_number, t.train_name, t.train_type, t.active]);

      const trainId = tRes.rows[0].id;

      // 2b. Train stops
      for (const stop of t.stops) {
        const stationId = stationIdMap.get(stop.station_code);
        if (!stationId) {
          throw new Error(`Station code '${stop.station_code}' not found in stationIdMap`);
        }

        await client.query(`
          INSERT INTO train_stops (train_id, station_id, stop_order, arrival_time, departure_time, distance_km)
          VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT (train_id, stop_order)
          DO UPDATE SET station_id = EXCLUDED.station_id, arrival_time = EXCLUDED.arrival_time, departure_time = EXCLUDED.departure_time, distance_km = EXCLUDED.distance_km
        `, [trainId, stationId, stop.stop_order, stop.arrival_time, stop.departure_time, stop.distance_km]);

        totalStopsCount++;
      }

      // 2c. Coaches & Seats
      for (const c of t.coaches) {
        const cRes = await client.query(`
          INSERT INTO coaches (train_id, coach_number, coach_type, class_code, seat_capacity)
          VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT (train_id, coach_number)
          DO UPDATE SET coach_type = EXCLUDED.coach_type, class_code = EXCLUDED.class_code, seat_capacity = EXCLUDED.seat_capacity
          RETURNING id
        `, [trainId, c.coach_number, c.coach_type, c.class_code, c.seat_capacity]);

        const coachId = cRes.rows[0].id;
        totalCoachesCount++;

        // Generate physical seats using layout helper
        const seats = generateLhbSeats(c.coach_type, c.class_code, c.seat_capacity);
        for (const seat of seats) {
          await client.query(`
            INSERT INTO seats (coach_id, seat_number, berth_type, position, is_window, rac_capable)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (coach_id, seat_number)
            DO UPDATE SET berth_type = EXCLUDED.berth_type, position = EXCLUDED.position, is_window = EXCLUDED.is_window, rac_capable = EXCLUDED.rac_capable
          `, [coachId, seat.seat_number, seat.berth_type, seat.position, seat.is_window, seat.rac_capable]);

          totalSeatsCount++;
        }
      }
    }

    console.log(`✓ Trains seeded: ${trainsData.length}`);
    console.log(`✓ Train stops seeded: ${totalStopsCount}`);
    console.log(`✓ Coaches seeded: ${totalCoachesCount}`);
    console.log(`✓ Physical seats seeded: ${totalSeatsCount}`);

    // -------------------------------------------------------------------------
    // 3. Seed Food Menu Items (Idempotent check-and-upsert)
    // -------------------------------------------------------------------------
    let foodItemsCount = 0;

    for (const item of foodMenuData) {
      const stationId = stationIdMap.get(item.station_code);
      if (!stationId) {
        throw new Error(`Station code '${item.station_code}' not found in stationIdMap`);
      }

      const existing = await client.query(`
        SELECT id FROM food_menu_items
        WHERE station_id = $1 AND name = $2
      `, [stationId, item.name]);

      if (existing.rows.length > 0) {
        await client.query(`
          UPDATE food_menu_items
          SET description = $1, price = $2, active = $3
          WHERE id = $4
        `, [item.description, item.price, item.active, existing.rows[0].id]);
      } else {
        await client.query(`
          INSERT INTO food_menu_items (station_id, name, description, price, active)
          VALUES ($1, $2, $3, $4, $5)
        `, [stationId, item.name, item.description, item.price, item.active]);
      }

      foodItemsCount++;
    }

    console.log(`✓ Food menu items seeded: ${foodItemsCount}`);

    await client.query('COMMIT');
    console.log('─'.repeat(55));
    console.log('✅ Database seeding transaction completed successfully.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Database seeding failed, transaction rolled back:', err);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

runSeed().catch(() => {
  process.exit(1);
});
