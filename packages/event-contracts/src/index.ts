// Realtime event contracts (§17). One typed envelope travels the internal bus
// AND the browser WebSocket, so backend and frontend never disagree on shape.

import type {
  Asset, Alert, Incident, OperationalTask, OpsEvent,
  NormalizedTelemetry, Feature,
} from '@fusion/shared-types';

/** Canonical topic names used on the bus and WS. */
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

interface Envelope<T extends Topic, P> {
  topic: T;
  ts: number;
  payload: P;
}

export type AssetPositionMsg = Envelope<'asset.position', {
  assetId: string; lat: number; lon: number; altitude?: number; heading?: number; groundSpeed?: number;
}>;
export type AssetTelemetryMsg = Envelope<'asset.telemetry', NormalizedTelemetry>;
export type AssetHealthMsg = Envelope<'asset.health', { assetId: string; health: Asset['health'] }>;
export type AssetConnectedMsg = Envelope<'asset.connected', { asset: Asset }>;
export type AssetDisconnectedMsg = Envelope<'asset.disconnected', { assetId: string }>;
export type IncidentCreatedMsg = Envelope<'incident.created', Incident>;
export type IncidentUpdatedMsg = Envelope<'incident.updated', Incident>;
export type TaskCreatedMsg = Envelope<'task.created', OperationalTask>;
export type TaskUpdatedMsg = Envelope<'task.updated', OperationalTask>;
export type AlertCreatedMsg = Envelope<'alert.created', Alert>;
export type AlertAcknowledgedMsg = Envelope<'alert.acknowledged', Alert>;
export type FeatureCreatedMsg = Envelope<'feature.created', Feature>;
export type FeatureUpdatedMsg = Envelope<'feature.updated', Feature>;
export type FeatureDeletedMsg = Envelope<'feature.deleted', { id: string; operationId: string }>;
export type EventMsg = Envelope<'event', OpsEvent>;

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

export function envelope<T extends Topic, P>(topic: T, payload: P): Envelope<T, P> {
  return { topic, ts: Date.now(), payload };
}
