# API

Base URL: `http://localhost:4000`. OpenAPI document: `GET /api/openapi.json`.
All `/api/*` routes except `/api/auth/login` require `Authorization: Bearer <token>`.

## Auth
| Method | Path | Notes |
|---|---|---|
| POST | `/api/auth/login` | body `{username, password}` → `{token, user, expiresAt}`. Demo: any password; users `supervisor`/`operator`/`analyst`/`admin`. |
| GET | `/api/auth/me` | current user |

## Assets & telemetry
| Method | Path | Notes |
|---|---|---|
| GET | `/api/assets` | all assets (with latest telemetry) |
| GET | `/api/assets/:id` | one asset |
| GET | `/api/telemetry/:assetId?from&to` | buffered telemetry history |

## Incidents / tasks
| Method | Path | Role |
|---|---|---|
| GET | `/api/incidents` | any |
| POST | `/api/incidents` | operator+ |
| PATCH | `/api/incidents/:id` | operator+ (`{status, note}`) |
| GET | `/api/tasks` | any |
| POST | `/api/tasks` | operator+ |
| PATCH | `/api/tasks/:id` | operator+ |

## Alerts / events / map / audit
| Method | Path | Role |
|---|---|---|
| GET | `/api/alerts` | any |
| POST | `/api/alerts/:id/ack` | operator+ (`{notes?}`) |
| GET | `/api/events` | any |
| GET | `/api/map/geofences` | any |
| GET | `/api/map/routes` | any |
| GET | `/api/audit` | supervisor+ |
| GET | `/api/integrations` | any — adapter status |

## WebSocket

Connect to `ws://localhost:4000/ws?token=<token>`. On connect the server sends a
`snapshot` envelope, then a live stream of typed envelopes (see
`packages/event-contracts`): `asset.position`, `asset.telemetry`, `asset.health`,
`asset.connected`, `asset.disconnected`, `incident.*`, `task.*`, `alert.*`,
`event`. Each frame is `{ topic, ts, payload }`.

## Open MCT feed (§13)

Normalized telemetry is exposed so NASA Open MCT can be fed later without
duplicating its source: point an Open MCT telemetry adapter at
`GET /api/telemetry/:assetId` (historical) and the WebSocket `asset.telemetry`
topic (realtime). Object identifiers map to `assetId`.


## Reliability increment changes

- All `/api/*` endpoints except `/api/auth/config` and `/api/auth/login` require a Bearer header. URL tokens are rejected.
- `GET /api/auth/config` returns `{ "mode": "demo" | "oidc" }`.
- `POST /api/auth/login` requires a valid demo password; absent in OIDC mode (404).
- `GET /api/insights` returns a read-only `OperationalBrief` with source record IDs.
- `PATCH /api/features/:id` requires `expectedVersion`; mismatches return 409.
- `POST /api/raw-events/reprocess` returns 501 until a replay worker exists.
- `/ws`: send `{ "type": "auth", "token": "..." }` as the first frame within five seconds. Snapshot follows successful authentication and includes tasks. No query token.
- Mutations reject unknown fields and invalid geometry. Tenant/identity fields are server-owned.
- The old hand-authored OpenAPI is a partial index; runtime schemas in validation.ts are authoritative. Complete generated documentation remains a release gate.
