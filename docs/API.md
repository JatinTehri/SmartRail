# SmartRail — REST API Contract

This document is the API contract for SmartRail V1.

The backend uses:

```text
Node.js
Express.js
PostgreSQL
REST
JSON
JWT + HTTP-only cookies
```

The API is divided into modules. Controllers should remain thin and delegate business logic to services.

---

# 1. Base URL

Development:

```text
http://localhost:5000/api
```

Production:

```text
https://<backend-domain>/api
```

All request/response bodies use JSON unless explicitly stated otherwise.

---

# 2. Authentication

Authentication uses JWT stored in an HTTP-only cookie.

The frontend should not store the JWT in localStorage.

## POST /auth/register

Create a new user.

### Request

```json
{
  "name": "Jatin",
  "email": "jatin@example.com",
  "phone": "9876543210",
  "password": "StrongPassword123"
}
```

### Response — 201

```json
{
  "message": "Registration successful",
  "user": {
    "id": 1,
    "name": "Jatin",
    "email": "jatin@example.com",
    "role": "USER"
  }
}
```

### Possible errors

- 400 Invalid input
- 409 Email already registered

---

## POST /auth/login

Authenticate a user.

### Request

```json
{
  "email": "jatin@example.com",
  "password": "StrongPassword123"
}
```

### Response — 200

The server sets the HTTP-only authentication cookie.

```json
{
  "message": "Login successful",
  "user": {
    "id": 1,
    "name": "Jatin",
    "email": "jatin@example.com",
    "role": "USER"
  }
}
```

### Errors

- 400 Invalid input
- 401 Invalid credentials

---

## POST /auth/logout

Clear the authentication cookie.

### Response — 200

```json
{
  "message": "Logged out successfully"
}
```

---

## GET /auth/me

Return the currently authenticated user.

### Authentication

Required.

### Response

```json
{
  "user": {
    "id": 1,
    "name": "Jatin",
    "email": "jatin@example.com",
    "role": "USER"
  }
}
```

---

# 3. Station APIs

## GET /stations/search?q=del

Search stations by name, city, or station code.

### Response

```json
{
  "stations": [
    {
      "id": 1,
      "code": "NDLS",
      "name": "New Delhi",
      "city": "Delhi",
      "state": "Delhi"
    }
  ]
}
```

---

# 4. Train Search APIs

## GET /trains/search

Search trains for a journey.

### Query Parameters

```text
fromStationId
toStationId
journeyDate
classCode
```

Example:

```text
GET /trains/search?fromStationId=1&toStationId=8&journeyDate=2026-09-15&classCode=3A
```

### Response

```json
{
  "trains": [
    {
      "id": 10,
      "trainNumber": "12951",
      "trainName": "Example Express",
      "departure": "16:55",
      "arrival": "08:35",
      "duration": "15h 40m",
      "classCode": "3A",
      "availability": {
        "confirmed": 42,
        "rac": 6,
        "waitlist": 0
      }
    }
  ]
}
```

The exact availability numbers are generated from the reservation database.

---

## GET /trains/:trainId

Return train information, ordered route details, and coach configurations.

### Response

```json
{
  "train": {
    "id": 10,
    "trainNumber": "12951",
    "trainName": "Example Express",
    "trainType": "Express"
  },
  "stops": [
    {
      "stationId": 1,
      "stationCode": "NDLS",
      "stationName": "New Delhi",
      "stationCity": "New Delhi",
      "stopOrder": 1,
      "arrivalTime": null,
      "departureTime": "16:55",
      "distanceKm": 0
    }
  ],
  "coaches": [
    {
      "id": 1,
      "coachNumber": "A1",
      "coachType": "AC_2_TIER",
      "classCode": "2A",
      "seatCapacity": 52
    }
  ]
}
```

---

## GET /trains/:trainId/availability

Return seat and RAC availability for a journey segment, including coach layouts and individual seat status.

### Query Parameters

```text
fromStationId (required, positive integer)
toStationId   (required, positive integer)
journeyDate   (required, YYYY-MM-DD, today or future in Asia/Kolkata)
classCode     (optional, e.g. 2A, 3A, SL)
```

Example:

```text
GET /api/trains/1/availability?fromStationId=1&toStationId=2&journeyDate=2026-11-20&classCode=2A
```

### Response

```json
{
  "trainId": 1,
  "trainNumber": "DEMO-EXP-01",
  "trainName": "SmartRail Express",
  "journeyDate": "2026-11-20",
  "fromStation": {
    "id": 1,
    "code": "NDLS",
    "name": "New Delhi",
    "stopOrder": 1
  },
  "toStation": {
    "id": 2,
    "code": "CNB",
    "name": "Kanpur Central",
    "stopOrder": 2
  },
  "availability": {
    "confirmed": 52,
    "rac": 2
  },
  "classes": {
    "2A": {
      "confirmed": 52,
      "rac": 2
    }
  },
  "coaches": [
    {
      "coachId": 1,
      "coachNumber": "A1",
      "coachType": "AC_2_TIER",
      "classCode": "2A",
      "seatCapacity": 52,
      "availableConfirmed": 52,
      "availableRac": 2,
      "seats": [
        {
          "seatId": 1,
          "seatNumber": "1",
          "berthType": "LOWER",
          "position": "CABIN",
          "isWindow": true,
          "racCapable": false,
          "isAvailable": true
        },
        {
          "seatId": 7,
          "seatNumber": "7",
          "berthType": "SIDE_LOWER",
          "position": "SIDE",
          "isWindow": true,
          "racCapable": true,
          "isAvailable": true,
          "racSlotsAvailable": [1, 2]
        }
      ]
    }
  ]
}
```

---

# 5. Passenger Profile APIs

## GET /passengers

Return saved passenger profiles for the authenticated user.

### Response

```json
{
  "passengers": [
    {
      "id": 4,
      "name": "Rahul",
      "age": 24,
      "gender": "MALE",
      "berthPreference": "LOWER",
      "windowPreference": false
    }
  ]
}
```

---

## POST /passengers

Create a saved passenger profile.

### Request

```json
{
  "name": "Rahul",
  "age": 24,
  "gender": "MALE",
  "berthPreference": "LOWER",
  "windowPreference": false
}
```

### Response — 201

Returns the created passenger profile.

---

## PUT /passengers/:id

Update a saved passenger profile.

---

## DELETE /passengers/:id

Delete a saved passenger profile.

---

# 6. Booking APIs

This is the most important API group.

## POST /bookings

Create a booking and temporarily hold the selected seat allocation while payment is completed.

### Authentication

Required.

### Request

Supports both manual walk-in passengers and saved directory profiles (via `passengerProfileId`).

```json
{
  "trainId": 1,
  "journeyDate": "2026-12-20",
  "sourceStationId": 1,
  "destinationStationId": 2,
  "classCode": "3A",
  "passengers": [
    {
      "name": "Rahul",
      "age": 24,
      "gender": "MALE",
      "berthPreference": "LOWER",
      "windowPreference": false
    },
    {
      "passengerProfileId": 4,
      "berthPreference": "NONE",
      "windowPreference": true
    }
  ]
}
```

#### Passenger Fields Specification:
- **Manual Passenger**: `name` (1–100 chars), `age` (1–120), and `gender` (`MALE`, `FEMALE`, `OTHER`) are **mandatory**. `berthPreference` defaults to `null`, `windowPreference` defaults to `false`.
- **Saved Passenger (`passengerProfileId`)**: Identity fields (`name`, `age`, `gender`) are populated authoritatively from the user's saved profile in the database. Omitted preferences fall back to saved profile preferences. Explicit preferences in the payload (e.g. `berthPreference: "NONE"` or `windowPreference: false`) override saved profile preferences for this specific trip.

### Pricing Model (SmartRail Demo)
Fare calculation uses the **SmartRail Demo Fare Model** (for educational testing; not official Indian Railways fares):
- `perPassengerFare = Math.max(minFare, Math.round(distanceKm * ratePerKm))`
- `totalAmount = perPassengerFare * passengerCount`
- Supported classes: `1A` (₹2.50/km, min ₹750), `EC` (₹2.00/km, min ₹600), `2A` (₹1.60/km, min ₹500), `3A` (₹1.15/km, min ₹350), `CC` (₹0.90/km, min ₹250), `SL` (₹0.45/km, min ₹150), `2S` (₹0.25/km, min ₹60).

### Internal flow

```text
Request
  ↓
Validate authentication (401 if missing/invalid)
  ↓
Validate input payload (400 if invalid)
  ↓
Validate train existence and route direction (400 if reverse/invalid)
  ↓
Validate travel class availability on train (400 if class not operated)
  ↓
Resolve passenger identities & preferences (404 if profile unowned)
  ↓
Calculate distance-based demo fare
  ↓
Start DB transaction (pool.connect)
  ↓
Release expired holds older than 10 minutes
  ↓
Pessimistic row-level lock on candidate seats (ORDER BY s.id ASC FOR UPDATE)
  ↓
Detect overlapping active and held allocations for segment
  ↓
Segregate pools: Confirmed (non-RAC berths) vs RAC (RAC-capable berths)
  ↓
Sufficient capacity?
  ├─ No  → ROLLBACK → 409 SEATS_UNAVAILABLE
  └─ Yes → Greedily allocate Confirmed then RAC slots
             ↓
           Create PENDING_PAYMENT booking
             ↓
           Create booking_passengers snapshots
             ↓
           Create HELD seat allocations
             ↓
           COMMIT
```

### Response — 201

The response represents a **provisional 10-minute hold**. No PNR is issued yet (`pnr: null`).

```json
{
  "message": "Booking created and seats temporarily held",
  "booking": {
    "bookingId": 101,
    "pnr": null,
    "status": "PENDING_PAYMENT",
    "trainNumber": "DEMO-EXP-01",
    "journeyDate": "2026-12-20",
    "source": "New Delhi",
    "destination": "Kanpur Central",
    "classCode": "3A",
    "passengers": [
      {
        "name": "Rahul",
        "allocationType": "CONFIRMED",
        "allocationStatus": "HELD",
        "coach": "B1",
        "seatNumber": "1",
        "berthType": "LOWER",
        "racSlot": null
      },
      {
        "name": "Priya",
        "allocationType": "RAC",
        "allocationStatus": "HELD",
        "coach": "B1",
        "seatNumber": "7",
        "berthType": "SIDE_LOWER",
        "racSlot": 1
      }
    ],
    "totalAmount": 1012,
    "paymentRequired": true
  }
}
```

### Provisional Status Definitions:
- **`booking.status = "PENDING_PAYMENT"`**: Booking is unconfirmed and provisional. It will expire after 10 minutes unless payment succeeds.
- **`booking.pnr = null`**: A valid travel PNR is issued only after successful payment confirmation.
- **`passengers[].allocationStatus = "HELD"`**: Temporary row-locked hold reservation preventing other passengers from booking this berth/slot.
- **`passengers[].allocationType = "CONFIRMED" | "RAC"`**: Entitlement tier secured by the hold upon eventual payment.

### Error Responses

- **400 Bad Request**:
  - `VALIDATION_ERROR`: Malformed input, impossible dates, identical source/dest stations, reverse-direction travel, or class not carried by the train.
- **401 Unauthorized**:
  - `UNAUTHORIZED`: Missing, invalid, or expired `smartrail_token` cookie.
- **404 Not Found**:
  - `PASSENGER_NOT_FOUND`: Specified `passengerProfileId` does not exist or does not belong to the authenticated user.
  - `NOT_FOUND`: Train does not exist or is inactive.
- **409 Conflict**:
  - `SEATS_UNAVAILABLE`: Remaining capacity (confirmed + RAC) is insufficient for the requested passenger count. Zero records are created.

### Important

The API should also be able to communicate allocation warnings.

Example:

```json
{
  "warning": "Lower berth preference could not be fully satisfied because of availability."
}
```

The warning is informational; the booking can still succeed.

---

## GET /bookings

Return the authenticated user's bookings.

### Optional query parameters

```text
status
page
limit
```

### Response

```json
{
  "bookings": [],
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 3
  }
}
```

---

## GET /bookings/:pnr

Return complete booking details.

### Response

```json
{
  "pnr": "7412589630",
  "status": "CONFIRMED",
  "train": {
    "number": "12951",
    "name": "Example Express"
  },
  "journeyDate": "2026-09-15",
  "source": "New Delhi",
  "destination": "Example Station",
  "classCode": "3A",
  "passengers": [],
  "payment": {
    "status": "SUCCESS",
    "amount": 1450
  }
}
```

---

## POST /bookings/:pnr/cancel

Cancel an eligible booking.

### Response

```json
{
  "message": "Booking cancelled successfully",
  "pnr": "7412589630",
  "status": "CANCELLED"
}
```

Cancellation logic must release applicable seat allocations inside a database transaction.

---

# 7. Mock Payment APIs

## POST /payments/process

Process a mock payment for a provisional `PENDING_PAYMENT` booking, activating held seat allocations and issuing a 10-character unique travel PNR.

SmartRail uses a mock payment engine powered by Node.js cryptographic randomness and strict ACID transactions with row-level locks. No real external payment gateway is contacted.

### Authentication

Required (`smartrail_token` HTTP-only cookie).

The authenticated user's ID is retrieved exclusively from the verified token claim. Client-supplied authority fields (`userId`, `user_id`, `amount`, `status`, `pnr`) are strictly forbidden and rejected.

### Request Body

```json
{
  "bookingId": 101,
  "paymentMethod": "MOCK_UPI",
  "simulateFailure": false
}
```

#### Fields

| Field | Type | Required | Default | Description |
| :--- | :--- | :--- | :--- | :--- |
| `bookingId` | integer | Yes | - | Positive integer representing the booking to pay for. Must belong to authenticated user. |
| `paymentMethod` | string | No | `"MOCK_UPI"` | Payment method string (max 30 chars). Allowed: `MOCK_UPI`, `UPI`, `DEBIT_CARD`, `CREDIT_CARD`, `NET_BANKING`. Case-insensitive. |
| `simulateFailure` | boolean | No | `false` | Mock testing flag. When `true`, simulates a payment processor decline, records a `FAILED` payment audit row, leaves the booking `PENDING_PAYMENT`, and preserves held seats for retry within the original 10-minute window. |

### Responses

#### 1. Payment Success & Booking Confirmation — HTTP 200 OK

Returned when payment succeeds and booking is confirmed:

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Payment successful and booking confirmed",
  "isIdempotent": false,
  "payment": {
    "id": 501,
    "booking_id": 101,
    "amount": "1450.00",
    "status": "SUCCESS",
    "payment_method": "MOCK_UPI",
    "transaction_reference": "TXN_MOCK_f47ac10b-58cc-4372-a567-0e02b2c3d479",
    "created_at": "2026-11-12T16:45:00.000Z"
  },
  "booking": {
    "id": 101,
    "pnr": "SR8X2K9L3M",
    "userId": 1,
    "trainId": 1,
    "journeyDate": "2026-12-25",
    "sourceStationId": 1,
    "destinationStationId": 2,
    "classCode": "3A",
    "status": "CONFIRMED",
    "totalAmount": "1450.00",
    "createdAt": "2026-11-12T16:40:00.000Z",
    "updatedAt": "2026-11-12T16:45:00.000Z"
  },
  "passengers": [
    {
      "id": 201,
      "name": "Jane Doe",
      "age": 30,
      "gender": "F",
      "passengerStatus": "CONFIRMED",
      "allocationType": "CONFIRMED",
      "racSlot": null,
      "allocationStatus": "ACTIVE",
      "seatId": 45,
      "seatNumber": "12",
      "berthType": "LOWER",
      "coachNumber": "B1",
      "coachType": "AC 3 Tier"
    }
  ]
}
```

#### 2. Idempotent Replay on Already-Confirmed Booking — HTTP 200 OK

If a client resubmits payment for an already-confirmed booking, the transaction safely detects existing confirmation, commits no additional payment rows, and returns the existing confirmation details with `isIdempotent: true`:

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Booking is already confirmed",
  "isIdempotent": true,
  "payment": {
    "id": 501,
    "booking_id": 101,
    "amount": "1450.00",
    "status": "SUCCESS",
    "payment_method": "MOCK_UPI",
    "transaction_reference": "TXN_MOCK_f47ac10b-58cc-4372-a567-0e02b2c3d479",
    "created_at": "2026-11-12T16:45:00.000Z"
  },
  "booking": {
    "id": 101,
    "pnr": "SR8X2K9L3M",
    "status": "CONFIRMED"
  },
  "passengers": []
}
```

#### 3. Simulated Payment Failure (Retryable) — HTTP 402 Payment Required

Returned when `simulateFailure: true`. The mock engine records a `FAILED` payment audit row, leaves the booking in `PENDING_PAYMENT`, retains `HELD` seat allocations, and permits another payment attempt within the original 10-minute hold window:

```json
{
  "success": false,
  "statusCode": 402,
  "message": "Payment simulation failed. Your seats remain held within the 10-minute window. You may retry.",
  "payment": {
    "id": 502,
    "booking_id": 101,
    "amount": "1450.00",
    "status": "FAILED",
    "payment_method": "MOCK_UPI",
    "transaction_reference": "TXN_FAIL_c9a1b2c3-d4e5-4f6a-8b9c-0d1e2f3a4b5c",
    "created_at": "2026-11-12T16:42:00.000Z"
  },
  "booking": {
    "id": 101,
    "status": "PENDING_PAYMENT"
  }
}
```

### Error Responses

#### 400 Bad Request — Validation or Status Error

- **Client Authority Field**:
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Client-supplied authority field \"userId\" is not permitted"
  }
}
```
- **Cancelled Booking**:
```json
{
  "error": {
    "code": "BOOKING_ALREADY_CANCELLED",
    "message": "Booking has been cancelled and cannot be paid"
  }
}
```

#### 401 Unauthorized — Missing or Invalid Cookie

```json
{
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Authentication required"
  }
}
```

#### 403 Forbidden — Ownership Mismatch

```json
{
  "error": {
    "code": "FORBIDDEN",
    "message": "You do not have permission to pay for this booking"
  }
}
```

#### 404 Not Found — Booking Does Not Exist

```json
{
  "error": {
    "code": "BOOKING_NOT_FOUND",
    "message": "Booking not found"
  }
}
```

#### 410 Gone — Booking Hold Expired (> 10 Minutes)

If wall-clock time (`clock_timestamp()`) exceeds the 10-minute hold deadline when acquiring transaction locks, the engine atomically transitions allocations to `RELEASED`, marks the booking `CANCELLED`, and returns HTTP 410:

```json
{
  "error": {
    "code": "BOOKING_HOLD_EXPIRED",
    "message": "Booking hold has expired and seats have been released"
  }
}
```

---

# 8. Food APIs

## GET /food/menu?stationId=5

Menu data comes from `food_menu_items`.

Return available food items for a station.

### Response

```json
{
  "items": [
    {
      "id": 1,
      "name": "Veg Meal",
      "price": 150
    }
  ]
}
```

---

## POST /food/orders

### Authentication

Required.

### Request

```json
{
  "bookingId": 101,
  "stationId": 5,
  "items": [
    {
      "itemName": "Veg Meal",
      "quantity": 2,
      "unitPrice": 150
    }
  ]
}
```

### Response

```json
{
  "orderId": 9001,
  "status": "PLACED",
  "totalAmount": 300
}
```

---

## GET /food/orders

Return the user's food orders.

---

# 9. Complaint APIs

## POST /complaints

Supports optional image upload.

### Content Type

```text
multipart/form-data
```

### Fields

```text
bookingId
category
description
image
```

### Categories

```text
CLEANLINESS
WASHROOM
GARBAGE
WATER
OTHER
```

### Response

```json
{
  "complaintId": 7001,
  "status": "OPEN",
  "message": "Complaint submitted successfully"
}
```

---

## GET /complaints

Return complaints created by the authenticated user.

---

## GET /complaints/:id

Return complaint details.

---

# 10. Emergency APIs

## POST /emergency

Create an emergency assistance request.

### Request

```json
{
  "bookingId": 101,
  "coachId": 5,
  "seatId": 21,
  "requestType": "MEDICAL",
  "description": "Passenger needs immediate assistance."
}
```

### Response

```json
{
  "requestId": 8001,
  "status": "OPEN",
  "message": "Emergency request submitted"
}
```

In a portfolio simulation, this request appears in the admin dashboard.

---

## GET /emergency/:id

Return request status.

---

# 11. Notification APIs

## GET /notifications

Return notifications for the authenticated user.

---

## PATCH /notifications/:id/read

Mark one notification as read.

### Response

```json
{
  "message": "Notification marked as read"
}
```

---

# 12. Admin APIs

Admin authentication is required.

## POST /admin/trains

Create a train.

## PUT /admin/trains/:id

Update train information.

## POST /admin/stations

Create a station.

## POST /admin/coaches

Create a coach for a train.

## PUT /admin/coaches/:id

Update coach information.

## POST /admin/seats

Create a seat in a coach.

## PUT /admin/seats/:id

Update seat information.

## GET /admin/bookings

View bookings.

Optional filters:

```text
date
trainId
status
pnr
```

## GET /admin/complaints

View complaints.

## PATCH /admin/complaints/:id

Update complaint status.

Possible status:

```text
OPEN
IN_PROGRESS
RESOLVED
CLOSED
```

## GET /admin/emergency

View emergency requests.

## PATCH /admin/emergency/:id

Update emergency request status.

Possible status:

```text
OPEN
ACKNOWLEDGED
IN_PROGRESS
RESOLVED
```

---

# 13. Standard Error Format

All API errors should follow one structure.

```json
{
  "error": {
    "code": "BOOKING_NOT_AVAILABLE",
    "message": "No suitable seats are available for this request."
  }
}
```

Example error codes:

```text
INVALID_REQUEST
UNAUTHORIZED
FORBIDDEN
NOT_FOUND
DUPLICATE_RESOURCE
TRAIN_NOT_FOUND
STATION_NOT_FOUND
NO_SEAT_AVAILABLE
BOOKING_NOT_FOUND
BOOKING_ALREADY_CANCELLED
PAYMENT_FAILED
INTERNAL_SERVER_ERROR
```

---

# 14. HTTP Status Codes

Use meaningful status codes.

```text
200 OK
201 Created
204 No Content
400 Bad Request
401 Unauthorized
403 Forbidden
404 Not Found
409 Conflict
422 Unprocessable Entity
500 Internal Server Error
```

---

# 15. API-to-Database Responsibility

| API Module | Main Tables |
|---|---|
| Auth | users |
| Stations | stations |
| Trains | trains, train_stops |
| Passengers | passenger_profiles |
| Booking | bookings, booking_passengers, seat_allocations |
| Payment | payments |
| Food | food_orders, food_order_items |
| Complaints | complaints |
| Emergency | emergency_requests |
| Notifications | notifications |
| Admin | trains, stations, bookings, complaints, emergency_requests |

---

# 16. Smart Seat Allocation Boundary

The HTTP layer should not contain allocation logic.

Correct:

```text
POST /bookings
      ↓
BookingController
      ↓
BookingService
      ↓
SeatAllocationService
      ↓
SeatAllocator
      ↓
PostgreSQL
```

Incorrect:

```text
BookingController
      ↓
hundreds of seat-selection conditions
```

The allocator should be independently testable without Express.

---

# 17. API Development Order

Implement APIs in this order:

```text
1. Auth
2. Stations
3. Trains
4. Train availability
5. Passenger profiles
6. Basic booking
7. Mock payment
8. Booking history
9. Cancellation
10. Smart seat allocation
11. Food
12. Complaints
13. Emergency
14. Notifications
15. Admin
```

Do not implement every endpoint before testing the previous module.

---

# 18. End-to-End Core Flow

The most important working path is:

```text
React
  ↓
Search Trains
  ↓
GET /trains/search
  ↓
Select Train
  ↓
GET /trains/:id/availability
  ↓
Passenger Details
  ↓
POST /bookings
  ↓
Smart Seat Allocation
  ↓
Mock Payment
  ↓
PNR
  ↓
GET /bookings/:pnr
  ↓
Ticket Page
```

This flow should be completely functional before optional services are prioritized.

---

# 19. V1 API Scope

The initial implementation should focus on approximately 20–25 endpoints.

Do not create an endpoint just because a table exists.

An endpoint should exist when the frontend or an external client actually needs that operation.
