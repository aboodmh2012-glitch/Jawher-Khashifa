# Deployment

## Local development

```bash
npm install
npm run dev          # API :4000 + web :5173 (in-memory, simulators on)
```

No database is required for the MVP. Copy `.env.example` → `.env` to change ports,
map style, simulator count, etc.

## Local infrastructure (Phase 1+)

```bash
npm run infra:up     # docker compose: Postgres/PostGIS, TimescaleDB, Keycloak, NATS, MinIO
npm run infra:down
```

| Service | Port | Default creds (dev only) |
|---|---|---|
| PostgreSQL/PostGIS | 5432 | fusion / fusion |
| TimescaleDB | 5433 | fusion / fusion |
| Keycloak | 8080 | admin / admin (realm `fusion`) |
| NATS | 4222 / 8222 | — |
| MinIO | 9000 / 9001 | fusion / fusion-change-me |

The Postgres container runs `infrastructure/database/init.sql` on first boot.
Create TimescaleDB hypertables for `telemetry` and `positions` (Phase 2):

```sql
SELECT create_hypertable('telemetry', 'ts');
SELECT create_hypertable('positions', 'ts');
```

## Observability, health & drivers (Phase D)

- **Metrics:** `GET /metrics` exposes Prometheus text (families: `api_requests_total`,
  `api_request_duration_ms`, `adapter_messages_total`, `validation_failures_total`,
  `event_bus_published_total`/`_deduplicated_total`, `realtime_clients`,
  `realtime_dropped_messages_total`, `track_count`, `stale_assets`, `asset_count`).
  Scrape it with Prometheus; a real OpenTelemetry exporter swaps in behind
  `@fusion/observability` without changing instrumentation.
- **Health:** `GET /health/live` (process up) and `GET /health/ready` (component
  checks: store, bus, repositories, metrics; 503 until initialized). Demo-memory
  mode is ready with no external infra.
- **Resilience:** `@fusion/observability` provides `withTimeout`, `retry`
  (bounded exponential backoff — never infinite), and `CircuitBreaker`; adapters
  fail in isolation and one failing adapter never crashes the core.
- **Drivers (behind abstractions):** the event bus (`BUS_DRIVER`, default
  `memory`; `nats` via `createNatsBus`, JetStream — lazy/optional `nats`) and
  repositories (`REPO_DRIVER`, default `memory`; Postgres/Timescale via the
  lazy `pg` scaffold in `repositories-postgres.ts`). No business service imports
  NATS/Postgres directly. Memory remains the tested dev/test path; the durable
  drivers are seams, not yet run against a cluster/DB.

## Production notes

- Put the API behind a gateway/ingress that terminates TLS and validates the
  Keycloak JWT; set `CORS_ORIGIN` to the real web origin.
- Point the frontend at the deployed API via `VITE_API_URL` / `VITE_WS_URL`, and
  self-host map tiles (`VITE_MAP_STYLE`) for offline/air-gapped operation
  (`infrastructure` + `mbtiles`-style tile server).
- Swap `BUS_DRIVER=memory` for `nats` (or `mqtt`) to run services as separate
  deployables (Phase 7).
- Rotate every secret in `.env.example` before going live.

## Build

```bash
npm run typecheck    # backend + frontend
npm run build        # web-command-center production bundle (apps/web-command-center/dist)
npm test --workspace @fusion/operations-service
```

Serve `apps/web-command-center/dist` from any static host/CDN; run the backend
with `npm run start --workspace @fusion/operations-service` (or containerize it).
