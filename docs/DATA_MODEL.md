# Data model

Canonical TypeScript definitions: `packages/shared-types`. SQL schema (Phase 1+):
`infrastructure/database/init.sql`. Telemetry & positions are time-series and
belong in TimescaleDB hypertables; everything else in PostgreSQL/PostGIS.

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

## Link freshness (§21)

`Asset.link` is derived from `lastSeen`: `live` (<5 s), `delayed` (<20 s),
`offline` (older). The UI colors assets and shows the state explicitly; `unknown`
means no telemetry has ever been received.

## Telemetry retention

MVP keeps a bounded ring buffer (~600 samples/asset) in memory for history &
replay. In production this becomes a TimescaleDB hypertable with a retention
policy and continuous aggregates for the telemetry charts.
