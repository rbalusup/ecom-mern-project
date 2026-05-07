# ADR 003 — Event Sourcing for Order State Machine

**Status**: Accepted  
**Date**: 2026-05-07

## Context

Orders are the most critical domain entity. They must be auditable, their state transitions must be enforced, and downstream consumers (notifications, analytics, fulfillment) need to react to specific transitions.

## Decision

Use **event sourcing** for orders: every state transition produces an `OrderEvent` document in a separate collection. The `Order` document holds the current state snapshot.

## Rationale

**Audit trail**: Compliance requires knowing who changed what, when. `OrderEvent` provides an immutable log.

**Idempotency**: Each `OrderEvent` has a unique `idempotencyKey` (hash of `orderId + fromStatus + toStatus`). Duplicate SQS deliveries produce a MongoDB duplicate key error — safely swallowed. This is simpler than Redis-only idempotency.

**Replay**: Order history can be reconstructed from events. Useful for debugging edge cases and backfilling analytics.

**Clean event publishing**: The `OrderEvent` document is the canonical source for Kafka publishing. The worker reads `OrderEvent` and publishes to `ecom.order.events` — no risk of publishing duplicate events from the `Order` document.

**State machine enforcement**: `ORDER_TRANSITIONS` map in `@ecom/shared` is the single source of truth for valid transitions. Repository checks transitions before writing.

## Trade-offs

- Two writes per transition (Order + OrderEvent), requiring a MongoDB session for atomicity.
- Storage overhead for high-volume order event collection (mitigated by archival Lambda).
- Slightly more complex `OrderRepository.transitionStatus` implementation.

## Consequences

- `OrderModel.transitionStatus()` uses MongoDB sessions (replica set required — Atlas satisfies this).
- `OrderEvent` collection is append-only; no updates or deletes.
- Archival Lambda (`apps/ingestion/order-snapshot`) runs daily to snapshot old events to S3.
