# Data model

Canonical TypeScript definitions: `packages/shared-types`. SQL schema (Phase 1+):
`infrastructure/database/init.sql`. Telemetry & positions are time-series and
belong in TimescaleDB hypertables; everything else in PostgreSQL/PostGIS.

## Operational ontology (Database V2)

Two hierarchies are kept **separate** (home ownership vs temporary assignment):

```
Permanent org:  Organization → Region → OperationsCenter → Unit → Team → (User via TeamMembership)
Assets/devices: Asset (home-owned by a Unit) ── AssetDevice ──► Device   (over time)
                Agent REPRESENTS Asset
Temporary:      Asset ASSIGNED_TO Operation   (operation_assignments)
```

- **Asset↔Device** is modeled as `asset_devices` (asset_id, device_id, role,
  is_primary, installed_at, removed_at), **not** `assets.device_id` (deprecated):
  an Asset has many Devices and a Device may move between Assets over time.
- **RawEvent** is durable and append-only with a `processing_status` lifecycle
  (`received → validated → normalized`, or `quarantined`/`failed`/`reprocessed`);
  payloads are immutable (enforced by a DB trigger) so events can be safely
  reprocessed. Carries organization/operation/asset/device/agent ids,
  adapterId/version, correlationId, deduplicationKey, checksum.
- **Agent** is the software representative of an Asset at the edge (agentId,
  assetId, deviceIds, capabilities, connectionStatus).

Migrations: `infrastructure/database/migrations/*.sql` (forward-only) + the
`migrate.mjs` runner; `init.sql` is the 0000 baseline. Memory store remains the
tested dev/test path.

## Multi-organization (§15)

Every row is scoped by `org_id`. Organization data is isolated: queries always
filter by the caller's `orgId` (carried in the auth token). The tree:

```
Organization
 ├── Users        (role per user)
 ├── Teams        (member users)
 ├── Assets       (── Devices)
 ├── Incidents
 ├── Tasks
 ├── Geofences / Routes
 └── Telemetry / Positions / Alerts / Events / Audit
```

## Core entities

| Entity | Key fields |
|---|---|
| `Organization` | id, name |
| `User` | id, orgId, username, role |
| `Asset` | id, orgId, name, type, link (live/delayed/offline/unknown), health, position, heading, lastSeen, latest telemetry |
| `NormalizedTelemetry` | deviceId, assetId, timestamp, position, heading, speeds, flightMode, gps, battery, linkQuality, health, mission, sensors, camera |
| `Incident` | id, title, type, severity, status, location, timeline[], assignedAssetIds[] |
| `OperationalTask` | id, name, type, priority, status, assignedAssetId, location, routeId, deadline |
| `Alert` | id, kind, severity, status, source, message, acknowledgedBy |
| `Geofence` | id, name, kind (zone/no-fly/area-of-interest), polygon |
| `RouteEntity` | id, name, waypoints[] |
| `AuditLog` | id, userId, action, resource, at, previousValue, newValue |
| `RawEvent` | id, protocol, messageType, payload, receivedAt, parserVersion, correlationId — **kept verbatim, never deleted**, so the pipeline is replayable if a parser changes |
| `Operation` | id, name, status, priority, geometry — top-level container; assets/incidents/tasks/features hang off it |
| `Feature` | id, operationId, type, geometryType, coordinates, properties, version — **canonical geometry + semantics only**; presentation lives in `FeatureStyle` |
| `TelemetryChannel` | id (e.g. `power.battery`), key, name, unit, dataType, min, max — declared provider metadata |

## Raw journal & replay

`RawEvent` records the original source message **before** normalization
(`RawEvent → parse → normalize → domain`). Because it is retained, a parser fix
can be re-applied to historical data (`POST /api/raw-events/reprocess` is the
seam). In production this is a partitioned/retention-managed table, not the MVP's
bounded in-memory ring.

## Canonical vs presentation

`Feature` never stores `iconSize`, `screenX`, `zoom`, or `selected`. Rendering
attributes live in `FeatureStyle` (or are computed in the client), so the same
canonical feature can be styled per-viewer without mutating shared data.

## Link freshness (§21)

`Asset.link` is derived from `lastSeen`: `live` (<5 s), `delayed` (<20 s),
`offline` (older). The UI colors assets and shows the state explicitly; `unknown`
means no telemetry has ever been received.

## Telemetry retention

MVP keeps a bounded ring buffer (~600 samples/asset) in memory for history &
replay. In production this becomes a TimescaleDB hypertable with a retention
policy and continuous aggregates for the telemetry charts.
