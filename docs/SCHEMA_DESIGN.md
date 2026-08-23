# SmartRail — Database Schema Design

## 1. Core Design Decision

A railway seat is not necessarily occupied for the whole train route.

Example:

Delhi(1) -> Jaipur(2) -> Kota(3) -> Mumbai(4)

Seat 21:
- Passenger A: 1 -> 3
- Passenger B: 3 -> 4  = possible reuse
- Passenger C: 2 -> 4  = conflicts with A

Therefore seat availability must depend on:
- train
- journey date
- physical seat
- source stop
- destination stop

## 2. ER Structure

```text
USER
 ├──< PASSENGER_PROFILE
 ├──< BOOKING
 └──< NOTIFICATION

TRAIN
 ├──< TRAIN_STOP >── STATION
 └──< COACH
          └──< SEAT

BOOKING
 ├──< BOOKING_PASSENGER
 │        └──< SEAT_ALLOCATION >── SEAT
 ├──< PAYMENT
 ├──< FOOD_ORDER
 │        └──< FOOD_ORDER_ITEM
 ├──< COMPLAINT
 └──< EMERGENCY_REQUEST
```

## 3. Tables

### users
```text
id PK
name
email UNIQUE
phone
password_hash
role
created_at
updated_at
```

### passenger_profiles
```text
id PK
user_id FK -> users.id
name
age
gender
id_type nullable
id_last4 nullable
created_at
updated_at
```

Do not store full government ID numbers in this portfolio project.

### stations
```text
id PK
code UNIQUE
name
city
state
```

### trains
```text
id PK
train_number UNIQUE
train_name
train_type
active
```

### train_stops

Stores the ordered route of a train.

```text
id PK
train_id FK -> trains.id
station_id FK -> stations.id
stop_order
arrival_time
departure_time
distance_km
```

Recommended constraints:
```text
UNIQUE(train_id, stop_order)
UNIQUE(train_id, station_id)
```

`stop_order` is critical for segment-based seat availability.

### coaches
```text
id PK
train_id FK -> trains.id
coach_number
coach_type
class_code
seat_capacity
```

### seats
```text
id PK
coach_id FK -> coaches.id
seat_number
berth_type
position
is_window
rac_capable
```

Suggested berth types:
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

### bookings
```text
id PK
pnr UNIQUE nullable until payment success
user_id FK -> users.id
train_id FK -> trains.id
journey_date
source_station_id FK -> stations.id
destination_station_id FK -> stations.id
class_code
status
total_amount
created_at
updated_at
```

Suggested status:
```text
PENDING_PAYMENT
CONFIRMED
PARTIALLY_CONFIRMED
RAC
WAITLIST
CANCELLED
```

### booking_passengers

Stores a snapshot of passenger information at booking time.

```text
id PK
booking_id FK -> bookings.id
passenger_profile_id nullable FK -> passenger_profiles.id
name_snapshot
age_snapshot
gender_snapshot
berth_preference
window_preference
senior_citizen_flag
created_at
```

Snapshotting prevents later profile edits from changing historical tickets.

### seat_allocations

This is intentionally separate from `booking_passengers`.

```text
id PK
booking_passenger_id FK -> booking_passengers.id
seat_id FK -> seats.id
journey_date
from_stop_order
to_stop_order
allocation_type
rac_slot nullable
status
allocated_at
```

Allocation types:
```text
CONFIRMED
RAC
```

Statuses:
```text
ACTIVE
CANCELLED
RELEASED
```

For an active allocation, treat the journey as the half-open interval:

```text
[from_stop_order, to_stop_order)
```

## 4. RAC Model

For the SmartRail simulation, a RAC-capable berth may have:

```text
Physical berth
 ├── RAC slot 1
 └── RAC slot 2
```

`rac_slot` is:
- `1` or `2` for RAC
- `NULL` for normal confirmed allocation

The allocator should allow two overlapping RAC allocations only when:
- the seat is RAC-capable
- both allocations are RAC
- slot numbers differ

The SmartRail preference engine can then prioritize female-female RAC pairing when a suitable candidate exists.

## 5. Availability Rule

For requested segment:

```text
requested_from = source.stop_order
requested_to   = destination.stop_order
```

An existing allocation conflicts when:

```text
existing_from < requested_to
AND
existing_to > requested_from
```

So:

```text
1 -> 3 and 3 -> 4  = no overlap
1 -> 3 and 2 -> 4  = overlap
```

PostgreSQL range types and exclusion constraints are useful for enforcing non-overlapping ranges at the database level.

## 6. Booking Concurrency

Booking must be transaction-safe:

```text
BEGIN
  ↓
Read/check current availability
  ↓
Lock relevant rows where required
  ↓
Run seat allocation
  ↓
Insert seat allocations
  ↓
Insert booking/passengers
  ↓
COMMIT
```

Do not rely only on a frontend availability check.

## 7. Supporting Tables

### food_menu_items
```text
id PK
station_id FK -> stations.id
name
description nullable
price
active
created_at
```

### payments
```text
id PK
booking_id FK
amount
status
payment_method
transaction_reference UNIQUE
created_at
```

### food_orders
```text
id PK
booking_id FK
station_id FK
status
total_amount
created_at
```

### food_order_items
```text
id PK
food_order_id FK
item_name
quantity
unit_price
```

### complaints
```text
id PK
user_id FK
booking_id FK nullable
category
description
image_path nullable
status
created_at
resolved_at nullable
```

### emergency_requests
```text
id PK
user_id FK
booking_id FK nullable
coach_id FK nullable
seat_id FK nullable
request_type
description
status
created_at
resolved_at nullable
```

### notifications
```text
id PK
user_id FK
title
message
type
is_read
created_at
```

## 8. Relationship Summary

```text
users
  |
  +-- passenger_profiles
  |
  +-- bookings
       |
       +-- booking_passengers
       |      |
       |      +-- seat_allocations -- seats -- coaches -- trains
       |
       +-- payments
       +-- food_orders -- food_order_items
       +-- complaints
       +-- emergency_requests
  |
  +-- notifications

trains
  |
  +-- train_stops -- stations
  |
  +-- coaches -- seats
```

## 9. Do Not Add Yet

Do not create tables for ML predictions, live GPS, chat, loyalty points, complex analytics, or external railway integrations in V1.

## 10. Next Database Tasks

1. Review this schema.
2. Finalize column types and enums.
3. Finalize foreign keys and constraints.
4. Draw the ER diagram.
5. Write PostgreSQL migration scripts.
6. Add seed data for a few trains, stations, coaches, and seats.
7. Test segment-based availability.
8. Test concurrent booking behavior.


Booking state note: a booking starts as PENDING_PAYMENT while its allocated seats are HELD. PNR is assigned after successful payment.
