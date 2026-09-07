# Fusion Operations Platform

A modular, web-based **operations & situational-awareness command center** for
**civilian** operations — emergency management, search & rescue, inspection,
mapping, fleet & infrastructure monitoring, and unmanned-vehicle telemetry.

> **Scope & safety (§28).** Civilian use only. This platform does **not** implement
> weapon control, fire control, targeting, strike planning, or autonomous
> engagement. See [`docs/SECURITY.md`](docs/SECURITY.md).

The command center is **map-first**: a full-screen MapLibre common operating
picture with live assets, incidents, geofences and routes; a context panel with
live telemetry; an alert engine; and an event timeline — all fed in real time
over WebSockets from a device-agnostic adapter layer (Skynode/PX4, MAVLink, TAK).

The project is evolving from a single Command Center into a broader operations
**platform**. The existing core remains intact while new platform contracts,
provider/app SDKs, and an offline-capable Edge Runtime are added incrementally.
See [`docs/PLATFORM.md`](docs/PLATFORM.md).

---

## Quick start (MVP — no database or hardware required)

Requirements: **Node 20+**.

```bash
npm install          # installs all workspaces
npm run dev          # starts the API (:4000) and the web app (:5173) together
```

Then open **http://localhost:5173** and sign in with any password as one of:
`supervisor`, `operator`, `analyst`, `admin`.

You will see (per §30):

1. Login screen 2. Operations dashboard 3. Full-screen MapLibre map
4. Simulated UAVs 5. moving live 6. asset list 7. asset details panel
8. battery / GPS / altitude / speed telemetry 9. live WebSocket updates
10. incident markers 11. alert panel 12. event timeline.

Run pieces individually:

```bash
npm run dev:api      # backend only  (http://localhost:4000, /health, /api/openapi.json)
npm run dev:web      # frontend only (http://localhost:5173)
npm run typecheck    # type-check backend + frontend
npm run build        # production build of the web app
npm test --workspace @fusion/operations-service   # unit tests
```

Demo mode is on by default. Disable the simulators with `SIM_ENABLED=false`.
Copy `.env.example` to `.env` to configure ports, map style, etc.

---

## Optional local infrastructure (Phase 1+)

The MVP runs entirely in-memory. For persistence, identity, object storage and a
real message bus:

```bash
npm run infra:up     # Postgres/PostGIS, TimescaleDB, Keycloak, NATS, MinIO
npm run infra:down
```

See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

---

## Repository layout

```
apps/web-command-center     React + TypeScript + Vite + MapLibre GL — first platform app
services/operations-service TypeScript backend: REST + WebSocket + simulators
services/edge-runtime       offline edge journal + store-and-forward sync boundary
adapters/
  generic   @fusion/adapter-sdk   adapter contract + generic fleet simulator
  skynode   Auterion Skynode X / PX4 normalizer + UAV simulator
  mavlink   generic MAVLink adapter interface
  tak       internal objects ↔ Cursor-on-Target (CoT)
  video     RTSP / WebRTC / HLS stream descriptors
packages/
  shared-types        domain model + normalized telemetry
  event-contracts     realtime event envelopes (bus + WebSocket)
  platform-contracts  operation/provider/app/edge platform boundaries
  provider-sdk        provider registry + capability discovery
  plugin-sdk          application registry + activation lifecycle
infrastructure/       docker-compose, database schema, keycloak realm
docs/                 architecture, API, adapters, data model, security, deployment, platform
```

## Architecture at a glance

```text
Edge devices / remote sites
        ↓
Edge Runtime → Adapters / Providers → RawEvent → Validation / Normalization
                                                ↓
                                  Event Bus → Domain Services
                                                ↓
                             Observations / Fusion / Tracks
                                                ↓
                              Operational Picture + History
                                                ↓
                                 Realtime / Sync → Apps
                                                ↓
                                      Web Command Center
```

The core is written against **one normalized telemetry model** and never against
a specific autopilot or vendor. New hardware = a new adapter. Broader integrations
are exposed as capability-declaring providers rather than vendor-specific core
logic.

## Platform baseline

The current baseline now includes:

- RawEvent-first provenance and runtime validation
- versioned realtime event envelopes and correlation/causation IDs
- repository boundaries for persistence
- observations, fusion, tracks and confidence/data-quality state
- organization / operation aware platform contracts
- Provider SDK with capability registry and health lifecycle
- App / Plugin SDK with capability checks and activation lifecycle
- Edge Runtime foundation with journal-first ingestion, cursors and store-and-forward
- narrow optional AI capability contracts for incident, alert, timeline and data-quality assistance

The next delivery sequence is state/history separation, authoritative organization
and operation scoping, durable edge storage, offline synchronization, provider/app
hardening, media/replay, narrow local AI, audit/security hardening and production HA.
See [`docs/PLATFORM.md`](docs/PLATFORM.md) for the authoritative platform roadmap.

## Build phases

MVP delivered: Phases 1–4 core (assets, simulators, telemetry, WebSockets, map,
panels, incidents, tasks, alerts, timeline). Video/replay remains incomplete.
TAK integration seams exist. Platform/edge/provider/plugin foundations are now
present, while durable offline sync, multi-org hardening and production deployment
remain follow-on work.

## License

MIT.
