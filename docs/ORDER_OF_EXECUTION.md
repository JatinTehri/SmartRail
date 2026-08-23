# SmartRail — Order of Execution

This document is the practical sequence for building SmartRail without getting overwhelmed.

## Phase 0 — Architecture ✅

Completed before coding:

- README
- PRD
- ARCHITECTURE
- DATABASE
- API
- BUSINESS_RULES
- SEAT_ALLOCATION
- DESIGN
- AI_RULES
- MEMORY
- ER diagram
- Schema design

## Phase 1 — Project Setup

1. Create GitHub repository.
2. Create final project structure.
3. Initialize React frontend.
4. Initialize Node/Express backend.
5. Configure PostgreSQL.
6. Configure environment variables.
7. Add `.gitignore`.
8. Add base error handling and configuration.

## Phase 2 — Authentication

```text
Register
   ↓
Login
   ↓
JWT
   ↓
HTTP-only Cookie
   ↓
Protected Route
   ↓
Logout
```

Complete and test authentication before continuing.

## Phase 3 — Stations and Trains

```text
Station
   ↓
Source + Destination + Date
   ↓
Train Search API
   ↓
Available Trains
   ↓
Train Details
   ↓
Class Availability
```

Use `train_stops`, not a generic route table.

## Phase 4 — Passenger Profiles

- Create saved passenger
- Edit passenger
- Delete passenger
- Select saved passengers during booking

## Phase 5 — Basic Booking + Payment Hold

Do not build the full smart algorithm yet. First make the end-to-end booking lifecycle work.

```text
Train
 ↓
Class
 ↓
Passengers
 ↓
Basic seat allocation
 ↓
PENDING_PAYMENT booking
 ↓
HELD seat allocations
 ↓
Mock Payment
 ├── SUCCESS → CONFIRMED + ACTIVE + PNR
 └── FAILURE → release holds + CANCELLED
```

The final seat check and hold must be transaction-safe.

## Phase 6 — Smart Seat Allocation ⭐

Build progressively:

### Version 1
Group seating.

### Version 2
Berth preference.

### Version 3
Window preference.

### Version 4
Senior-citizen lower-berth preference.

### Version 5
Female travelling-alone preference.

### Version 6
RAC pairing preference.

### Version 7
Conflict resolution and fallback.

Start with scoring-based selection and keep the allocator independently testable.

## Phase 7 — Secondary Services

After the core booking flow and allocator are reliable:

- Food menu
- Food ordering
- Cleanliness complaints
- Local image upload
- Emergency requests
- In-app notifications

## Phase 8 — Admin

Keep the admin panel small:

- Dashboard
- Trains
- Stations
- Coaches/seats
- Bookings
- Complaints
- Emergency requests

## Phase 9 — Testing and Deployment

- API tests
- Authentication tests
- Booking lifecycle tests
- Seat allocation tests
- Concurrent booking tests
- Responsive UI
- Loading/error states
- Security review
- Deployment
- Portfolio screenshots

## 6-Week Target

| Week | Main Goal |
|---|---|
| 1 | Project setup + PostgreSQL + authentication |
| 2 | Stations + trains + train stops/search + availability |
| 3 | Passenger profiles + basic booking + payment hold + PNR |
| 4 | Smart Seat Allocation Engine |
| 5 | Food + complaints + emergency + notifications + admin |
| 6 | Testing + UI polish + responsive design + deployment |

## Rule

Do not add future-scope technology or features until the core booking lifecycle and Smart Seat Allocation Engine work reliably.
