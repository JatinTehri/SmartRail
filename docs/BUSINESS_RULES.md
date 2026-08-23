# Business Rules — SmartRail

These rules define expected application behavior. They are not tied to a specific programming language.

## Booking

BR-001: A booking may contain multiple passengers.

BR-002: Every confirmed booking receives a unique PNR.

BR-003: A seat can be confirmed for only one overlapping journey reservation.

BR-004: Final seat activation/cancellation changes must be atomic. Initial payment holds are created in a transaction before mock payment is completed.

BR-005: Cancellation releases applicable HELD or ACTIVE seat allocations in a transaction.


## Payment and Holding

BR-006: A booking starts in `PENDING_PAYMENT` while its selected seats are temporarily held.

BR-007: A PNR is generated only after successful payment/booking confirmation.

BR-008: Failed or cancelled payment releases HELD allocations and cancels the pending booking.

## Group Allocation

BR-010: Passengers in the same booking should be kept together whenever feasible.

BR-011: Prefer consecutive or nearby seats over scattered seats.

BR-012: Preferences may be relaxed when satisfying every passenger constraint is impossible.

## Berth Preference

BR-020: A requested berth is a preference, not a guarantee.

BR-021: The allocator should maximize preference satisfaction while preserving group and safety priorities.

## Female Passenger Preference

BR-030: For a female passenger travelling alone, prefer a nearby female passenger when feasible.

BR-031: For RAC, prefer female-female pairing when a suitable female RAC passenger is available.

BR-032: Safety preferences must not incorrectly claim a seat is guaranteed.

BR-033: If the preferred arrangement is unavailable, use the best valid fallback.

## Senior Citizen

BR-040: Prefer lower berth when available.

BR-041: Lower berth preference can be relaxed when required by availability or higher-priority constraints.

## RAC

BR-050: RAC assignment must follow the configured berth-sharing model.

BR-051: The allocator should optimize compatible pairings.

## General Priority

When constraints conflict, use this conceptual order:

1. Validity and availability
2. Booking consistency
3. Mandatory business constraints
4. Safety-sensitive preferences
5. Group proximity
6. Berth/window preferences
7. General comfort optimization

Exact priority weights will be finalized in SEAT_ALLOCATION.md.
