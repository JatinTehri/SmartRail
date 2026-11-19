# SmartRail Project Memory

This file stores important project decisions, completed milestones, current work, and next steps so future AI sessions can continue the project consistently.

---

## 1. Project

**Name:** SmartRail

**Type:** Personal portfolio full-stack project.

**Goal:** Build an IRCTC-inspired railway reservation platform with an intelligent, passenger-centric seat allocation engine.

**Main differentiator:** Smart Seat Allocation Engine.

It should optimize:

- Group seating
- Berth preference
- Window preference
- Female passenger safety preference
- RAC pairing preference
- Senior-citizen lower-berth preference
- Reasonable fallback when constraints conflict

The project should remain achievable within approximately 1–1.5 months.

---

## 2. Technology Decisions

### Frontend

- React
- JavaScript
- React Router
- Tailwind CSS
- Axios

### Backend

- Node.js
- Express.js
- REST API

### Database

- PostgreSQL

### Authentication

- JWT
- HTTP-only cookies

The JWT must not be stored in localStorage.

### Payment

- Mock payment for V1
- Razorpay sandbox is optional future scope

### File Storage

- Local server storage for V1

### Notifications

- In-app notifications

### Testing

- Jest
- Supertest

### Tools

- Git
- GitHub
- Postman

---

## 3. Architecture Decisions

- Use a modular monolith.
- Do not use microservices.
- React handles presentation and user interaction.
- The backend contains authoritative business rules.
- Database access remains separate from controllers.
- Controllers should remain thin.
- Business logic belongs in services.
- Seat allocation remains independent from HTTP/controller code.
- Booking and seat reservation must be transaction-safe.
- Do not trust frontend availability checks as the final source of truth.
- Avoid unnecessary Redis, Kafka, Kubernetes, AWS, ML, or similar infrastructure for V1.

### Final Core Flow

```text
React
  ↓
Axios / REST API
  ↓
Express Route
  ↓
Controller
  ↓
Service
  ↓
PostgreSQL / Seat Allocation Engine
  ↓
Service
  ↓
JSON Response
  ↓
React
```

---

## 4. Current Database Model

The database design is finalized for V1, including temporary seat holds during payment and a station-based food menu.

### Core entities

- users
- passenger_profiles
- stations
- trains
- train_stops
- coaches
- seats
- bookings
- booking_passengers
- seat_allocations
- payments
- food_menu_items
- food_orders
- food_order_items
- complaints
- emergency_requests
- notifications

### Important database decision

Use:

```text
train_stops
```

instead of the earlier generic `routes` naming.

Use:

```text
seat_allocations
```

instead of directly storing the final seat assignment only inside `booking_passengers`.

### Reason

Seat occupancy depends on:

- train
- journey date
- physical seat
- source stop
- destination stop

Example:

```text
Delhi → Jaipur → Kota → Mumbai

Seat 21
Passenger A: Delhi → Kota
Passenger B: Kota → Mumbai
```

These can be non-overlapping allocations.

### Segment overlap rule

Two allocations overlap when:

```text
existing_from < requested_to
AND
existing_to > requested_from
```

---

## 5. Current API Design

The REST API contract has been drafted and is the current source of truth for frontend/backend communication.

### Main modules

- Authentication
- Stations
- Trains
- Availability
- Passenger Profiles
- Booking
- Mock Payment
- Food
- Complaints
- Emergency
- Notifications
- Admin

### Core booking endpoint

```text
POST /api/bookings
```

The booking flow is:

```text
Booking Request
    ↓
Validate request
    ↓
Start transaction
    ↓
Check current availability
    ↓
Run Smart Seat Allocation Engine
    ↓
Create PENDING_PAYMENT booking
    ↓
Create HELD seat allocations
    ↓
Commit temporary hold
    ↓
Mock Payment
    ↓
SUCCESS → ACTIVE + CONFIRMED + PNR
FAILURE → release holds + CANCELLED
```

---

## 6. Current Scope

### Must Have

- Registration/login/logout
- Train search
- Station search
- Train details
- Seat availability
- Passenger management
- Booking
- Smart seat allocation
- PNR generation
- Mock payment
- Booking history
- Cancellation
- Food ordering
- Cleanliness complaints
- Emergency assistance
- In-app notifications
- Basic admin functionality

### Future Scope

- Real payment gateway
- Real railway APIs
- Live train GPS
- ML waitlist prediction
- Advanced seat recommendations
- Google login
- SMS/email notifications
- Advanced analytics

Do not implement future-scope features before V1 is stable.

---

## 7. Completed Milestones

The following architecture/documentation work has been completed:

- Project scope finalized for a personal portfolio.
- Technology stack selected.
- High-level architecture created.
- Product requirements created.
- Database schema designed.
- ER model created.
- REST API contract created.
- Business rules documented.
- Smart Seat Allocation Engine design documented.
- UI/UX design guidelines created.
- Final consistency review completed.
- Payment/hold flow clarified.
- Food menu model added.
- Admin V1 scope clarified.
- Development roadmap created.
- AI development rules created.
- Phase 1: Project scaffolding completed (Express backend, React/Vite frontend, Tailwind CSS, environment config, health endpoint, smoke tests).
- Phase 1B: Database Migrations completed (all 17 application tables created across Migrations 001–005 with indexes, FKs, and check constraints; `schema_migrations` tracking active).
- Phase 1B: Development Seed Data completed and verified (5 stations, 2 trains, 9 stops, 4 coaches, 276 seats, 11 food menu items; atomic transaction with advisory lock, strict `NODE_ENV === 'development'` guard, idempotent upserts).
- Phase 2: Authentication completed and verified (User Registration, Login, Logout, Auth Middleware, and Current User Profile API with JWT in HttpOnly cookies, bcrypt hashing with 10 salt rounds, constant-time verification, anti-enumeration protection, and 29/29 tests passing).
- Phase 3 — Stage 3.1 & 3.2: Station Search & Train Search APIs completed and verified (station search with ranked matching and wildcard escaping; train search with parameterized self-join on train_stops, forward stop_order enforcement, distance/duration calculation, coach class aggregation, optional class filtering, Asia/Kolkata timezone boundary handling, and comprehensive input validation; 25/25 train search tests passing, 66/66 total backend suite tests passing).
- Phase 3 — Stage 3.3: Train Details & Route API completed and verified (GET /api/trains/:trainId returning train metadata, stops ordered by stop_order ASC with station metadata, arrival/departure times, distanceKm, and coaches with capacities and class codes; decoupled queries via Promise.all avoiding Cartesian product; 18/18 train details tests passing, 84/84 total backend suite tests passing).
- Phase 3 — Stage 3.4: Seat Availability API completed and verified (GET /api/trains/:trainId/availability with segment overlap filtering, coach/seat aggregation, RAC slots calculation, mutual exclusivity between confirmed berths and RAC quotas; 24/24 availability tests passing, 108/108 total backend suite tests passing).
- Phase 3 — Stage 3.5: Train Search UI completed and verified (Navbar.jsx, StationSelect.jsx with 300ms debouncing, TrainSearch.jsx with Asia/Kolkata date handling, TrainCard.jsx with responsive tags and View Availability link; 0 lint errors, clean Vite build).
- Phase 3 — Stage 3.6: Coach & Seat Availability UI completed and verified (SeatAvailability.jsx with journey context, overall Confirmed and RAC quota summary cards, interactive coach selector tabs; SeatLayout.jsx with MAIN/SIDE berth partitioning, corridor walkway divider, emerald green confirmed availability, amber RAC slot status tracking, window indicators, and status legend; 0 lint errors, clean Vite build).
- Phase 4 — Stage 4.1: Passenger Profile APIs completed and verified (GET /api/passengers, POST /api/passengers, DELETE /api/passengers/:id with JWT authentication, multi-tenant row isolation, DTO formatting, transactional reference unlinking preserving booking snapshots, and 20/20 integration tests passing; 128/128 total backend tests passing).
- Phase 4 — Stage 4.2: Booking Creation API & Temporary Seat Holds completed and verified (POST /api/bookings with input validation, saved profile authoritative resolution, SmartRail Demo Fare Model across 7 classes, 10-minute hold expiration cleanup, row-level locking via SELECT ... FOR UPDATE OF s, segregated Confirmed/RAC pools, provisional response status transparency, and real PostgreSQL concurrency testing resolving to one 201 and one 409; 40 new tests passing, 168/168 total backend suite tests passing).

### Documentation currently available

```text
README.md
PRD.md
ARCHITECTURE.md
DATABASE.md
API.md
BUSINESS_RULES.md
SEAT_ALLOCATION.md
TASKS.md
AI_RULES.md
DESIGN.md
MEMORY.md
ORDER_OF_EXECUTION.md
ER_DIAGRAM.md
SCHEMA_DESIGN.md
```

---

## 8. Currently Working On

**Phase 4 — Stage 4.3 (Mock Payment Processing & Booking Confirmation) completed and verified across all 5 implementation & audit steps. Ready to plan Phase 4.4 / Phase 5.**

---

## 9. Next Steps

1. ~~Create the final SmartRail project structure.~~ (Done — Phase 1)
2. ~~Initialize the Express backend.~~ (Done — Phase 1)
3. ~~Initialize the React frontend.~~ (Done — Phase 1)
4. ~~Configure environment variables.~~ (Done — Phase 1)
5. ~~Set up PostgreSQL connection.~~ (Done — Phase 1B)
6. ~~Create database migrations/schema (17 tables).~~ (Done — Phase 1B)
7. ~~Add development seed data.~~ (Done — Phase 1B)
8. ~~Implement authentication.~~ (Done — Phase 2)
9. ~~Implement station and train search.~~ (Done — Phase 3 Stages 3.1 & 3.2)
10. ~~Implement train details and route lookup.~~ (Done — Phase 3 Stage 3.3)
11. ~~Implement seat availability API.~~ (Done — Phase 3 Stage 3.4)
12. ~~Implement passenger profiles, provisional booking creation, and temporary seat holds.~~ (Done — Phase 4 Stages 4.1 & 4.2)
13. ~~Implement mock payment processing, retryable failures, atomic PNR issuance, and booking confirmation.~~ (Done — Phase 4 Stage 4.3)
14. Implement booking history and cancellation APIs.
15. Implement the Smart Seat Allocation Engine (preference scoring, group seating, safety, RAC pairing).
16. Add food, complaints, emergency, notifications, and admin features.
17. Test, polish, and deploy.

---

## 10. Important Decisions Log

### Phase 4.3 Architectural Decisions (Payment & Confirmation)

- **Retryable Failed Payment Policy**: When payment simulation fails (`simulateFailure: true`), a `FAILED` payment audit row is inserted into `payments`, but the booking stays `PENDING_PAYMENT` and allocations stay `HELD` within the original 10-minute hold window. The hold deadline is not extended. If the window passes without a successful payment, normal hold cleanup releases the held seats and marks the booking `CANCELLED`.
- **Hierarchical Row Locking**: Ascending lock hierarchy: `seat_allocations` (`sa.id ASC FOR UPDATE`) $\to$ `booking_passengers` (`bp.id ASC FOR UPDATE`) $\to$ `bookings` (`b.id ASC FOR UPDATE`). Matches eager hold-expiration cleanup ordering, eliminating circular lock wait conditions and preventing PostgreSQL deadlocks (40P01).
- **Live Database Clock Expiration Check**: Evaluates `(b.created_at + INTERVAL '10 minutes' < clock_timestamp())` after locks are acquired. This guarantees that if a payment transaction waits behind locks past the 10-minute boundary, it detects expiration via true wall-clock time rather than transaction start time `NOW()`, releases holds, and returns HTTP 410 `BOOKING_HOLD_EXPIRED`.
- **Atomic PNR Generation & SAVEPOINT Collision Retries**: Generates 10-character unique uppercase alphanumeric PNRs (`SR` prefix + 8 random chars from `[0-9A-Z]`). Uses a PostgreSQL SAVEPOINT retry loop (up to 5 attempts) catching only `23505 bookings_pnr_key` collisions without rolling back the outer transaction.
- **Idempotency & Corruption Detection**: Replaying payment for an already-confirmed booking safely detects existing confirmation, commits no additional payment rows, and returns HTTP 200 with `isIdempotent: true`. Throws HTTP 500 if a confirmed booking lacks a payment record or a pending booking already has one.
- **Full Concurrency & Race Verification**: Verified via permanent automated tests in `payment.concurrency.test.js`:
  1. Two concurrent payments for the same booking serialize cleanly via row locks: both return HTTP 200 (one original, one idempotent), exactly one `SUCCESS` payment record, exactly one PNR.
  2. Race between payment and hold expiration cleanup resolves consistently without deadlocks: payment confirms and locks out expiry, or expiry cancels and rejects payment with clean status.
  3. Waiting on row locks until after the deadline safely detects expiration via `clock_timestamp()` and cancels the hold.
- **Test Suite Counts**: 6 payment suites (98 tests passing) and 19 backend regression suites (270 tests passing 100%). Seed counts unchanged.

### Keep the stack simple

**Reason:** This is a personal portfolio project with a target completion time of approximately 1–1.5 months.

### PostgreSQL instead of MongoDB

**Reason:** Railway reservation has strong relationships and requires transactional consistency.

### Smart allocation over excessive features

**Reason:** The seat allocation engine is the project's primary technical differentiator.

### Mock payment for V1

**Reason:** Payment integration is not central to the project's learning and portfolio value.

### Modular monolith

**Reason:** It provides clean separation without the complexity of microservices.

### Train stops instead of generic routes

**Reason:** Seat availability must understand the ordered stations of a train.

### Seat allocations instead of direct booking-to-seat assignment

**Reason:** A physical seat can be allocated to different passengers on non-overlapping journey segments.

### Passenger snapshots

**Reason:** Historical bookings must not change if the user later edits a saved passenger profile.

### Thin controllers

**Reason:** Keeping business logic in services makes the backend easier to test and maintain.

### Independent seat allocation module

**Reason:** The core algorithm should be testable without Express and should not be tightly coupled to HTTP requests.

### Transaction-safe booking

**Reason:** Two simultaneous users must never be allowed to receive the same seat.

---

### Payment hold model
**Reason:** Seats must not become permanently confirmed before mock payment succeeds.

### Food menu table
**Reason:** Food ordering needs a controlled source of menu items and prices.

### Admin V1 scope
**Reason:** Keep the portfolio admin practical: trains, stations, coaches/seats, bookings, complaints, and emergencies.

### Stateless JWT Logout Behavior
**Reason:** Logout clears the `smartrail_token` cookie from the client's browser, preventing normal clients from accessing protected routes. In this stateless design, an already-issued JWT intercepted or copied elsewhere remains cryptographically valid until its `exp` time arrives. Server-side token blacklists (e.g. via Redis) or refresh tokens are intentionally excluded from V1 to keep the portfolio architecture practical and maintainable.

### Asia/Kolkata Business Date Validation
**Reason:** Indian Railways journeys operate strictly under Indian Standard Time (IST). Calculating "today" using UTC ISO date strings causes off-by-one calendar errors between 00:00 and 05:30 IST. Using `Intl.DateTimeFormat` with `timeZone: 'Asia/Kolkata'` ensures business dates align with Indian railway operations without introducing third-party date libraries.

### Seat Availability Segment Overlap & Mutual Exclusivity (Stage 3.4)
**Reason:** SmartRail seats can be reused on non-overlapping journey segments. Overlaps are detected mathematically with `existing_from < requested_to AND existing_to > requested_from`. Mutual exclusivity guarantees that:
1. A physical berth with even one RAC slot occupied cannot be sold as a confirmed berth.
2. An RAC-capable berth booked as confirmed offers 0 RAC slots.
3. HELD and ACTIVE allocations are treated as occupied, while CANCELLED and RELEASED do not block seats.
4. Confirmed and RAC capacities are presented independently and never summed as total physical seats.

---

## 11. Problems and Solutions

Record important problems using:

```text
Problem:
Solution:
Why:
Date:
```

Example:

```text
Problem:
Two users could potentially book the same seat simultaneously.

Solution:
Perform the final availability check and seat allocation within a database transaction with appropriate row locking.

Why:
Frontend availability is not authoritative during concurrent booking.

Date:
YYYY-MM-DD
```

```text
Problem:
Running seed scripts with automatic NODE_ENV fallback to development can accidentally execute against staging or production databases if invoked carelessly.

Solution:
Load backend/.env before checking NODE_ENV, enforce strict equality (process.env.NODE_ENV !== 'development'), refuse fallback defaults, and abort execution with exit code 1 if NODE_ENV is unset or not 'development'.

Why:
Seed data must never be allowed to run against non-development environments or wipe/override production data.

Date:
2026-11-03
```

```text
Problem:
Initial 2A coach berth calculation proposed 20 Lower, 20 Upper, 6 Side Lower, 6 Side Upper, which mathematically contradicted the coach configuration of 8 full bays (6 berths each) + 1 partial bay (4 berths: 2 Lower, 2 Upper, 0 Side berths).

Solution:
Corrected mathematical distribution to: 18 Lower (16 full + 2 partial), 18 Upper (16 full + 2 partial), 8 Side Lower, 8 Side Upper = 52 total. Window berths = 17 (8 Side Lower: 5, 11, 17, 23, 29, 35, 41, 47; 9 Main Lower: 1, 7, 13, 19, 25, 31, 37, 43, 49). RAC-capable = 1 (Seat 5).

Why:
Every physical berth and seat number in the database must strictly align with coach geometry and database constraints.

Date:
2026-11-03
```

```text
Problem:
Concurrent seed script executions could cause race conditions or duplicate insertions before unique constraint checks.

Solution:
Acquire a PostgreSQL transaction-level advisory lock at the start of the seed transaction using SELECT pg_advisory_xact_lock(hashtext('smartrail_seed_lock')::bigint);.

Why:
Advisory locks automatically release on commit or rollback and prevent concurrent execution of the seed runner.

Date:
2026-11-03
```

```text
Problem:
PostgreSQL error 42703 (undefined column) occurred when attempting to query distance from `train_stops` using `distance_from_source`.

Solution:
Inspected Migration 002 (`002_train_structure.sql`) and `docs/DATABASE.md` to confirm the authoritative schema uses `distance_km NUMERIC(8,2)` with composite unique constraints `(train_id, stop_order)` and `(train_id, station_id)`. Updated the query and repository to use `distance_km`.

Why:
Migration DDL is the absolute source of truth for database columns, types, and constraints.

Date:
2026-11-03
```

```text
Problem:
Comparing journey dates against UTC ISO dates caused timezone boundary discrepancies: in the early morning hours in India (e.g. 01:30 IST), UTC is still on the previous day's calendar date, allowing yesterday's Indian railway date to be accepted.

Solution:
Implemented `getTodayIST(referenceDate)` using `Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata' })` with `formatToParts()` to deterministically determine today's date in `YYYY-MM-DD` according to Indian Standard Time.

Why:
SmartRail serves Indian railway routes and must enforce calendar date validation according to Indian business time.

Date:
2026-11-03
```

---

## 12. Outdated Information

When a project decision changes:

1. Update this file.
2. Update the affected documentation.
3. Update the implementation/migrations if already created.
4. Remove contradictory old information.

Do not keep competing versions of architecture decisions.

---

## 13. AI Continuation Rules

When starting a new AI session:

1. Read `MEMORY.md
ORDER_OF_EXECUTION.md
ER_DIAGRAM.md
SCHEMA_DESIGN.md` first.
2. Read the documentation relevant to the requested task.
3. Do not re-design an already finalized decision without a clear reason.
4. Do not introduce new technology unless explicitly approved or genuinely necessary.
5. Before changing the database, check `DATABASE.md`.
6. Before changing an API, check `API.md`.
7. Before changing allocation behavior, check `BUSINESS_RULES.md` and `SEAT_ALLOCATION.md`.
8. Update `MEMORY.md
ORDER_OF_EXECUTION.md
ER_DIAGRAM.md
SCHEMA_DESIGN.md` after major architectural decisions or milestones.

---

## 14. Purpose

This file is the project's persistent context.

It should let an AI assistant quickly understand:

- What SmartRail is
- Why it exists
- What technology it uses
- What architecture has been finalized
- What database model has been finalized
- What APIs have been planned
- What has already been completed
- What is currently being built
- What must happen next
- Which decisions must remain consistent
