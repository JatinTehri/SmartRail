-- =============================================================================
-- Migration 005 — Service & Support Tables
-- SmartRail Phase 1B
--
-- Creates:
--   1. food_menu_items
--   2. food_orders
--   3. food_order_items
--   4. complaints
--   5. emergency_requests
--   6. notifications
--
-- Dependencies:
--   stations  — created in Migration 001
--   users     — created in Migration 001
--   coaches   — created in Migration 002
--   seats     — created in Migration 002
--   bookings  — created in Migration 003
-- =============================================================================


-- =============================================================================
-- TABLE: food_menu_items
-- =============================================================================
-- Catalog of food & beverage items available for ordering at specific stations.
-- =============================================================================

CREATE TABLE IF NOT EXISTS food_menu_items (
  id          BIGSERIAL     PRIMARY KEY,
  station_id  BIGINT        NOT NULL REFERENCES stations(id),
  name        VARCHAR(150)  NOT NULL,
  description TEXT,
  price       NUMERIC(10,2) NOT NULL CHECK (price >= 0),
  active      BOOLEAN       NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- Index for querying items available at a given station:
CREATE INDEX IF NOT EXISTS idx_food_menu_items_station
  ON food_menu_items (station_id, active);


-- =============================================================================
-- TABLE: food_orders
-- =============================================================================
-- Orders placed by passengers for meal delivery at an upcoming station stop.
-- =============================================================================

CREATE TABLE IF NOT EXISTS food_orders (
  id           BIGSERIAL     PRIMARY KEY,
  booking_id   BIGINT        NOT NULL REFERENCES bookings(id),
  station_id   BIGINT        NOT NULL REFERENCES stations(id),
  status       VARCHAR(30)   NOT NULL
               CHECK (status IN ('PLACED', 'PREPARING', 'DELIVERED', 'CANCELLED')),
  total_amount NUMERIC(10,2) NOT NULL CHECK (total_amount >= 0),
  created_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- Indexes for retrieving orders by booking or station:
CREATE INDEX IF NOT EXISTS idx_food_orders_booking
  ON food_orders (booking_id);

CREATE INDEX IF NOT EXISTS idx_food_orders_station
  ON food_orders (station_id);


-- =============================================================================
-- TABLE: food_order_items
-- =============================================================================
-- Individual items, quantities, and price snapshots for a food order.
-- =============================================================================

CREATE TABLE IF NOT EXISTS food_order_items (
  id            BIGSERIAL     PRIMARY KEY,
  food_order_id BIGINT        NOT NULL REFERENCES food_orders(id) ON DELETE CASCADE,
  item_name     VARCHAR(150)  NOT NULL,
  quantity      INTEGER       NOT NULL CHECK (quantity > 0),
  unit_price    NUMERIC(10,2) NOT NULL CHECK (unit_price >= 0)
);

-- Index for retrieving all line items for an order:
CREATE INDEX IF NOT EXISTS idx_food_order_items_order
  ON food_order_items (food_order_id);


-- =============================================================================
-- TABLE: complaints
-- =============================================================================
-- Cleanliness, maintenance, and service complaints logged by passengers.
-- booking_id is nullable (complaints can be about stations or general facilities).
-- =============================================================================

CREATE TABLE IF NOT EXISTS complaints (
  id          BIGSERIAL   PRIMARY KEY,
  user_id     BIGINT      NOT NULL REFERENCES users(id),
  booking_id  BIGINT      REFERENCES bookings(id),
  category    VARCHAR(50) NOT NULL
              CHECK (category IN (
                'CLEANLINESS',
                'WASHROOM',
                'GARBAGE',
                'WATER',
                'ELECTRICAL',
                'STAFF_BEHAVIOR',
                'OTHER'
              )),
  description TEXT        NOT NULL,
  image_path  TEXT,
  status      VARCHAR(30) NOT NULL
              CHECK (status IN ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'REJECTED')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

-- Indexes for user complaint history and booking lookups:
CREATE INDEX IF NOT EXISTS idx_complaints_user
  ON complaints (user_id);

CREATE INDEX IF NOT EXISTS idx_complaints_booking
  ON complaints (booking_id);


-- =============================================================================
-- TABLE: emergency_requests
-- =============================================================================
-- High-priority assistance requests (medical, security, fire).
-- booking_id, coach_id, and seat_id are nullable to allow flexible reporting
-- even if exact ticket or coach/seat coordinates are unknown.
-- =============================================================================

CREATE TABLE IF NOT EXISTS emergency_requests (
  id           BIGSERIAL   PRIMARY KEY,
  user_id      BIGINT      NOT NULL REFERENCES users(id),
  booking_id   BIGINT      REFERENCES bookings(id),
  coach_id     BIGINT      REFERENCES coaches(id),
  seat_id      BIGINT      REFERENCES seats(id),
  request_type VARCHAR(50) NOT NULL
               CHECK (request_type IN ('MEDICAL', 'SECURITY', 'FIRE', 'OTHER')),
  description  TEXT,
  status       VARCHAR(30) NOT NULL
               CHECK (status IN ('OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'CANCELLED')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at  TIMESTAMPTZ
);

-- Indexes for user history and dashboard queries:
CREATE INDEX IF NOT EXISTS idx_emergency_requests_user
  ON emergency_requests (user_id);

CREATE INDEX IF NOT EXISTS idx_emergency_requests_status
  ON emergency_requests (status);


-- =============================================================================
-- TABLE: notifications
-- =============================================================================
-- In-app notifications for bookings, alerts, and system updates.
-- =============================================================================

CREATE TABLE IF NOT EXISTS notifications (
  id         BIGSERIAL    PRIMARY KEY,
  user_id    BIGINT       NOT NULL REFERENCES users(id),
  title      VARCHAR(150) NOT NULL,
  message    TEXT         NOT NULL,
  type       VARCHAR(30)  NOT NULL,
  is_read    BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Documented index from docs/DATABASE.md §18:
CREATE INDEX IF NOT EXISTS idx_notifications_user_read
  ON notifications (user_id, is_read);
