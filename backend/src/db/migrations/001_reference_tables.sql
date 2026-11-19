-- =============================================================================
-- Migration 001 — Reference Tables
-- SmartRail Phase 1B
--
-- Creates: users, stations, trains
--
-- These three tables have NO foreign keys to other SmartRail tables.
-- They are the foundation that every other table depends on.
-- Run this migration before any other SmartRail migration.
-- =============================================================================


-- =============================================================================
-- TABLE: users
-- =============================================================================
-- Stores every registered user of the SmartRail application.
--
-- Key decisions:
--   BIGSERIAL     → auto-incrementing primary key; no need to supply an id
--                   on INSERT.
--   password_hash → we NEVER store plain-text passwords. The application
--                   layer (bcryptjs, added in Phase 2) will hash the password
--                   before INSERT and compare hashes on login.
--   role          → controls access level. DEFAULT 'USER' means every new
--                   registration is a normal user; an ADMIN must be set
--                   explicitly (e.g. via a seed script or admin panel).
--   CHECK on role → the database itself enforces that only 'USER' and 'ADMIN'
--                   are valid values. An INSERT with role = 'SUPERUSER' would
--                   be rejected by PostgreSQL before it reaches the table.
--   TIMESTAMPTZ   → stores timestamps in UTC with timezone info. Safer than
--                   plain TIMESTAMP for multi-region applications.
--   updated_at    → must be kept current by the application on every UPDATE.
--                   PostgreSQL does not update it automatically in plain SQL
--                   (no ORM magic here). A trigger could do it, but we keep
--                   things simple: the service layer is responsible.
-- =============================================================================

CREATE TABLE IF NOT EXISTS users (
  id            BIGSERIAL     PRIMARY KEY,
  name          VARCHAR(100)  NOT NULL,
  email         VARCHAR(150)  NOT NULL UNIQUE,
  phone         VARCHAR(20)   UNIQUE,
  password_hash TEXT          NOT NULL,
  role          VARCHAR(20)   NOT NULL DEFAULT 'USER'
                              CHECK (role IN ('USER', 'ADMIN')),
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- Index on email: the most common lookup for authentication.
-- Without this index, every login would do a full table scan over all users.
-- With it, PostgreSQL jumps directly to the matching row.
CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);


-- =============================================================================
-- TABLE: stations
-- =============================================================================
-- Represents a physical railway station.
--
-- Key decisions:
--   code    → the short station code used by railways (e.g. 'NDLS' for
--             New Delhi, 'CSTM' for Mumbai CST). UNIQUE because no two
--             stations share the same code.
--   name    → the full human-readable station name.
--   city    → the city the station is in.
--   state   → the state/union territory.
--
-- No timestamps: station records are reference data. They change very
-- rarely (a new station opens, a name changes). A simple created_at
-- is not needed for this portfolio project.
-- =============================================================================

CREATE TABLE IF NOT EXISTS stations (
  id    BIGSERIAL    PRIMARY KEY,
  code  VARCHAR(10)  NOT NULL UNIQUE,
  name  VARCHAR(150) NOT NULL,
  city  VARCHAR(100) NOT NULL,
  state VARCHAR(100) NOT NULL
);

-- Index on code: train search will look up stations by their short code.
CREATE INDEX IF NOT EXISTS idx_stations_code ON stations (code);

-- Index on name: the station autocomplete search box will query by name.
CREATE INDEX IF NOT EXISTS idx_stations_name ON stations (name);


-- =============================================================================
-- TABLE: trains
-- =============================================================================
-- Stores train-level metadata. One row = one train.
--
-- Key decisions:
--   train_number → the unique alphanumeric identifier for a train
--                  (e.g. '12301' for Howrah Rajdhani). UNIQUE.
--   train_name   → the human-readable name (e.g. 'Howrah Rajdhani Express').
--   train_type   → optional category: 'EXPRESS', 'SUPERFAST', 'LOCAL', etc.
--                  Nullable because not all trains have a formal type in this
--                  simulation.
--   active       → whether the train is currently operational. Allows an
--                  admin to soft-disable a train without deleting it.
--                  DEFAULT TRUE means new trains are active by default.
--   created_at   → when the train record was added to the system.
--
-- Note: trains does NOT store the route (list of stops). That lives in
-- train_stops (Migration 002), which references this table via train_id.
-- =============================================================================

CREATE TABLE IF NOT EXISTS trains (
  id           BIGSERIAL    PRIMARY KEY,
  train_number VARCHAR(20)  NOT NULL UNIQUE,
  train_name   VARCHAR(150) NOT NULL,
  train_type   VARCHAR(50),
  active       BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Index on train_number: train search will look trains up by their number.
CREATE INDEX IF NOT EXISTS idx_trains_train_number ON trains (train_number);
