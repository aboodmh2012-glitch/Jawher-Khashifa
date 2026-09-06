# API

Base URL: `http://localhost:4000`. OpenAPI document: `GET /api/openapi.json`.
All `/api/*` routes except `/api/auth/login` require `Authorization: Bearer <token>`.

## Health
| Method | Path | Notes |
|---|---|---|
| GET | `/health/live` | process is up (liveness) |
| GET | `/health/ready` | critical deps initialized; 503 until ready. Demo-memory mode is ready with no external infra. |
| GET | `/health` | legacy alias (kept for compatibility) |
| GET | `/api/schemas` | registered runtime schemas (`envelope.v1`, `raw-event.v1`, `telemetry.v1`, …) |
| GET | `/api/quarantine` | invalid payloads that failed validation (analyst+) |
| GET | `/api/raw-events/by-correlation/:cid` | trace derived data back to its raw source (analyst+) |

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
