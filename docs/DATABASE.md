# Database Design — SmartRail

## 1. Purpose

SmartRail uses PostgreSQL as its primary database.

The database must support:

- User accounts and authentication
- Saved passenger profiles
- Trains and ordered routes
- Coaches and physical seats
- Journey-date-specific seat allocations
- Group bookings
- RAC allocation
- Payments
- Food orders
- Complaints
- Emergency requests
- Notifications

The design gives special attention to **seat availability by journey segment** because a physical seat can be used by different passengers on non-overlapping parts of the same train route.

---

# 2. Core Modeling Principle

A physical seat is not permanently occupied for an entire train journey.

Example:

```text
Delhi ─── Jaipur ─── Kota ─── Mumbai
  1          2         3          4

Seat 21

Passenger A: Delhi → Kota
Passenger B: Kota → Mumbai
```

This can be valid because the two journey segments do not overlap.

Therefore, SmartRail separates:

```text
Physical Seat
      ↓
Seat Allocation
      ↓
Journey Date + From Stop + To Stop
```

We do **not** store the final seat assignment directly as the only seat field on a booking.

---

# 3. Entity Overview

```text
USERS
  ├──< PASSENGER_PROFILES
  ├──< BOOKINGS
  └──< NOTIFICATIONS

TRAINS
  ├──< TRAIN_STOPS >── STATIONS
  └──< COACHES
          └──< SEATS

BOOKINGS
  ├──< BOOKING_PASSENGERS
  │        └──< SEAT_ALLOCATIONS >── SEATS
  ├──< PAYMENTS
  ├──< FOOD_ORDERS
  │        └──< FOOD_ORDER_ITEMS
  ├──< COMPLAINTS
  └──< EMERGENCY_REQUESTS
```

---

# 4. Tables

## 4.1 users

Stores registered application users.

| Column | Type | Constraints |
|---|---|---|
| id | BIGSERIAL | PK |
| name | VARCHAR(100) | NOT NULL |
| email | VARCHAR(150) | NOT NULL, UNIQUE |
| phone | VARCHAR(20) | UNIQUE |
| password_hash | TEXT | NOT NULL |
| role | VARCHAR(20) | NOT NULL, DEFAULT `USER` |
| created_at | TIMESTAMPTZ | NOT NULL |
| updated_at | TIMESTAMPTZ | NOT NULL |

Allowed roles:

```text
USER
ADMIN
```

Passwords must only be stored as secure hashes.

---

## 4.2 passenger_profiles

Stores passengers saved by a user for easier future booking.

| Column | Type | Constraints |
|---|---|---|
| id | BIGSERIAL | PK |
| user_id | BIGINT | FK → users.id, NOT NULL |
| name | VARCHAR(100) | NOT NULL |
| age | SMALLINT | NOT NULL |
| gender | VARCHAR(20) | NOT NULL |
| berth_preference | VARCHAR(20) | nullable |
| window_preference | BOOLEAN | DEFAULT FALSE |
| created_at | TIMESTAMPTZ | NOT NULL |
| updated_at | TIMESTAMPTZ | NOT NULL |

Example gender values:

```text
MALE
FEMALE
OTHER
```

Government identity documents are intentionally excluded from V1.

---

## 4.3 stations

Represents railway stations.

| Column | Type | Constraints |
|---|---|---|
| id | BIGSERIAL | PK |
| code | VARCHAR(10) | NOT NULL, UNIQUE |
| name | VARCHAR(150) | NOT NULL |
| city | VARCHAR(100) | NOT NULL |
| state | VARCHAR(100) | NOT NULL |

Example:

```text
NDLS
New Delhi
Delhi
Delhi
```

---

## 4.4 trains

Stores train-level information.

| Column | Type | Constraints |
|---|---|---|
| id | BIGSERIAL | PK |
| train_number | VARCHAR(20) | NOT NULL, UNIQUE |
| train_name | VARCHAR(150) | NOT NULL |
| train_type | VARCHAR(50) | nullable |
| active | BOOLEAN | NOT NULL, DEFAULT TRUE |
| created_at | TIMESTAMPTZ | NOT NULL |

---

## 4.5 train_stops

This represents the ordered route of each train.

This table replaces the earlier generic `routes` name because the actual entity is a train's ordered sequence of stops.

| Column | Type | Constraints |
|---|---|---|
| id | BIGSERIAL | PK |
| train_id | BIGINT | FK → trains.id, NOT NULL |
| station_id | BIGINT | FK → stations.id, NOT NULL |
| stop_order | INTEGER | NOT NULL |
| arrival_time | TIME | nullable |
| departure_time | TIME | nullable |
| distance_km | NUMERIC(8,2) | nullable |

Constraints:

```text
UNIQUE(train_id, stop_order)
UNIQUE(train_id, station_id)
```

`stop_order` is critical for determining whether two seat reservations overlap.

---

# 5. Coaches and Seats

## 5.1 coaches

Represents physical coaches belonging to a train.

| Column | Type | Constraints |
|---|---|---|
| id | BIGSERIAL | PK |
| train_id | BIGINT | FK → trains.id, NOT NULL |
| coach_number | VARCHAR(10) | NOT NULL |
| coach_type | VARCHAR(30) | NOT NULL |
| class_code | VARCHAR(10) | NOT NULL |
| seat_capacity | INTEGER | NOT NULL |

Examples:

```text
S1
S2
B1
A1
```

Possible class codes:

```text
SL
3A
2A
1A
CC
2S
```

These values are project configuration, not claims about every real-world railway rule.

Constraint:

```text
UNIQUE(train_id, coach_number)
```

---

## 5.2 seats

Represents a physical seat/berth inside a coach.

| Column | Type | Constraints |
|---|---|---|
| id | BIGSERIAL | PK |
| coach_id | BIGINT | FK → coaches.id, NOT NULL |
| seat_number | VARCHAR(10) | NOT NULL |
| berth_type | VARCHAR(20) | NOT NULL |
| position | VARCHAR(20) | nullable |
| is_window | BOOLEAN | DEFAULT FALSE |
| rac_capable | BOOLEAN | DEFAULT FALSE |

Example berth types:

```text
LOWER
MIDDLE
UPPER
SIDE_LOWER
SIDE_UPPER
```

Constraint:

```text
UNIQUE(coach_id, seat_number)
```

---

# 6. Bookings

## 6.1 bookings

Represents one booking/PNR.

| Column | Type | Constraints |
|---|---|---|
| id | BIGSERIAL | PK |
| pnr | VARCHAR(20) | nullable, UNIQUE |
| user_id | BIGINT | FK → users.id, NOT NULL |
| train_id | BIGINT | FK → trains.id, NOT NULL |
| journey_date | DATE | NOT NULL |
| source_station_id | BIGINT | FK → stations.id, NOT NULL |
| destination_station_id | BIGINT | FK → stations.id, NOT NULL |
| class_code | VARCHAR(10) | NOT NULL |
| status | VARCHAR(30) | NOT NULL |
| total_amount | NUMERIC(10,2) | NOT NULL |
| created_at | TIMESTAMPTZ | NOT NULL |
| updated_at | TIMESTAMPTZ | NOT NULL |

Possible booking statuses:

```text
PENDING_PAYMENT
CONFIRMED
PARTIALLY_CONFIRMED
RAC
WAITLIST
CANCELLED
```

`PENDING_PAYMENT` means seats have been temporarily held for the booking while mock payment is being completed. A PNR is generated only after successful payment/confirmation.

**`pnr` lifecycle:**

```text
Booking created  → pnr = NULL        (status: PENDING_PAYMENT)
Payment succeeds → pnr = 'SR...'     (status: CONFIRMED / RAC / PARTIALLY_CONFIRMED)
Payment fails    → pnr remains NULL  (status: PENDING_PAYMENT, retries permitted within 10m)
Hold expires     → pnr remains NULL  (status: CANCELLED, allocations RELEASED)
```

The `UNIQUE` constraint applies only to non-NULL values. PostgreSQL treats each `NULL` as distinct, so multiple cancelled/pending bookings can coexist without violating uniqueness. No two confirmed bookings can share the same PNR.

The `UNIQUE` constraint on `pnr` automatically creates a unique index in PostgreSQL. A separate explicit index on `bookings(pnr)` is therefore redundant and must not be created — see §18.

---

# 7. Booking Passengers

## 7.1 booking_passengers

Stores passengers belonging to a specific booking.

The passenger's important details are copied into snapshot columns so changing a saved passenger profile later does not alter historical ticket information.

| Column | Type | Constraints |
|---|---|---|
| id | BIGSERIAL | PK |
| booking_id | BIGINT | FK → bookings.id, NOT NULL |
| passenger_profile_id | BIGINT | FK → passenger_profiles.id, nullable |
| name_snapshot | VARCHAR(100) | NOT NULL |
| age_snapshot | SMALLINT | NOT NULL |
| gender_snapshot | VARCHAR(20) | NOT NULL |
| berth_preference | VARCHAR(20) | nullable |
| window_preference | BOOLEAN | DEFAULT FALSE |
| senior_citizen_flag | BOOLEAN | DEFAULT FALSE |
| passenger_status | VARCHAR(30) | NOT NULL |
| created_at | TIMESTAMPTZ | NOT NULL |

Passenger status examples:

```text
CONFIRMED
RAC
WAITLIST
CANCELLED
```

---

# 8. Seat Allocation

## 8.1 seat_allocations

This is one of the most important tables in SmartRail.

It represents the assignment of a physical seat to a passenger for a particular journey segment and date.

| Column | Type | Constraints |
|---|---|---|
| id | BIGSERIAL | PK |
| booking_passenger_id | BIGINT | FK → booking_passengers.id, NOT NULL |
| seat_id | BIGINT | FK → seats.id, NOT NULL |
| journey_date | DATE | NOT NULL |
| from_stop_order | INTEGER | NOT NULL |
| to_stop_order | INTEGER | NOT NULL |
| allocation_type | VARCHAR(20) | NOT NULL |
| rac_slot | SMALLINT | nullable |
| status | VARCHAR(20) | NOT NULL |
| allocated_at | TIMESTAMPTZ | NOT NULL |

Allocation types:

```text
CONFIRMED
RAC
```

Status:

```text
HELD
ACTIVE
CANCELLED
RELEASED
```

`HELD` is temporary reservation state during the payment window. `ACTIVE` means the allocation belongs to a confirmed booking.

Constraint:

```text
from_stop_order < to_stop_order
```

---

# 9. RAC Model

For the SmartRail simulation, a RAC-capable berth can support two RAC slots:

```text
Physical berth
 ├── RAC slot 1
 └── RAC slot 2
```

For normal confirmed allocation:

```text
rac_slot = NULL
```

For RAC:

```text
rac_slot = 1
rac_slot = 2
```

Two RAC passengers may use the same physical RAC-capable berth only when their RAC slots are different.

SmartRail's allocation preference can prioritize female-to-female RAC pairing when a compatible candidate exists.

This is a **SmartRail project rule**, not a statement that the implementation exactly matches official railway reservation rules.

---

# 10. Segment-Based Availability

Suppose a requested booking is:

```text
from_stop_order = 1
to_stop_order   = 4
```

An existing allocation is:

```text
existing_from = 2
existing_to   = 4
```

The reservations overlap.

The general overlap condition is:

```text
existing_from < requested_to
AND
existing_to > requested_from
```

Therefore:

```text
1 → 3
3 → 5
```

do not overlap.

But:

```text
1 → 4
2 → 5
```

do overlap.

This rule is central to seat availability.

---

# 11. Payment

## 11.1 payments

| Column | Type | Constraints |
|---|---|---|
| id | BIGSERIAL | PK |
| booking_id | BIGINT | FK → bookings.id, NOT NULL |
| amount | NUMERIC(10,2) | NOT NULL |
| status | VARCHAR(20) | NOT NULL |
| payment_method | VARCHAR(30) | NOT NULL |
| transaction_reference | VARCHAR(100) | UNIQUE |
| created_at | TIMESTAMPTZ | NOT NULL |

V1 uses mock payment.

---

# 12. Food Ordering

## 12.1 food_menu_items

Stores the items available for ordering.

| Column | Type | Constraints |
|---|---|---|
| id | BIGSERIAL | PK |
| station_id | BIGINT | FK → stations.id, NOT NULL |
| name | VARCHAR(150) | NOT NULL |
| description | TEXT | nullable |
| price | NUMERIC(10,2) | NOT NULL |
| active | BOOLEAN | NOT NULL, DEFAULT TRUE |
| created_at | TIMESTAMPTZ | NOT NULL |

## 12.2 food_orders

| Column | Type | Constraints |
|---|---|---|
| id | BIGSERIAL | PK |
| booking_id | BIGINT | FK → bookings.id, NOT NULL |
| station_id | BIGINT | FK → stations.id, NOT NULL |
| status | VARCHAR(30) | NOT NULL |
| total_amount | NUMERIC(10,2) | NOT NULL |
| created_at | TIMESTAMPTZ | NOT NULL |

## 12.3 food_order_items

| Column | Type | Constraints |
|---|---|---|
| id | BIGSERIAL | PK |
| food_order_id | BIGINT | FK → food_orders.id, NOT NULL |
| item_name | VARCHAR(150) | NOT NULL |
| quantity | INTEGER | NOT NULL |
| unit_price | NUMERIC(10,2) | NOT NULL |

---

# 13. Complaints

## 13.1 complaints

| Column | Type | Constraints |
|---|---|---|
| id | BIGSERIAL | PK |
| user_id | BIGINT | FK → users.id, NOT NULL |
| booking_id | BIGINT | FK → bookings.id, nullable |
| category | VARCHAR(50) | NOT NULL |
| description | TEXT | NOT NULL |
| image_path | TEXT | nullable |
| status | VARCHAR(30) | NOT NULL |
| created_at | TIMESTAMPTZ | NOT NULL |
| resolved_at | TIMESTAMPTZ | nullable |

V1 image storage uses local server storage.

---

# 14. Emergency Requests

## 14.1 emergency_requests

| Column | Type | Constraints |
|---|---|---|
| id | BIGSERIAL | PK |
| user_id | BIGINT | FK → users.id, NOT NULL |
| booking_id | BIGINT | FK → bookings.id, nullable |
| coach_id | BIGINT | FK → coaches.id, nullable |
| seat_id | BIGINT | FK → seats.id, nullable |
| request_type | VARCHAR(50) | NOT NULL |
| description | TEXT | nullable |
| status | VARCHAR(30) | NOT NULL |
| created_at | TIMESTAMPTZ | NOT NULL |
| resolved_at | TIMESTAMPTZ | nullable |

Example request types:

```text
MEDICAL
SECURITY
FIRE
OTHER
```

---

# 15. Notifications

## 15.1 notifications

| Column | Type | Constraints |
|---|---|---|
| id | BIGSERIAL | PK |
| user_id | BIGINT | FK → users.id, NOT NULL |
| title | VARCHAR(150) | NOT NULL |
| message | TEXT | NOT NULL |
| type | VARCHAR(30) | NOT NULL |
| is_read | BOOLEAN | NOT NULL, DEFAULT FALSE |
| created_at | TIMESTAMPTZ | NOT NULL |

---

# 16. Relationships

```text
users
  1 ─── N passenger_profiles

users
  1 ─── N bookings

users
  1 ─── N notifications

trains
  1 ─── N train_stops

stations
  1 ─── N train_stops

trains
  1 ─── N coaches

coaches
  1 ─── N seats

bookings
  1 ─── N booking_passengers

passenger_profiles
  1 ─── N booking_passengers

booking_passengers
  1 ─── N seat_allocations

seats
  1 ─── N seat_allocations

bookings
  1 ─── N payments

bookings
  1 ─── N food_orders

stations
  1 ─── N food_menu_items

food_orders
  1 ─── N food_order_items

food_menu_items
  1 ─── N food_order_items

bookings
  1 ─── N complaints

bookings
  1 ─── N emergency_requests
```

---

# 17. Important Constraints

## User
- Email must be unique.
- Password must never be stored in plain text.

## Train route
- A train cannot have duplicate stop order.
- A station should not appear twice in the same train route for V1.
- Source must occur before destination.

## Coach
- Coach number must be unique within a train.

## Seat
- Seat number must be unique within a coach.

## Booking
- PNR must be unique.
- Journey date is required.
- Source and destination cannot be the same.

## Seat Allocation
- `from_stop_order < to_stop_order`.
- A seat cannot have overlapping active confirmed allocations for the same date.
- RAC allocations require an RAC-capable seat.
- RAC slot must be 1 or 2 when allocation type is RAC.
- Confirmed allocation must not use an RAC slot.

---

# 18. Indexes

Create indexes for the most common searches:

```text
users(email)

stations(code)
stations(name)

trains(train_number)

train_stops(train_id, stop_order)
train_stops(train_id, station_id)

coaches(train_id, coach_number)

seats(coach_id, seat_number)

-- bookings(pnr) is covered by the UNIQUE constraint and must NOT be
-- created separately. A UNIQUE constraint in PostgreSQL automatically
-- creates a unique index; a duplicate explicit index wastes storage
-- and slows writes without any query benefit.
bookings(user_id, journey_date)
bookings(train_id, journey_date)

booking_passengers(booking_id)

seat_allocations(
    seat_id,
    journey_date
)

seat_allocations(
    journey_date,
    from_stop_order,
    to_stop_order
)

notifications(user_id, is_read)
```

Avoid creating indexes for every column. Add indexes based on real query patterns.

---

# 19. Booking Transaction

A booking must not be implemented as independent database writes.

Conceptually:

```text
BEGIN TRANSACTION
      ↓
Validate booking request
      ↓
Find train/stops
      ↓
Read available seats
      ↓
Lock relevant seat/allocation rows
      ↓
Run Smart Seat Allocation Engine
      ↓
Create PENDING_PAYMENT booking
      ↓
Create booking passengers
      ↓
Create HELD seat allocations
      ↓
Commit initial hold transaction
      ↓
Mock Payment API
      ↓
SUCCESS?
  /       \
 Yes       No (e.g. simulated failure)
  ↓         ↓
Activate    Insert FAILED audit record
booking     Keep status PENDING_PAYMENT
  ↓         Keep allocations HELD
Assign PNR  Permit retry within 10m window
  ↓
COMMIT / finalize
```

If the 10-minute hold deadline expires without successful payment:

```text
Hold Expiration (via eager cleanup or live clock check during payment)
      ↓
Release HELD allocations (status: RELEASED)
Cancel booking (status: CANCELLED)
COMMIT / finalize
```

If anything critical fails:

```text
ROLLBACK
```

The frontend's seat availability display is informational. The backend must perform the authoritative final availability check.

---

# 20. V1 Scope Control

Do not add tables for:

- ML prediction
- Live GPS
- Chatbot
- Loyalty points
- Social features
- Advanced analytics
- Real railway API integration

Those belong to future scope.

---

# 21. Final Database Set

SmartRail V1 has these 15 core tables:

```text
1.  users
2.  passenger_profiles
3.  stations
4.  trains
5.  train_stops
6.  coaches
7.  seats
8.  bookings
9.  booking_passengers
10. seat_allocations
11. payments
12. food_menu_items
13. food_orders
14. food_order_items
15. complaints
16. emergency_requests
17. notifications
```

That is **16 tables**, which is reasonable for this project because most are small service/support tables and the reservation model needs the additional entities.

---

# 22. Single Source of Truth

This `DATABASE.md` should replace the earlier draft.

Do not maintain a second competing schema document.

When changing the database later:

1. Update this document.
2. Update migrations.
3. Update API contracts if necessary.
4. Update `MEMORY.md` with the architectural decision.
