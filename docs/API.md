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

Return train information and route details.

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
      "stopOrder": 1,
      "arrivalTime": null,
      "departureTime": "16:55"
    }
  ]
}
```

---

## GET /trains/:trainId/availability

Return seat availability for a journey segment.

### Query Parameters

```text
journeyDate
sourceStationId
destinationStationId
classCode
```

### Response

```json
{
  "trainId": 10,
  "journeyDate": "2026-09-15",
  "classCode": "3A",
  "availability": {
    "confirmed": 42,
    "rac": 6,
    "waitlist": 0
  }
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

```json
{
  "trainId": 10,
  "journeyDate": "2026-09-15",
  "sourceStationId": 1,
  "destinationStationId": 8,
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
      "name": "Priya",
      "age": 23,
      "gender": "FEMALE",
      "berthPreference": "LOWER",
      "windowPreference": true
    }
  ]
}
```

### Internal flow

```text
Request
  ↓
Validate user
  ↓
Validate train and stations
  ↓
Validate journey date
  ↓
Start DB transaction
  ↓
Read current availability
  ↓
Lock relevant reservation rows
  ↓
Run Smart Seat Allocation Engine
  ↓
Create PENDING_PAYMENT booking
  ↓
Create booking passengers
  ↓
Create HELD seat allocations
  ↓
Commit temporary hold
  ↓
Mock Payment
  ↓
SUCCESS?
  ├─ Yes → activate allocations → CONFIRMED → generate PNR
  └─ No  → release holds → booking cancelled
```

Payment may occur as a separate step in V1 using mock payment.

### Response — 201

The initial response represents a temporary payment hold. No PNR is returned yet.

```json
{
  "message": "Booking created and seats temporarily held",
  "booking": {
    "bookingId": 101,
    "pnr": null,
    "status": "PENDING_PAYMENT",
    "trainNumber": "12951",
    "journeyDate": "2026-09-15",
    "source": "New Delhi",
    "destination": "Example Station",
    "classCode": "3A",
    "passengers": [
      {
        "name": "Rahul",
        "status": "CONFIRMED",
        "coach": "B2",
        "seatNumber": "21",
        "berthType": "LOWER"
      },
      {
        "name": "Priya",
        "status": "CONFIRMED",
        "coach": "B2",
        "seatNumber": "22",
        "berthType": "LOWER"
      }
    ],
    "totalAmount": 1450,
    "paymentRequired": true
  }
}
```

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

## POST /payments/mock

Complete the mock payment for a `PENDING_PAYMENT` booking.

### Authentication

Required.

### Request

```json
{
  "bookingId": 101,
  "result": "SUCCESS"
}
```

Allowed results:

```text
SUCCESS
FAILED
CANCELLED
```

### Success response

```json
{
  "paymentId": 501,
  "status": "SUCCESS",
  "transactionReference": "MOCK-8F42A1",
  "booking": {
    "bookingId": 101,
    "pnr": "7412589630",
    "status": "CONFIRMED"
  }
}
```

On successful payment, HELD seat allocations become ACTIVE and the PNR is generated.

On failed/cancelled payment, HELD allocations are released and the booking becomes CANCELLED.

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
