-- =============================================================================
-- Migration 002 — Train Structure
-- SmartRail Phase 1B
--
-- Creates: train_stops, coaches, seats
--
-- Dependencies (must exist before this file runs):
--   trains    — created in Migration 001
--   stations  — created in Migration 001
--
-- These three tables describe the physical structure of a train:
--   train_stops → the ordered sequence of stations a train visits
--   coaches     → the physical carriages attached to a train
--   seats       → the individual berths/seats inside each coach
-- =============================================================================


-- =============================================================================
-- TABLE: train_stops
-- =============================================================================
-- Represents the ordered route of a train — every station it visits, in order.
--
-- Why this table exists:
--   A train travels through many stations.  SmartRail needs to know the exact
--   sequence because seat availability is segment-based:
--   "Is seat 21 free from stop 2 to stop 4?" requires knowing what stop 2 and
--   stop 4 are, and whether any existing allocation overlaps that range.
--
-- Key decisions:
--
--   train_id → trains.id
--     Foreign key. A stop that references a non-existent train is rejected by
--     PostgreSQL immediately.  This is referential integrity — the database
--     enforces the relationship so the application layer doesn't have to.
--
--   station_id → stations.id
--     Foreign key. Every stop must reference a real, known station.
--
--   stop_order INTEGER NOT NULL
--     The position of this station in the train's route: 1, 2, 3, 4 ...
--     This is a plain integer, not a timestamp, because it is used for
--     arithmetic comparisons in the overlap formula:
--       existing_from < requested_to AND existing_to > requested_from
--     It must always have a value (NOT NULL).
--
--   arrival_time TIME (nullable)
--     The scheduled clock time the train arrives at this station.
--     NULL for the first stop — a train does not "arrive" at its origin.
--     TIME (not TIMESTAMP) because the schedule repeats every day; the
--     calendar date of travel comes from the bookings table, not here.
--
--   departure_time TIME (nullable)
--     The scheduled clock time the train departs this station.
--     NULL for the final stop — a train does not "depart" from its terminus.
--
--   distance_km NUMERIC(8,2) (nullable)
--     Distance information for this stop (cumulative from origin, or per
--     segment — left to seed data convention).  Up to 8 digits, 2 decimal
--     places; e.g. 1384.50 km.  Nullable because not every stop record
--     needs distance data in V1.
--
-- Composite UNIQUE constraints:
--
--   UNIQUE(train_id, stop_order)
--     Within one train, no two stops can share the same position number.
--     Without this, the route ordering is ambiguous and segment-based
--     availability becomes undefined.
--
--   UNIQUE(train_id, station_id)
--     Within one train, no station can appear twice in the route (V1 rule
--     from DATABASE.md §17).  Prevents a train from "looping" through the
--     same station, which would break the overlap formula.
--
-- Note on indexes:
--   PostgreSQL automatically creates a unique index for every UNIQUE
--   constraint.  The two constraints above therefore also create the two
--   indexes specified in DATABASE.md §18 for train_stops:
--     train_stops(train_id, stop_order)
--     train_stops(train_id, station_id)
--   No separate CREATE INDEX statements are needed.
-- =============================================================================

CREATE TABLE IF NOT EXISTS train_stops (
  id             BIGSERIAL    PRIMARY KEY,
  train_id       BIGINT       NOT NULL REFERENCES trains(id),
  station_id     BIGINT       NOT NULL REFERENCES stations(id),
  stop_order     INTEGER      NOT NULL,
  arrival_time   TIME,
  departure_time TIME,
  distance_km    NUMERIC(8,2),

  -- A train cannot have two stops at the same position.
  CONSTRAINT uq_train_stops_train_order   UNIQUE (train_id, stop_order),

  -- A train cannot visit the same station twice (V1 rule).
  CONSTRAINT uq_train_stops_train_station UNIQUE (train_id, station_id)
);


-- =============================================================================
-- TABLE: coaches
-- =============================================================================
-- Represents a physical coach (carriage) attached to a specific train.
--
-- Why this table exists:
--   A train is made up of many coaches.  Each coach has a class (Sleeper, AC)
--   and a fixed number of seats.  When a user selects a class during booking,
--   the system needs to know which coaches of that class exist on the train,
--   and then which seats are inside those coaches.
--
-- Key decisions:
--
--   train_id → trains.id
--     Foreign key.  A coach must belong to a real, known train.
--
--   coach_number VARCHAR(10) NOT NULL
--     The coach's label as it appears on a physical train: 'S1', 'S2', 'B1',
--     'A1', 'H1', 'PANTRY'.  VARCHAR(10) is wide enough for any realistic
--     label.  NOT NULL because every coach must have a label.
--
--   coach_type VARCHAR(30) NOT NULL
--     The physical layout/configuration: 'SLEEPER', 'AC_3_TIER', 'AC_2_TIER',
--     'AC_FIRST', 'CHAIR_CAR', 'SECOND_SITTING'.  NOT NULL.
--
--   class_code VARCHAR(10) NOT NULL
--     The booking class code used during train search and ticket display.
--     From DATABASE.md:  SL, 3A, 2A, 1A, CC, 2S.
--     NOT NULL.
--
--   seat_capacity INTEGER NOT NULL
--     How many seats/berths this coach contains.  Used by seed/admin scripts
--     to know how many seat rows to generate.
--     CHECK (seat_capacity > 0): a coach with zero or fewer seats is
--     logically invalid.  DATABASE.md does not list this check explicitly,
--     but a non-positive capacity is meaningless — flagging this addition.
--
-- Composite UNIQUE constraint:
--
--   UNIQUE(train_id, coach_number)
--     Within one train, no two coaches can share the same label.
--     Coach 'S1' can exist on every train, but one specific train cannot
--     have two coaches both called 'S1'.
--     PostgreSQL also uses this constraint as the index for the query
--     coaches(train_id, coach_number) from DATABASE.md §18.
-- =============================================================================

CREATE TABLE IF NOT EXISTS coaches (
  id            BIGSERIAL   PRIMARY KEY,
  train_id      BIGINT      NOT NULL REFERENCES trains(id),
  coach_number  VARCHAR(10) NOT NULL,
  coach_type    VARCHAR(30) NOT NULL,
  class_code    VARCHAR(10) NOT NULL,
  seat_capacity INTEGER     NOT NULL CHECK (seat_capacity > 0),

  -- Within one train, coach labels must be unique.
  CONSTRAINT uq_coaches_train_coach UNIQUE (train_id, coach_number)
);


-- =============================================================================
-- TABLE: seats
-- =============================================================================
-- Represents one physical seat or berth inside a coach.
--
-- Why this table exists:
--   The Smart Seat Allocation Engine assigns a specific seat to each passenger.
--   To do that, it needs to know what berth type each seat is (LOWER, UPPER…),
--   whether it is a window seat, and whether it is RAC-capable.  Without this
--   table, all seats would look identical and preference-based allocation would
--   be impossible.
--
-- Key decisions:
--
--   coach_id → coaches.id
--     Foreign key.  A seat must belong to a real, known coach.
--
--   seat_number VARCHAR(10) NOT NULL
--     The seat's number within the coach: '1', '21', '63', '72'.
--     VARCHAR (not INTEGER) because some coach layouts may use alphanumeric
--     identifiers.  NOT NULL — every seat must be numbered.
--
--   berth_type VARCHAR(20) NOT NULL
--     The physical position of this berth in the coach.
--     From DATABASE.md:
--       LOWER      — ground-level berth, most accessible, most preferred
--       MIDDLE     — folds up during the day
--       UPPER      — top berth, least accessible
--       SIDE_LOWER — berths at the side end of each compartment
--       SIDE_UPPER — above SIDE_LOWER
--     The allocation engine reads this column to match passenger preferences.
--     NOT NULL — every seat has a berth type.
--
--   position VARCHAR(20) (nullable)
--     Distinguishes whether the seat is in the MAIN section of a compartment
--     (4 berths) or the SIDE section (2 berths).  Examples: 'MAIN', 'SIDE'.
--     Nullable because not all coach types (e.g. Chair Car) use this concept.
--
--   is_window BOOLEAN NOT NULL DEFAULT FALSE
--     TRUE if this seat is beside a window.  The allocation engine uses this
--     to satisfy window preferences.  DATABASE.md specifies DEFAULT FALSE;
--     NOT NULL is added because a boolean allocation flag must never be NULL.
--
--   rac_capable BOOLEAN NOT NULL DEFAULT FALSE
--     TRUE if this berth can be split into two RAC half-berth slots.
--     Only certain lower berths are RAC-capable.  DATABASE.md specifies
--     DEFAULT FALSE; NOT NULL added for the same reason as is_window.
--
-- Composite UNIQUE constraint:
--
--   UNIQUE(coach_id, seat_number)
--     Within one coach, no two seats can share the same number.
--     Seat '21' can exist in both coach S1 and coach S2, but within S1
--     there can only be one seat '21'.
--     PostgreSQL uses this constraint as the index for seats(coach_id,
--     seat_number) from DATABASE.md §18.
-- =============================================================================

CREATE TABLE IF NOT EXISTS seats (
  id          BIGSERIAL   PRIMARY KEY,
  coach_id    BIGINT      NOT NULL REFERENCES coaches(id),
  seat_number VARCHAR(10) NOT NULL,
  berth_type  VARCHAR(20) NOT NULL,
  position    VARCHAR(20),
  is_window   BOOLEAN     NOT NULL DEFAULT FALSE,
  rac_capable BOOLEAN     NOT NULL DEFAULT FALSE,

  -- Within one coach, seat numbers must be unique.
  CONSTRAINT uq_seats_coach_seat UNIQUE (coach_id, seat_number)
);
