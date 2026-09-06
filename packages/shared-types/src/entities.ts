// Domain entities (§16). Kept transport-agnostic so REST, WebSocket and the
// (future) database layer all share one definition.

import type {
  AssetType, LinkState, HealthState,
  IncidentStatus, IncidentSeverity,
  TaskStatus, TaskType, TaskPriority,
  AlertKind, AlertSeverity, AlertStatus,
  Role,
} from './enums.js';
import type { GeoPoint, NormalizedTelemetry } from './telemetry.js';

export interface Organization {
  id: string;
  name: string;
  createdAt: number;
}

export interface User {
  id: string;
  orgId: string;
  username: string;
  displayName: string;
  role: Role;
  email?: string;
}

export interface Team {
  id: string;
  orgId: string;
  name: string;
  memberIds: string[];
}

export interface Asset {
  id: string;
  orgId: string;
  name: string;
  type: AssetType;
  /** live | delayed | offline | unknown — freshness, not a hardware flag. */
  link: LinkState;
  health: HealthState;
  deviceId?: string;
  position?: GeoPoint;
  heading?: number;
  /** epoch ms of last telemetry received. */
  lastSeen?: number;
  /** most recent normalized telemetry snapshot (denormalized for the UI). */
  latest?: NormalizedTelemetry;
  activeTaskId?: string;
  tags?: string[];
}

export interface TelemetrySample extends NormalizedTelemetry {
  id: string;
}

export interface Incident {
  id: string;
  orgId: string;
  title: string;
  type: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  location?: GeoPoint;
  description?: string;
  createdAt: number;
  updatedAt: number;
  assignedTeamId?: string;
  assignedAssetIds: string[];
  timeline: TimelineEntry[];
  attachmentIds: string[];
}

export interface TimelineEntry {
  at: number;
  actor?: string;
  kind: string;
  message: string;
}

export interface OperationalTask {
  id: string;
  orgId: string;
  name: string;
  type: TaskType;
  description?: string;
  priority: TaskPriority;
  status: TaskStatus;
  assignedAssetId?: string;
  assignedTeamId?: string;
  location?: GeoPoint;
  routeId?: string;
  startTime?: number;
  deadline?: number;
  notes?: string;
  attachmentIds: string[];
}

export interface Alert {
  id: string;
  orgId: string;
  kind: AlertKind;
  severity: AlertSeverity;
  status: AlertStatus;
  source: string;          // assetId or subsystem
  sourceName?: string;
  message: string;
  createdAt: number;
  acknowledgedBy?: string;
  acknowledgedAt?: number;
  resolutionNotes?: string;
}

export interface OpsEvent {
  id: string;
  orgId: string;
  at: number;
  topic: string;           // e.g. asset.connected, incident.created
  source?: string;
  message: string;
  severity?: AlertSeverity;
}

export interface Geofence {
  id: string;
  orgId: string;
  name: string;
  kind: 'zone' | 'no-fly' | 'area-of-interest';
  /** GeoJSON Polygon coordinates (lon,lat rings). */
  polygon: number[][][];
  color?: string;
}

export interface RouteEntity {
  id: string;
  orgId: string;
  name: string;
  /** ordered [lon,lat] waypoints. */
  waypoints: number[][];
}

export interface AuditLog {
  id: string;
  orgId: string;
  userId: string;
  action: string;
  resource: string;
  at: number;
  ip?: string;
  session?: string;
  previousValue?: unknown;
  newValue?: unknown;
}

export interface AuthSession {
  token: string;
  user: User;
  expiresAt: number;
}

// ── Final-architecture additions ────────────────────────────────────────────

/**
 * Raw, unparsed source message — kept verbatim beside the derived data so the
 * pipeline is replayable if a parser changes (RawEvent → normalize → domain).
 * Never deleted after parsing.
 */
export interface RawEvent {
  id: string;
  deviceId?: string;
  assetId?: string;
  protocol: string;          // MAVLINK | COT | GPS | SIM | ...
  messageType: string;       // GLOBAL_POSITION_INT | event | ...
  payload: unknown;          // original message (object or string)
  payloadFormat: 'json' | 'xml' | 'text' | 'binary-base64';
  sourceTimestamp?: number;
  receivedAt: number;
  parserVersion: string;
  correlationId: string;
}

/** Top-level container for a piece of work. Assets/incidents/tasks/features hang off it. */
export interface Operation {
  id: string;
  organizationId: string;
  name: string;
  description?: string;
  status: 'draft' | 'active' | 'paused' | 'closed' | 'archived';
  priority?: 'low' | 'normal' | 'high' | 'urgent';
  startsAt?: number;
  endsAt?: number;
  /** GeoJSON polygon rings (area of operation), optional. */
  geometry?: number[][][];
  createdBy?: string;
  createdAt: number;
}

export type FeatureGeometryType =
  | 'Point' | 'LineString' | 'Polygon' | 'MultiPoint' | 'MultiLineString' | 'MultiPolygon';

/** A map annotation — canonical geometry + semantic properties ONLY.
 *  Presentation (icon/zoom/selection) lives separately (see FeatureStyle). */
export interface Feature {
  id: string;
  operationId: string;
  orgId: string;
  type: string;              // marker | route | zone | line | ...
  geometryType: FeatureGeometryType;
  coordinates: unknown;      // GeoJSON coordinates for geometryType
  properties: Record<string, unknown>;
  source: string;            // user | adapter:<kind> | import
  createdBy?: string;
  version: number;
  createdAt: number;
  updatedAt: number;
}

/** Presentation, kept out of the canonical Feature (§ "Presentation منفصلة"). */
export interface FeatureStyle {
  featureId: string;
  icon?: string;
  fill?: string;
  stroke?: string;
  opacity?: number;
  minZoom?: number;
  maxZoom?: number;
}

export interface Group {
  id: string;
  organizationId: string;
  name: string;
  description?: string;
  memberIds: string[];
}

/** An Observation — something reported by ONE source at ONE time. Immutable.
 *  Not an Asset, not a Track. The fusion service consumes these. (Phase B fills
 *  the producing pipeline; the type exists now so repositories can be typed.) */
export interface Observation {
  id: string;
  organizationId: string;
  operationId?: string;
  sourceId: string;
  sensorId?: string;
  assetId?: string;
  occurredAt: number;        // when the source observed it
  receivedAt: number;        // when the platform ingested it
  position?: { lat: number; lon: number; altitude?: number };
  velocity?: { speed: number; heading?: number };
  heading?: number;
  altitude?: number;
  classification?: string;
  identity?: string;
  confidence: number;        // 0..1
  quality: DataQuality;
  rawEventId?: string;
  correlationId?: string;
  metadata?: Record<string, unknown>;
}

export type TrackState = 'tentative' | 'confirmed' | 'coasting' | 'lost' | 'archived';

/** A Track — the platform's fused understanding of an observed entity, for
 *  situational awareness (NOT targeting). Phase B implements the fusion service. */
export interface Track {
  id: string;
  organizationId: string;
  operationId?: string;
  state: TrackState;
  position: { lat: number; lon: number; altitude?: number };
  velocity?: { speed: number; heading?: number };
  heading?: number;
  altitude?: number;
  classification: string;
  identity?: string;
  confidence: number;        // 0..1
  quality: DataQuality;
  firstSeenAt: number;
  lastSeenAt: number;
  sourceCount: number;
  observationIds: string[];
  metadata?: Record<string, unknown>;
}

/** Explicit data-quality metadata — never present uncertain data as certain. */
export interface DataQuality {
  confidence: number;        // 0..1
  freshnessMs?: number;
  accuracy?: number;
  sourceCount?: number;
  lastUpdated?: number;
  state: 'good' | 'degraded' | 'stale' | 'unknown';
}

/** Declared telemetry channel (Open-MCT-style provider metadata). */
export interface TelemetryChannel {
  id: string;               // e.g. power.battery
  assetType?: AssetType;
  key: string;
  name: string;
  unit?: string;
  dataType: 'number' | 'enum' | 'string';
  min?: number;
  max?: number;
}
