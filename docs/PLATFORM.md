# Platform Architecture Baseline

This document defines the next production baseline for Jawher-Khashifa / Fusion Operations Platform. It extends the current system incrementally; it does not replace the existing adapters, RawEvent journal, normalized telemetry, fusion, event bus, realtime gateway, or Command Center.

## Target layers

```text
Edge devices / remote sites
        |
        v
Edge Runtime
  - local journal first
  - store-and-forward
  - sync cursor / resume
  - health and connectivity
        |
        v
Adapters + Providers
  - Skynode / PX4
  - MAVLink
  - TAK / CoT
  - video
  - future map, weather, messaging, storage and AI providers
        |
        v
RawEvent Journal -> Validation -> Normalization
        |
        v
Event Bus -> Domain Services -> Observations / Fusion / Tracks
        |
        v
Operational Picture + History + Realtime / Sync
        |
        v
Apps / Plugins -> Web Command Center
```

Cross-cutting services: identity, authorization, audit, schemas, repositories, observability and secrets.

## Platform contracts

`@fusion/platform-contracts` is the stable boundary for:

- organization / operation context
- operation and feature references
- provider manifests and capabilities
- application manifests
- edge runtime status and sync cursors
- narrow operational AI capabilities

External systems should declare capabilities instead of forcing vendor-specific logic into the core.

## Provider SDK

`@fusion/provider-sdk` introduces a provider registry. Providers may expose capabilities such as telemetry, video, maps, messaging, identity, storage, analytics, weather, notifications or narrow AI assistance.

Device adapters remain valid and are not replaced. The provider layer is a broader integration boundary above and beside adapters.

## App / Plugin SDK

`@fusion/plugin-sdk` introduces application registration and activation with capability checks. The existing Web Command Center remains the first application. Future apps can include fleet, incidents, SAR, mapping, replay, analytics, administration and edge management without turning the core into one large UI.

## Edge Runtime

`@fusion/edge-runtime` begins the offline-capable edge boundary. The first implementation provides:

- journal-before-send behavior
- source sequence deduplication
- per-source sync cursors
- batched store-and-forward
- connected / degraded status
- transport abstraction

The in-memory journal is intentionally a development implementation. Production persistence should use a durable local database and preserve idempotency across restart.

## State and history rule

Do not collapse all persistence into one Store. The target separation is:

1. RawEvent journal: immutable source evidence and provenance.
2. Normalized/event history: validated canonical events.
3. Domain state: current authoritative asset, incident, task and feature state.
4. Time-series/history: telemetry and historical queries.
5. Derived state: observations, fused tracks, confidence and operational-picture projections.

Repository interfaces remain the boundary between domain logic and persistence.

## AI boundary

AI is a narrow optional provider, not a general dependency of every service. Initial allowed capabilities are:

- incident summaries
- alert explanations
- timeline summaries
- data-quality explanations
- telemetry anomaly assistance
- operator recommendations for situational awareness and safety

AI must not implement weapon control, targeting, engagement sequencing, firing logic or autonomous attack behavior.

## Delivery sequence

1. Stabilize contracts, RawEvent, validation and repositories.
2. Separate current state from history/time-series persistence.
3. Make organization + operation scoping authoritative.
4. Harden realtime resume, ordering, deduplication and idempotency.
5. Integrate durable Edge Runtime storage.
6. Add offline synchronization and conflict policy.
7. Expand Provider SDK and provider lifecycle.
8. Expand App/Plugin SDK and permissions.
9. Complete media/replay synchronization.
10. Add narrow local AI provider/runtime.
11. Harden audit, security and multi-organization isolation.
12. Production HA, deployment and disaster recovery.
