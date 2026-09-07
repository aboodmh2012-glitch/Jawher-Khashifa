// Evidence-aware Observation pipeline.
// Converts validated normalized telemetry into immutable observations while
// preserving provenance back to RawEvent and the central IntelligenceCore.
// SAFETY: situational awareness, data quality, and operational analysis only.

import { randomUUID } from 'node:crypto';
import type { NormalizedTelemetry, Observation } from '@fusion/shared-types';
import type { FusionService } from './fusion.js';
import type { Store } from './store.js';
import type { IntelligenceCore } from './intelligence-core.js';

export interface ObservationProvenance {
  rawEventId?: string;
  correlationId?: string;
  sourceProtocol?: string;
  sourceMessageType?: string;
  receivedAt?: number;
  parserVersion?: string;
}

export class ObservationPipeline {
  constructor(
    private store: Store,
    private fusion: FusionService,
    private intelligence: IntelligenceCore,
  ) {}

  ingestTelemetry(
    telemetry: NormalizedTelemetry,
    organizationId: string,
    provenance?: ObservationProvenance,
    operationId?: string,
  ): Observation {
    const now = Date.now();
    const sourceId = provenance?.sourceProtocol ?? 'core';
    const sensorId = provenance?.sourceMessageType;
    const confidence = telemetry.linkQuality != null
      ? Math.max(0.3, Math.min(1, telemetry.linkQuality / 100))
      : 0.6;
    const freshnessMs = Math.max(0, now - telemetry.timestamp);
    const qualityState = freshnessMs < 5000 ? 'good' : freshnessMs < 15000 ? 'degraded' : 'stale';
    const quality = {
      confidence,
      freshnessMs,
      state: qualityState as 'good' | 'degraded' | 'stale',
      lastUpdated: now,
      sourceCount: 1,
    };

    const sensor = this.intelligence.observeSensor({
      organizationId,
      operationId,
      sourceId,
      sensorId,
      assetId: telemetry.assetId,
      kind: 'telemetry',
      at: telemetry.timestamp,
      capabilities: ['position', 'telemetry'],
      metadata: { sourceMessageType: provenance?.sourceMessageType },
    });

    const evidence = this.intelligence.recordEvidence({
      organizationId,
      operationId,
      kind: 'telemetry',
      sourceId,
      sensorId: sensor.id,
      assetId: telemetry.assetId,
      rawEventId: provenance?.rawEventId,
      correlationId: provenance?.correlationId,
      occurredAt: telemetry.timestamp,
      receivedAt: provenance?.receivedAt ?? now,
      confidence,
      quality,
      metadata: {
        parserVersion: provenance?.parserVersion,
        sourceMessageType: provenance?.sourceMessageType,
      },
    });

    const obs: Observation = {
      id: randomUUID(),
      organizationId,
      operationId,
      sourceId,
      sensorId: sensor.id,
      assetId: telemetry.assetId,
      occurredAt: telemetry.timestamp,
      receivedAt: provenance?.receivedAt ?? now,
      position: telemetry.position,
      velocity: (telemetry.groundSpeed != null || telemetry.heading != null)
        ? { speed: telemetry.groundSpeed ?? 0, heading: telemetry.heading }
        : undefined,
      heading: telemetry.heading,
      altitude: telemetry.position.altitude,
      confidence,
      quality,
      rawEventId: provenance?.rawEventId,
      correlationId: provenance?.correlationId,
      metadata: {
        evidenceId: evidence.id,
        parserVersion: provenance?.parserVersion,
        sourceMessageType: provenance?.sourceMessageType,
      },
    };

    this.intelligence.bindEvidenceToObservation(evidence.id, obs.id);
    this.store.observations.push(obs);
    if (this.store.observations.length > 2000) this.store.observations.shift();

    const track = this.fusion.ingest(obs);
    if (track) this.intelligence.recordTrackSnapshot(track, now);
    return obs;
  }
}
