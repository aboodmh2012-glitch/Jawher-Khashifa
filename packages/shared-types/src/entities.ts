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
