-- =============================================================================
-- Migration 004 — Reservation Tables
-- SmartRail Phase 1B
--
-- Creates: seat_allocations, payments
--
-- Dependencies:
--   seats               — created in Migration 002
--   bookings            — created in Migration 003
--   booking_passengers  — created in Migration 003
--
-- Note on design:
--   1. seat_allocations links physical seats to individual booking passengers
--      on a per-journey-date and per-station-segment basis.
--   2. payments tracks financial transactions linked to bookings.
-- =============================================================================


-- =============================================================================
-- TABLE: seat_allocations
-- =============================================================================
-- Represents the reservation of a physical seat for a specific travel segment
-- and journey date.
--
-- Key rules:
--   - Half-open interval: [from_stop_order, to_stop_order)
--   - Two allocations overlap if:
--       existing_from < requested_to AND existing_to > requested_from
--   - allocation_type: 'CONFIRMED' (entire berth) or 'RAC' (half berth)
--   - rac_slot: NULL for CONFIRMED; 1 or 2 for RAC
--   - status: 'HELD', 'ACTIVE', 'CANCELLED', 'RELEASED'
-- =============================================================================

CREATE TABLE IF NOT EXISTS seat_allocations (
  id                   BIGSERIAL    PRIMARY KEY,
  booking_passenger_id BIGINT       NOT NULL REFERENCES booking_passengers(id),
  seat_id              BIGINT       NOT NULL REFERENCES seats(id),
  journey_date         DATE         NOT NULL,
  from_stop_order      INTEGER      NOT NULL,
  to_stop_order        INTEGER      NOT NULL,
  allocation_type      VARCHAR(20)  NOT NULL,
  rac_slot             SMALLINT,
  status               VARCHAR(20)  NOT NULL,
  allocated_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  -- Stop order must travel forward
  CONSTRAINT chk_seat_allocations_stop_order
    CHECK (from_stop_order < to_stop_order),

  -- Valid allocation types
  CONSTRAINT chk_seat_allocations_type
    CHECK (allocation_type IN ('CONFIRMED', 'RAC')),

  -- Valid status lifecycle
  CONSTRAINT chk_seat_allocations_status
    CHECK (status IN ('HELD', 'ACTIVE', 'CANCELLED', 'RELEASED')),

  -- RAC slot integrity: Confirmed allocations must NOT have an RAC slot.
  -- RAC allocations MUST have rac_slot as 1 or 2 (explicitly NOT NULL to prevent SQL 3VL UNKNOWN).
  CONSTRAINT chk_seat_allocations_rac_slot
    CHECK (
      (allocation_type = 'CONFIRMED' AND rac_slot IS NULL) OR
      (allocation_type = 'RAC' AND rac_slot IS NOT NULL AND rac_slot IN (1, 2))
    )
);

-- Foreign key lookup index:
CREATE INDEX IF NOT EXISTS idx_seat_allocations_booking_passenger
  ON seat_allocations (booking_passenger_id);

-- Documented indexes from docs/DATABASE.md §18:
CREATE INDEX IF NOT EXISTS idx_seat_allocations_seat_date
  ON seat_allocations (seat_id, journey_date);

CREATE INDEX IF NOT EXISTS idx_seat_allocations_date_segment
  ON seat_allocations (journey_date, from_stop_order, to_stop_order);


-- =============================================================================
-- TABLE: payments
-- =============================================================================
-- Tracks monetary transactions associated with bookings.
-- V1 supports simulated / mock payments.
-- =============================================================================

CREATE TABLE IF NOT EXISTS payments (
  id                    BIGSERIAL     PRIMARY KEY,
  booking_id            BIGINT        NOT NULL REFERENCES bookings(id),
  amount                NUMERIC(10,2) NOT NULL CHECK (amount >= 0),
  status                VARCHAR(20)   NOT NULL
                        CHECK (status IN ('PENDING', 'SUCCESS', 'FAILED', 'CANCELLED', 'REFUNDED')),
  payment_method        VARCHAR(30)   NOT NULL,
  transaction_reference VARCHAR(100)  UNIQUE,
  created_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- Index for retrieving payment records for a booking:
CREATE INDEX IF NOT EXISTS idx_payments_booking_id
  ON payments (booking_id);
