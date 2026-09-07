-- Database V2 — migration 0002: durable RawEvent journal + current state +
-- operations. RawEvent payloads are IMMUTABLE; only processing_status advances.

-- ── durable, append-only raw event journal ─────────────────────────────────
DO $$ BEGIN
  CREATE TYPE raw_event_status AS ENUM
    ('received', 'validated', 'normalized', 'quarantined', 'failed', 'reprocessed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS raw_events (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id   UUID REFERENCES organizations(id),
  operation_id      UUID,
  asset_id          TEXT,
  device_id         TEXT,
  agent_id          UUID,
  adapter_id        TEXT,
  adapter_version   TEXT,
  protocol          TEXT NOT NULL,
  message_type      TEXT NOT NULL,
  payload           JSONB,               -- original message, immutable
  payload_text      TEXT,                -- for xml/text payloads
  payload_format    TEXT NOT NULL,
  source_timestamp  TIMESTAMPTZ,
  received_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  parser_version    TEXT NOT NULL,
  schema_version    INT,
  correlation_id    UUID NOT NULL,
  deduplication_key TEXT,
  checksum          TEXT,
  processing_status raw_event_status NOT NULL DEFAULT 'received',
  metadata          JSONB DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS raw_events_corr_idx    ON raw_events (correlation_id);
CREATE INDEX IF NOT EXISTS raw_events_asset_idx   ON raw_events (asset_id, received_at DESC);
CREATE INDEX IF NOT EXISTS raw_events_status_idx  ON raw_events (processing_status);
CREATE UNIQUE INDEX IF NOT EXISTS raw_events_dedup_uk ON raw_events (deduplication_key) WHERE deduplication_key IS NOT NULL;
-- raw payloads must never be updated
CREATE OR REPLACE FUNCTION raw_events_no_payload_mutation() RETURNS trigger AS $$
BEGIN
  IF NEW.payload IS DISTINCT FROM OLD.payload OR NEW.payload_text IS DISTINCT FROM OLD.payload_text THEN
    RAISE EXCEPTION 'raw_events payload is immutable';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS raw_events_immutable ON raw_events;
CREATE TRIGGER raw_events_immutable BEFORE UPDATE ON raw_events
  FOR EACH ROW EXECUTE FUNCTION raw_events_no_payload_mutation();

-- ── operations (temporary operational container) ───────────────────────────
CREATE TABLE IF NOT EXISTS operations (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  name            TEXT NOT NULL,
  description     TEXT,
  status          TEXT NOT NULL DEFAULT 'active',
  priority        TEXT,
  geom            GEOGRAPHY(Polygon, 4326),
  created_by      TEXT,
  starts_at       TIMESTAMPTZ,
  ends_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Asset ASSIGNED_TO Operation (temporary), distinct from home ownership.
CREATE TABLE IF NOT EXISTS operation_assignments (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  operation_id UUID NOT NULL REFERENCES operations(id),
  asset_id     TEXT NOT NULL REFERENCES assets(id),
  assigned_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  released_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS operation_assignments_op_idx ON operation_assignments (operation_id) WHERE released_at IS NULL;

-- ── hot current state (map reads here, not from history) ────────────────────
CREATE TABLE IF NOT EXISTS current_asset_state (
  asset_id         TEXT PRIMARY KEY REFERENCES assets(id),
  organization_id  UUID NOT NULL REFERENCES organizations(id),
  geom             GEOGRAPHY(Point, 4326),
  altitude         DOUBLE PRECISION,
  heading          DOUBLE PRECISION,
  speed            DOUBLE PRECISION,
  battery          DOUBLE PRECISION,
  link             TEXT,
  health           TEXT,
  last_position_at TIMESTAMPTZ,
  last_telemetry_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS current_asset_state_geom_idx ON current_asset_state USING GIST (geom);
