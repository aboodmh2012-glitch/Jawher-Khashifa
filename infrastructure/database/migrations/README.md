# Database migrations (Database V2)

Forward-only, ordered SQL migrations for PostgreSQL/PostGIS.

- `../init.sql` is the **0000 baseline** (organizations, users, teams, devices,
  assets, incidents, tasks, alerts, geofences, audit_logs).
- `0001_org_and_assets.sql` — organizational hierarchy (regions, operations_centers,
  units, team_memberships), **`asset_devices`** (Asset↔Device over time, replacing
  `assets.device_id`), and `agents`.
- `0002_raw_events_and_state.sql` — durable append-only `raw_events`
  (immutable payload trigger + `processing_status` enum), `operations` +
  `operation_assignments`, and hot `current_asset_state`.

## Running

Requires a reachable PostgreSQL with PostGIS (see `infrastructure/docker`).

```bash
npm i pg                       # optional dependency (not bundled)
DATABASE_URL=postgres://fusion:fusion@localhost:5432/fusion \
  node infrastructure/database/migrate.mjs
```

The runner applies `init.sql` then each `NNNN_*.sql` in order, recording applied
files in a `schema_migrations` table so re-runs are idempotent. It is **not**
executed in CI/demo here (no database) — the memory store remains the tested
path. Never edit an applied migration; add a new one.
