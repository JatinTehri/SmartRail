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

**Phase 1 complete. Ready for Phase 1b: PostgreSQL connection, schema creation, and seed data.**

---

## 9. Next Steps

1. ~~Create the final SmartRail project structure.~~ (Done — Phase 1)
2. ~~Initialize the Express backend.~~ (Done — Phase 1)
3. ~~Initialize the React frontend.~~ (Done — Phase 1)
4. ~~Configure environment variables.~~ (Done — Phase 1)
5. Set up PostgreSQL connection.
6. Create database migrations/schema.
7. Add development seed data.
8. Implement authentication.
9. Implement station and train search.
10. Implement availability.
11. Implement basic booking.
12. Implement the Smart Seat Allocation Engine.
13. Add food, complaints, emergency, notifications, and admin features.
14. Test, polish, and deploy.

---

## 10. Important Decisions Log

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
