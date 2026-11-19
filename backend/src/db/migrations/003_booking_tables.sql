-- =============================================================================
-- Migration 003 — Booking Tables
-- SmartRail Phase 1B
--
-- Creates: passenger_profiles, bookings, booking_passengers
--
-- Dependencies:
--   users    — created in Migration 001
--   trains   — created in Migration 001
--   stations — created in Migration 001
--
-- Note on table order:
--   1. passenger_profiles depends on users.
--   2. bookings depends on users, trains, and stations.
--   3. booking_passengers depends on bookings and passenger_profiles.
-- =============================================================================


-- =============================================================================
-- TABLE: passenger_profiles
-- =============================================================================
-- Reusable passenger profiles saved by a user for future bookings.
-- Acts as a personal directory / quick-select list.
-- =============================================================================

CREATE TABLE IF NOT EXISTS passenger_profiles (
  id                BIGSERIAL    PRIMARY KEY,
  user_id           BIGINT       NOT NULL REFERENCES users(id),
  name              VARCHAR(100) NOT NULL,
  age               SMALLINT     NOT NULL CHECK (age >= 0 AND age <= 150),
  gender            VARCHAR(20)  NOT NULL,
  berth_preference  VARCHAR(20),
  window_preference BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Index for retrieving all saved passengers for a given user quickly:
CREATE INDEX IF NOT EXISTS idx_passenger_profiles_user_id ON passenger_profiles (user_id);


-- =============================================================================
-- TABLE: bookings
-- =============================================================================
-- Represents one booking / reservation transaction.
--
-- Key decisions:
--   pnr: nullable initially (during PENDING_PAYMENT hold state). Populated
--        with a unique string upon successful payment. The UNIQUE constraint
--        permits multiple NULLs in PostgreSQL while enforcing uniqueness
--        for non-NULL PNR strings.
--   pnr index: the UNIQUE constraint automatically creates a B-tree index
--        for pnr; no redundant explicit index is created.
--   source & destination: both reference stations(id).
--   source <> destination: enforced via CHECK constraint.
-- =============================================================================

CREATE TABLE IF NOT EXISTS bookings (
  id                     BIGSERIAL     PRIMARY KEY,
  pnr                    VARCHAR(20)   UNIQUE,
  user_id                BIGINT        NOT NULL REFERENCES users(id),
  train_id               BIGINT        NOT NULL REFERENCES trains(id),
  journey_date           DATE          NOT NULL,
  source_station_id      BIGINT        NOT NULL REFERENCES stations(id),
  destination_station_id BIGINT        NOT NULL REFERENCES stations(id),
  class_code             VARCHAR(10)   NOT NULL,
  status                 VARCHAR(30)   NOT NULL
                         CHECK (status IN (
                           'PENDING_PAYMENT',
                           'CONFIRMED',
                           'PARTIALLY_CONFIRMED',
                           'RAC',
                           'WAITLIST',
                           'CANCELLED'
                         )),
  total_amount           NUMERIC(10,2) NOT NULL CHECK (total_amount >= 0),
  created_at             TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_bookings_distinct_stations
    CHECK (source_station_id <> destination_station_id)
);

-- Indexes from docs/DATABASE.md §18:
CREATE INDEX IF NOT EXISTS idx_bookings_user_journey  ON bookings (user_id, journey_date);
CREATE INDEX IF NOT EXISTS idx_bookings_train_journey ON bookings (train_id, journey_date);


-- =============================================================================
-- TABLE: booking_passengers
-- =============================================================================
-- Individual passengers associated with a specific booking.
--
-- Passenger Snapshot Pattern:
--   name_snapshot, age_snapshot, and gender_snapshot are copied at booking
--   time. Later edits to a user's passenger_profiles will never modify or
--   corrupt historic booking records.
--
-- passenger_profile_id is nullable:
--   Supports walk-in / guest passengers entered directly without a saved profile.
-- =============================================================================

CREATE TABLE IF NOT EXISTS booking_passengers (
  id                   BIGSERIAL    PRIMARY KEY,
  booking_id           BIGINT       NOT NULL REFERENCES bookings(id),
  passenger_profile_id BIGINT       REFERENCES passenger_profiles(id),
  name_snapshot        VARCHAR(100) NOT NULL,
  age_snapshot         SMALLINT     NOT NULL CHECK (age_snapshot >= 0 AND age_snapshot <= 150),
  gender_snapshot      VARCHAR(20)  NOT NULL,
  berth_preference     VARCHAR(20),
  window_preference    BOOLEAN      NOT NULL DEFAULT FALSE,
  senior_citizen_flag  BOOLEAN      NOT NULL DEFAULT FALSE,
  passenger_status     VARCHAR(30)  NOT NULL
                       CHECK (passenger_status IN (
                         'CONFIRMED',
                         'RAC',
                         'WAITLIST',
                         'CANCELLED'
                       )),
  created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Index from docs/DATABASE.md §18:
CREATE INDEX IF NOT EXISTS idx_booking_passengers_booking_id ON booking_passengers (booking_id);
