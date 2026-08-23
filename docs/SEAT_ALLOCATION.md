# Smart Seat Allocation Engine

## 1. Purpose

The engine receives a booking request and available seats and returns the best valid allocation according to configured rules.

It should be deterministic, testable, and independent from HTTP/controller code.

## 2. Input

The allocator should receive:

- Journey date
- Train/class
- Available seats
- Passenger list
- Gender
- Age
- Berth preference
- Window preference
- RAC status/context
- Group/booking information
- Applicable rules

## 3. Output

```text
AllocationResult
├── passenger -> assigned seat
├── allocation status
├── preference score
├── fallback reasons
└── warnings if preferences could not be satisfied
```

## 4. Basic Strategy

Start with a scoring-based allocator rather than a complex optimization library.

For each candidate seat/group:

1. Verify the seat is valid and available.
2. Calculate preference compatibility.
3. Calculate group proximity.
4. Apply safety-sensitive preferences.
5. Apply senior-citizen preferences.
6. Apply berth/window preferences.
7. Calculate a total score.
8. Select the highest-scoring valid arrangement.

## 5. Example Conceptual Score

```text
Total Score =
  validity score
+ safety preference score
+ group proximity score
+ berth preference score
+ window preference score
+ coach balancing score
```

The exact numeric weights should be tuned through tests rather than assumed to be perfect.

## 6. Group Booking

For 4 passengers:

```text
Preferred:
21, 22, 23, 24

Fallback:
21, 22, 25, 26

Avoid:
21, 37, 52, 68
```

The engine should minimize distance between assigned seats.

## 7. Female Travelling Alone

For a female travelling alone:

```text
Find suitable nearby female passenger/seat
        |
        +-- available -> increase score
        |
        +-- unavailable -> continue normal allocation
```

This is a preference/optimization rule, not a guarantee.

## 8. RAC

When RAC sharing is modeled:

```text
Female RAC passenger
        |
        v
Search compatible female RAC pairing
        |
        +-- found -> prioritize
        |
        +-- not found -> valid fallback
```

## 9. Senior Citizen

Prefer lower berth candidates for eligible passengers.

## 10. Conflict Handling

Example:

- Family wants adjacent seats.
- One member requests window.
- Senior passenger wants lower berth.
- Available seats cannot satisfy all.

The engine should produce the best valid combination rather than fail the entire booking.

## 11. Testing Scenarios

Test at minimum:

- One passenger, no preference
- One passenger, lower berth
- One passenger, window
- Multiple passengers with consecutive seats available
- Multiple passengers without consecutive seats
- Female travelling alone
- Female travelling alone with nearby female available
- Female travelling alone with no suitable female nearby
- Female RAC with female RAC candidate
- Female RAC without female RAC candidate
- Senior citizen with lower berth available
- Conflicting preferences
- No seats available
- Multiple simultaneous booking attempts

## 12. Booking Hold Boundary

The allocator returns a proposed valid allocation. The booking service creates the corresponding `HELD` records for a `PENDING_PAYMENT` booking. After successful payment, those allocations become `ACTIVE`.

The engine must never assign a seat that conflicts with an existing `HELD` or `ACTIVE` allocation for the same journey segment, except for valid RAC-slot sharing.

Seat availability must be checked again during the final database transaction/hold step.
