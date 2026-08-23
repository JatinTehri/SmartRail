# Architecture — SmartRail

## 1. High-Level Architecture

```text
React Frontend
      |
      | REST / JSON
      | Axios
      v
Express.js API
      |
      +-- Auth
      +-- Train
      +-- Passenger
      +-- Booking
      +-- Food
      +-- Complaint
      +-- Emergency
      +-- Notification
      +-- Admin
      |
      +-- Smart Seat Allocation Engine
      |
      v
PostgreSQL
```

## 2. Frontend Responsibilities

React handles:

- Pages and navigation
- Forms
- Client-side validation
- Search/filter UI
- Booking flow
- Seat visualization
- Authentication state
- API communication
- User feedback and notifications

React must not contain authoritative booking or seat-allocation rules.

## 3. Backend Responsibilities

Express handles:

- Authentication
- Authorization
- Input validation
- Business logic
- Booking transactions
- Seat allocation
- Database access
- Error handling
- File handling
- Admin operations

## 4. Suggested Backend Structure

```text
backend/
├── src/
│   ├── config/
│   ├── controllers/
│   ├── routes/
│   ├── services/
│   ├── repositories/
│   ├── models/
│   ├── middleware/
│   ├── validators/
│   ├── utils/
│   ├── errors/
│   └── modules/
│       ├── auth/
│       ├── trains/
│       ├── passengers/
│       ├── bookings/
│       ├── seat-allocation/
│       ├── food/
│       ├── complaints/
│       ├── emergency/
│       ├── notifications/
│       └── admin/
└── tests/
```

## 5. Booking Data Flow

```text
Booking Form
    |
    v
POST /api/bookings
    |
    v
Booking Controller
    |
    v
Booking Service
    |
    +--> Validate passengers/preferences
    |
    +--> Start database transaction
    |
    +--> Read current seat availability
    |
    +--> Smart Seat Allocation Engine
    |
    +--> Create PENDING_PAYMENT booking
    |
    +--> Create booking/passenger records
    |
    +--> Create HELD seat allocations
    |
    +--> Commit temporary hold
    |
    +--> Mock Payment
    |
    +--> SUCCESS: activate allocations, confirm booking, generate PNR
    |
    +--> FAILURE: release holds and cancel booking
    |
    v
Booking Response
    |
    v
React Confirmation Page
```

## 6. Critical Design Rule

Seat allocation must happen inside the booking transaction or under a locking strategy that prevents two simultaneous bookings from receiving the same seat.

## 7. Authentication Flow

```text
Login
  |
  v
Express verifies credentials
  |
  v
JWT created
  |
  v
HTTP-only secure cookie
  |
  v
Protected API request
  |
  v
Auth middleware verifies JWT
  |
  v
Controller
```

## 8. Architecture Principle

Keep the application as a modular monolith. Do not introduce microservices for this portfolio project.
