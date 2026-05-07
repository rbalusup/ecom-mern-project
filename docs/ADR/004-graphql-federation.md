# ADR 004 — Apollo Federation v2 Ready from Day One

**Status**: Accepted  
**Date**: 2026-05-07

## Context

The platform starts as a single GraphQL subgraph. As it grows, splitting into separate services (catalog, orders, users) becomes desirable. The architecture should not require a breaking schema migration when that happens.

## Decision

Build the single `apps/api` subgraph as a **Federation v2 subgraph** from the start using `@apollo/subgraph` and `@key` entity directives.

## Rationale

- Adding `@key(fields: "id")` to `Product`, `User`, and `Order` types costs nothing now but enables splitting these into separate subgraphs without changing the client-facing supergraph schema.
- A supergraph router (Apollo Router) can be added later without modifying any existing resolver.
- `@apollo/subgraph` adds ~200KB to the bundle — acceptable given the future flexibility.

## Consequences

- All entity types must have an `id: ID!` field and a corresponding `__resolveReference` resolver.
- The `buildSubgraphSchema` function from `@apollo/subgraph` wraps the type definitions.
- If the single-subgraph architecture is sufficient long-term, the Federation decorators add zero runtime cost.
