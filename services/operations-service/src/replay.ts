// Read-only operational replay foundation.
// Reconstructs a historical situational-awareness picture from immutable
// observations. It never replays commands, mutations, or external actions.

import type { Observation } from '@fusion/shared-types';
import type { Store } from './store.js';

export interface ReplayFilter {
  organizationId: string;
  operationId?: string;
  at: number;
  windowMs?: number;
}

export interface ReplayEntityState {
  key: string;
  assetId?: string;
  sourceId: string;
  sensorId?: string;
  occurredAt: number;
  receivedAt: number;
  position?: Observation['position'];
  velocity?: Observation['velocity'];
  heading?: number;
  altitude?: number;
  classification?: string;
  confidence: number;
  quality: Observation['quality'];
  observationId: string;
  rawEventId?: string;
  correlationId?: string;
  evidenceId?: string;
}

export interface ReplayFrame {
  at: number;
  from: number;
  organizationId: string;
  operationId?: string;
  entities: ReplayEntityState[];
  observationCount: number;
}

export function buildReplayFrame(store: Store, filter: ReplayFilter): ReplayFrame {
  const windowMs = Math.max(1_000, Math.min(filter.windowMs ?? 10 * 60_000, 24 * 60 * 60_000));
  const from = filter.at - windowMs;
  const latest = new Map<string, Observation>();
  let observationCount = 0;

  for (const obs of store.observations) {
    if (obs.organizationId !== filter.organizationId) continue;
    if (filter.operationId && obs.operationId !== filter.operationId) continue;
    if (obs.occurredAt < from || obs.occurredAt > filter.at) continue;
    observationCount += 1;
    // Known assets get one state per asset. Anonymous detections remain isolated
    // by source/sensor so unrelated observations are never silently merged.
    const key = obs.assetId ?? `${obs.sourceId}:${obs.sensorId ?? 'source'}:${obs.id}`;
    const current = latest.get(key);
    if (!current || obs.occurredAt > current.occurredAt ||
        (obs.occurredAt === current.occurredAt && obs.receivedAt > current.receivedAt)) {
      latest.set(key, obs);
    }
  }

  const entities = [...latest.entries()]
    .map(([key, obs]): ReplayEntityState => ({
      key,
      assetId: obs.assetId,
      sourceId: obs.sourceId,
      sensorId: obs.sensorId,
      occurredAt: obs.occurredAt,
      receivedAt: obs.receivedAt,
      position: obs.position,
      velocity: obs.velocity,
      heading: obs.heading,
      altitude: obs.altitude,
      classification: obs.classification,
      confidence: obs.confidence,
      quality: obs.quality,
      observationId: obs.id,
      rawEventId: obs.rawEventId,
      correlationId: obs.correlationId,
      evidenceId: typeof obs.metadata?.evidenceId === 'string' ? obs.metadata.evidenceId : undefined,
    }))
    .sort((a, b) => b.occurredAt - a.occurredAt);

  return {
    at: filter.at,
    from,
    organizationId: filter.organizationId,
    operationId: filter.operationId,
    entities,
    observationCount,
  };
}
