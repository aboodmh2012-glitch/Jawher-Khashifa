-- Fusion Operations Platform — schema bootstrap (§16). Phase 1+.
-- PostGIS for spatial, plain tables here; telemetry/positions live in TimescaleDB
-- as hypertables (see timescale/init.sql notes in DEPLOYMENT.md).

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS organizations (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id      UUID NOT NULL REFERENCES organizations(id),
  username    TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  role        TEXT NOT NULL,
  email       TEXT
);

CREATE TABLE IF NOT EXISTS teams (
  id      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id  UUID NOT NULL REFERENCES organizations(id),
  name    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS devices (
  id       TEXT PRIMARY KEY,
  org_id   UUID NOT NULL REFERENCES organizations(id),
  kind     TEXT NOT NULL,
  metadata JSONB DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS assets (
  id         TEXT PRIMARY KEY,
  org_id     UUID NOT NULL REFERENCES organizations(id),
  name       TEXT NOT NULL,
  type       TEXT NOT NULL,
  device_id  TEXT REFERENCES devices(id),
  tags       TEXT[] DEFAULT '{}',
  geom       GEOGRAPHY(Point, 4326)
);
CREATE INDEX IF NOT EXISTS assets_geom_idx ON assets USING GIST (geom);

CREATE TABLE IF NOT EXISTS incidents (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id        UUID NOT NULL REFERENCES organizations(id),
  title         TEXT NOT NULL,
  type          TEXT NOT NULL,
  severity      TEXT NOT NULL,
  status        TEXT NOT NULL,
  geom          GEOGRAPHY(Point, 4326),
  description   TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tasks (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id        UUID NOT NULL REFERENCES organizations(id),
  name          TEXT NOT NULL,
  type          TEXT NOT NULL,
  priority      TEXT NOT NULL,
  status        TEXT NOT NULL,
  assigned_asset TEXT REFERENCES assets(id),
  geom          GEOGRAPHY(Point, 4326)
);

CREATE TABLE IF NOT EXISTS alerts (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id      UUID NOT NULL REFERENCES organizations(id),
  kind        TEXT NOT NULL,
  severity    TEXT NOT NULL,
  status      TEXT NOT NULL,
  source      TEXT NOT NULL,
  message     TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS geofences (
  id      TEXT PRIMARY KEY,
  org_id  UUID NOT NULL REFERENCES organizations(id),
  name    TEXT NOT NULL,
  kind    TEXT NOT NULL,
  geom    GEOGRAPHY(Polygon, 4326)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id      UUID NOT NULL REFERENCES organizations(id),
  user_id     TEXT NOT NULL,
  action      TEXT NOT NULL,
  resource    TEXT NOT NULL,
  at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  ip          TEXT,
  previous    JSONB,
  next        JSONB
);
CREATE INDEX IF NOT EXISTS audit_at_idx ON audit_logs (at DESC);
