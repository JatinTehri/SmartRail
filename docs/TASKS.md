# SmartRail Development Tasks

## Week 1 — Foundation

- [x] Create GitHub repository
- [x] Create frontend React project
- [x] Create backend Express project
- [x] Configure PostgreSQL
- [x] Configure environment variables
- [x] Create base project structure
- [x] Design and create core database tables
- [x] Create development seed dataset (stations, trains, stops, coaches, seats, food menu)
- [x] Implement registration/login/logout (Phase 2 — JWT in HttpOnly cookie, bcrypt, auth middleware)
- [ ] Build basic navbar/layout

## Week 2 — Train & Availability

- [x] Station search (GET /api/stations/search?q=...)
- [x] Train search (GET /api/trains/search?fromStationId=...&toStationId=...&journeyDate=...&classCode=...)
- [x] Train details (GET /api/trains/:trainId)
- [ ] Coach/seat model
- [x] Seat availability API (GET /api/trains/:trainId/availability)
- [x] Train search UI (TrainSearch.jsx, StationSelect.jsx, TrainCard.jsx)
- [x] Seat layout UI (SeatAvailability.jsx, SeatLayout.jsx)

## Week 3 — Booking

- [x] Passenger management (GET /api/passengers, POST /api/passengers, DELETE /api/passengers/:id)
- [ ] Booking form
- [ ] Preferences
- [x] Booking API (POST /api/bookings with SmartRail Demo Fare Model)
- [x] Temporary seat holds (10-minute HELD status, segregated Confirmed/RAC pools, row locks, eager expiration cleanup)
- [x] Mock payment success/failure flow (POST /api/payments/process with retryable FAILED simulation)
- [x] PNR generation after successful payment (10-char 'SR' + 8 uppercase alphanumeric with SAVEPOINT collision retries)
- [x] Ticket confirmation (joined receipt returned, seat allocations HELD -> ACTIVE, idempotent replays, concurrent race safety)
- [ ] Booking history
- [ ] Cancellation

## Week 4 — Smart Seat Allocation

- [ ] Basic seat allocator
- [ ] Preference scoring
- [ ] Group allocation
- [ ] Berth preference
- [ ] Window preference
- [ ] Senior citizen preference
- [ ] Female passenger preference
- [ ] RAC pairing preference
- [ ] Fallback logic
- [ ] Unit tests for allocator
- [ ] Concurrent booking protection

## Week 5 — Services & Admin

- [ ] Food menu management/data
- [ ] Food ordering
- [ ] Cleanliness complaints
- [ ] Local image upload
- [ ] Emergency requests
- [ ] In-app notifications
- [ ] Basic admin dashboard
- [ ] Coach/seat management
- [ ] Emergency request management

## Week 6 — Polish

- [ ] API testing
- [ ] End-to-end booking testing
- [ ] Responsive design
- [ ] Error states
- [ ] Loading states
- [ ] Security review
- [ ] Deployment
- [ ] README
- [ ] Demo data
- [ ] Final portfolio screenshots

## Rule

Do not start optional features until the core booking flow and seat allocation engine work reliably.
