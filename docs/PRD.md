# Product Requirements Document — SmartRail

## 1. Product Vision

Build a practical railway reservation platform that provides the familiar booking experience of a railway reservation website while adding intelligent seat allocation focused on passenger comfort and safety.

## 2. Portfolio Goal

The project should demonstrate:

- Full-stack development
- REST API design
- Relational database design
- Authentication and authorization
- Transactions and booking consistency
- Algorithmic problem solving
- Clean frontend/backend separation

The Smart Seat Allocation Engine is the primary differentiating feature.

## 3. Users

### Passenger
Can search trains, manage passengers, select preferences, book tickets, view/cancel bookings, order food, submit complaints, and request emergency assistance.

### Admin
Can manage trains, stations, coaches/seats, bookings, complaints, and emergency requests.

## 4. V1 Features

### Authentication
- Register
- Login
- Logout
- Protected routes
- User profile

### Train Search
- Source
- Destination
- Journey date
- Class
- Search results
- Train details
- Availability

### Booking
- Passenger details
- Berth preference
- Window preference where applicable
- Booking summary
- Temporary seat allocation/hold
- Mock payment
- Booking confirmation after successful payment
- PNR generation after successful payment
- Booking history
- Cancellation

### Smart Allocation
- Keep passengers under one booking together where possible
- Honor preferences when possible
- Prefer lower berth for eligible senior citizens
- Prefer female-to-female RAC pairing when feasible
- Prefer nearby female passenger for a female travelling alone when feasible
- Fall back gracefully when constraints conflict

### Passenger Services
- Food ordering
- Cleanliness complaint with optional image
- Emergency request
- In-app notifications

### Admin
- Dashboard
- Basic train/station management
- Coach/seat management
- Booking visibility
- Complaint management
- Emergency request management

## 5. Out of Scope for V1

- Real railway APIs
- Real payment settlement
- SMS
- Complex ML prediction
- Real-time GPS
- Microservices
- Redis
- Kafka
- Docker/Kubernetes
- Voice assistant
- Social/community features

These may be future scope.

## 6. Success Criteria

A passenger should be able to:

Search → select train → enter passengers → choose preferences → receive intelligent seat allocation → complete mock payment → receive PNR → view/cancel booking.

The complete flow must work end-to-end before optional features are added.
