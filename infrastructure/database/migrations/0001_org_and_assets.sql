-- Database V2 — migration 0001: organizational hierarchy + Asset↔Device.
-- Forward-only. Builds on infrastructure/database/init.sql (the 0000 baseline).
-- Tenant isolation column (organization_id) on every table; UUID PKs;
-- created_at/updated_at; PostGIS where spatial.

-- ── permanent organizational hierarchy ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS regions (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  name            TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS operations_centers (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  region_id       UUID REFERENCES regions(id),
  name            TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS units (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id      UUID NOT NULL REFERENCES organizations(id),
  operations_center_id UUID REFERENCES operations_centers(id),
  name                 TEXT NOT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- teams already exist in the baseline; attach them to the hierarchy.
ALTER TABLE teams ADD COLUMN IF NOT EXISTS unit_id UUID REFERENCES units(id);

CREATE TABLE IF NOT EXISTS team_memberships (
  id        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  team_id   UUID NOT NULL REFERENCES teams(id),
  user_id   UUID NOT NULL REFERENCES users(id),
  role      TEXT,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  left_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS team_memberships_team_idx ON team_memberships (team_id);
CREATE INDEX IF NOT EXISTS team_memberships_user_idx ON team_memberships (user_id);

-- ── Asset ↔ Device over time (NOT assets.device_id) ─────────────────────────
-- An Asset may have many Devices; a Device may move between Assets over time.
CREATE TABLE IF NOT EXISTS asset_devices (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  asset_id     TEXT NOT NULL REFERENCES assets(id),
  device_id    TEXT NOT NULL REFERENCES devices(id),
  role         TEXT,
  is_primary   BOOLEAN NOT NULL DEFAULT false,
  installed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  removed_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS asset_devices_asset_idx  ON asset_devices (asset_id) WHERE removed_at IS NULL;
CREATE INDEX IF NOT EXISTS asset_devices_device_idx ON asset_devices (device_id) WHERE removed_at IS NULL;
-- a device can be mounted on at most one asset at a time
CREATE UNIQUE INDEX IF NOT EXISTS asset_devices_active_device_uk ON asset_devices (device_id) WHERE removed_at IS NULL;

-- assets.device_id from the baseline is DEPRECATED — asset_devices is authoritative.
COMMENT ON COLUMN assets.device_id IS 'DEPRECATED: use asset_devices (Asset↔Device over time).';

-- ── edge agents (software representative of an asset) ───────────────────────
CREATE TABLE IF NOT EXISTS agents (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id   UUID NOT NULL REFERENCES organizations(id),
  asset_id          TEXT NOT NULL REFERENCES assets(id),
  operation_id      UUID,
  device_ids        TEXT[] DEFAULT '{}',
  capabilities      TEXT[] DEFAULT '{}',
  connection_status TEXT NOT NULL DEFAULT 'unknown',
  permissions       TEXT[] DEFAULT '{}',
  last_seen_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS agents_asset_idx ON agents (asset_id);
