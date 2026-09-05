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
apps/web-command-center     React + TypeScript + Vite + MapLibre GL — the UI
services/operations-service TypeScript backend: REST + WebSocket + simulators
adapters/
  generic   @fusion/adapter-sdk   adapter contract + generic fleet simulator
  skynode   Auterion Skynode X / PX4 normalizer + UAV simulator
  mavlink   generic MAVLink adapter interface
  tak       internal objects ↔ Cursor-on-Target (CoT)
  video     RTSP / WebRTC / HLS stream descriptors
packages/
  shared-types      domain model + normalized telemetry
  event-contracts   realtime event envelopes (bus + WebSocket)
infrastructure/     docker-compose, database schema, keycloak realm
docs/               ARCHITECTURE, API, ADAPTERS, DATA_MODEL, SECURITY, DEPLOYMENT
```

## Architecture at a glance

```
Edge devices / UAVs → Adapter layer → Operations backend → WebSocket → Web command center
   (Skynode/PX4,        (normalize to     (store, alert       (live      (MapLibre COP,
    MAVLink, TAK,        one telemetry      engine, events)     GeoJSON)   panels, timeline)
    sensors, video)      model)
```

The core is written against **one normalized telemetry model** and never against
a specific autopilot or vendor. New hardware = a new adapter, not a core change.
Full detail in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Build phases

MVP delivered: Phases 1–4 core (assets, simulators, telemetry, WebSockets, map,
panels, incidents, tasks, alerts, timeline). Remaining: video/replay (5),
TAK/Open MCT/Matrix (6), offline sync / plugin SDK / multi-org hardening (7).
See the phase table in `docs/ARCHITECTURE.md`.

## License

MIT.
