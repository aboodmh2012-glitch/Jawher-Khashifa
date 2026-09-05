# Architecture

## Principles

- **Device-agnostic core.** The platform is written against one *normalized
  telemetry model* (`packages/shared-types/src/telemetry.ts`). Adapters translate
  each source into it. The core never imports an autopilot SDK.
- **Adapters at the edge.** Every external system — Skynode/PX4, MAVLink, TAK,
  video, generic — implements the same `Adapter` contract (`@fusion/adapter-sdk`).
- **One event bus, one contract.** Internal bus messages and browser WebSocket
  frames share the typed envelopes in `@fusion/event-contracts`, so backend and
  frontend can never drift.
- **Map-first UI.** The COP is the workspace; panels float over it.

## Data flow

```
 Edge / sources         Adapter layer            Operations backend         Clients
 ─────────────         ───────────────          ───────────────────       ────────
 Skynode/PX4  ┐        normalizeSkynode ┐        ┌ store (assets,          ┌ Web COP
 MAVLink      ┤ ─────► normalizeMavlink ┼──────► │  telemetry ring,   ───► │  (MapLibre)
 TAK (CoT)    ┤        cotToTelemetry    │  CoT   │  incidents, tasks)      │
 sensors/cam  ┘        (AdapterContext)  ┘        ├ alert engine            └ (CloudTAK,
 simulators                                       ├ event timeline             ODIN, Open
                                                  └ bus ──► WebSocket hub       MCT — future)
```

1. An adapter calls `ctx.onTelemetry(normalized)`.
2. The service updates the in-memory store, publishes `asset.position` +
   `asset.telemetry` on the bus, and runs the alert engine.
3. The WebSocket hub forwards every bus message to connected COPs, which update
   the map and panels.

## Services (current & target)

The MVP runs as **one** backend process (`services/operations-service`) with
internal modules matching the future service boundaries. The target decomposition
(Phase 7) splits them into deployables that communicate over NATS/MQTT:

| Module (today) | Future service | Responsibility |
|---|---|---|
| `routes.ts` | api-gateway | REST + auth edge |
| `store.ts`, `adapters.ts` | operations-service | assets, incidents, tasks |
| telemetry ring in `store.ts` | telemetry-service | TimescaleDB ingest + history |
| `alerts.ts` | alert-service | rules, notifications |
| (scaffold) | media-service | video/session brokering |
| `realtime.ts` | realtime-service | WebSocket fan-out |

## Normalized telemetry model

`NormalizedTelemetry` carries: position, heading, ground/vertical speed, flight
mode, GPS (fix + sats), battery (V + %), link quality, health (+components),
mission progress, sensor & camera state, and a `raw` passthrough for audit. Every
adapter maps into exactly this shape.

## Realtime topics

`asset.position`, `asset.telemetry`, `asset.health`, `asset.connected`,
`asset.disconnected`, `incident.created|updated`, `task.created|updated`,
`alert.created|acknowledged`, `event`, plus a `snapshot` sent on WebSocket connect
to hydrate a new client. Defined in `packages/event-contracts`.

## Frontend

React + Vite + MapLibre GL. High-frequency telemetry is held in a vanilla
`live-store` (outside React); the map reads it imperatively each animation frame,
while panels/lists subscribe through a throttled `useSyncExternalStore` hook so
~10 Hz updates never thrash React.

## Build phases

| Phase | Scope | State |
|---|---|---|
| 1 | repo, types, gateway, auth foundation | ✅ MVP |
| 2 | assets, Skynode simulator, telemetry, WebSockets | ✅ MVP |
| 3 | MapLibre COP, asset panel, live telemetry | ✅ MVP |
| 4 | incidents, tasks, alerts, event timeline | ✅ MVP |
| 5 | video architecture, history, replay | scaffolded |
| 6 | TAK adapter, Open MCT, Matrix | seams in place |
| 7 | offline sync, plugin SDK, multi-org, observability, deploy | planned |
