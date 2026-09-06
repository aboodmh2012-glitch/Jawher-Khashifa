// Realtime event contracts. One typed envelope travels the internal bus AND the
// browser WebSocket, so backend and frontend never disagree on shape.
//
// Envelope V2 (production-grade): carries provenance + correlation for the whole
// pipeline (raw → normalize → domain). It stays backward-compatible: `topic` is
// kept as an alias of `type` (and remains the discriminant), and `ts` as an alias
// of `occurredAt`, so every existing consumer (`switch (msg.topic)`, `msg.ts`)
// keeps working unchanged.

import type {
  Asset, Alert, Incident, OperationalTask, OpsEvent,
  NormalizedTelemetry, Feature,
} from '@fusion/shared-types';

/** Canonical topic/type names used on the bus and WS. */
export const Topics = {
  AssetPosition: 'asset.position',
  AssetTelemetry: 'asset.telemetry',
  AssetHealth: 'asset.health',
  AssetConnected: 'asset.connected',
  AssetDisconnected: 'asset.disconnected',
  IncidentCreated: 'incident.created',
  IncidentUpdated: 'incident.updated',
  TaskCreated: 'task.created',
  TaskUpdated: 'task.updated',
  AlertCreated: 'alert.created',
  AlertAcknowledged: 'alert.acknowledged',
  FeatureCreated: 'feature.created',
  FeatureUpdated: 'feature.updated',
  FeatureDeleted: 'feature.deleted',
  MediaAvailable: 'media.available',
  Event: 'event',
} as const;

export type Topic = (typeof Topics)[keyof typeof Topics];

/** Production event envelope. `T` is the event type (discriminant). */
export interface EventEnvelope<T extends string, P> {
  eventId: string;          // globally unique id for THIS event
  type: T;                  // canonical event type
  topic: T;                 // legacy alias == type (kept as discriminant)
  schemaVersion: number;    // payload schema version

  source: string;           // adapter/service that produced it

  occurredAt: number;       // when the thing happened at the source
  receivedAt: number;       // when the platform observed it
  ts: number;               // legacy alias == occurredAt

  correlationId: string;    // follows a message through the whole pipeline
  causationId?: string;     // the event/raw id that caused this one
  organizationId?: string;
  operationId?: string;
  assetId?: string;
  deviceId?: string;
  sequence?: number;        // per-source ordering, optional
  traceId?: string;         // distributed trace correlation

  payload: P;
}

/** Optional metadata supplied when constructing an envelope. */
export interface EventMeta {
  source?: string;
  correlationId?: string;
  causationId?: string;
  organizationId?: string;
  operationId?: string;
  assetId?: string;
  deviceId?: string;
  sequence?: number;
  traceId?: string;
  occurredAt?: number;
  schemaVersion?: number;
}

export type AssetPositionMsg = EventEnvelope<'asset.position', {
  assetId: string; lat: number; lon: number; altitude?: number; heading?: number; groundSpeed?: number;
}>;
export type AssetTelemetryMsg = EventEnvelope<'asset.telemetry', NormalizedTelemetry>;
export type AssetHealthMsg = EventEnvelope<'asset.health', { assetId: string; health: Asset['health'] }>;
export type AssetConnectedMsg = EventEnvelope<'asset.connected', { asset: Asset }>;
export type AssetDisconnectedMsg = EventEnvelope<'asset.disconnected', { assetId: string }>;
export type IncidentCreatedMsg = EventEnvelope<'incident.created', Incident>;
export type IncidentUpdatedMsg = EventEnvelope<'incident.updated', Incident>;
export type TaskCreatedMsg = EventEnvelope<'task.created', OperationalTask>;
export type TaskUpdatedMsg = EventEnvelope<'task.updated', OperationalTask>;
export type AlertCreatedMsg = EventEnvelope<'alert.created', Alert>;
export type AlertAcknowledgedMsg = EventEnvelope<'alert.acknowledged', Alert>;
export type FeatureCreatedMsg = EventEnvelope<'feature.created', Feature>;
export type FeatureUpdatedMsg = EventEnvelope<'feature.updated', Feature>;
export type FeatureDeletedMsg = EventEnvelope<'feature.deleted', { id: string; operationId: string }>;
export type EventMsg = EventEnvelope<'event', OpsEvent>;

/** A snapshot sent to a client immediately on connect, so the COP hydrates. */
export interface SnapshotMsg {
  topic: 'snapshot';
  ts: number;
  payload: { assets: Asset[]; alerts: Alert[]; incidents: Incident[]; events: OpsEvent[]; features: Feature[] };
}

export type ServerMessage =
  | AssetPositionMsg | AssetTelemetryMsg | AssetHealthMsg
  | AssetConnectedMsg | AssetDisconnectedMsg
  | IncidentCreatedMsg | IncidentUpdatedMsg
  | TaskCreatedMsg | TaskUpdatedMsg
  | AlertCreatedMsg | AlertAcknowledgedMsg
  | FeatureCreatedMsg | FeatureUpdatedMsg | FeatureDeletedMsg
  | EventMsg | SnapshotMsg;

/** Works in Node 20+ and browsers without importing node:crypto (keeps the
 *  frontend bundle clean). */
export function newId(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  return g.crypto?.randomUUID ? g.crypto.randomUUID() : `id-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

/** Build a V2 envelope. Back-compatible: callers may still pass only (type, payload). */
export function envelope<T extends Topic, P>(type: T, payload: P, meta: EventMeta = {}): EventEnvelope<T, P> {
  const now = Date.now();
  const occurredAt = meta.occurredAt ?? now;
  return {
    eventId: newId(),
    type,
    topic: type,
    schemaVersion: meta.schemaVersion ?? 1,
    source: meta.source ?? 'core',
    occurredAt,
    receivedAt: now,
    ts: occurredAt,
    correlationId: meta.correlationId ?? newId(),
    causationId: meta.causationId,
    organizationId: meta.organizationId,
    operationId: meta.operationId,
    assetId: meta.assetId,
    deviceId: meta.deviceId,
    sequence: meta.sequence,
    traceId: meta.traceId,
    payload,
  };
}
