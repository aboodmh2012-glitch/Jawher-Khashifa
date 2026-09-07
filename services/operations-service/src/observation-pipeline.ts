// Evidence-aware Observation pipeline.
// Converts validated normalized telemetry into immutable observations while
// preserving provenance back to the raw journal. This service is deliberately
// independent of adapter/vendor details and remains limited to situational
// awareness, data quality, and operational analysis.

import { randomUUID } from 'node:crypto';
import type { NormalizedTelemetry, Observation } from '@fusion/shared-types';
import type { FusionService } from './fusion.js';
import type { Store } from './store.js';

export interface ObservationProvenance {
  rawEventId?: string;
  correlationId?: string;
  sourceProtocol?: string;
  sourceMessageType?: string;
  receivedAt?: number;
  parserVersion?: string;
}

export interface EvidenceRef {
  id: string;
  kind: 'telemetry' | 'sensor' | 'report' | 'media' | 'external';
  sourceId: string;
  sensorId?: string;
  rawEventId?: string;
  correlationId?: string;
  occurredAt: number;
  receivedAt: number;
  confidence: number;
}

/**
 * Bounded evidence index used for provenance drill-down in the current
 * in-memory runtime. Durable deployments should persist this behind a
 * repository implementation rather than increasing this bound.
 */
export class ObservationPipeline {
  private evidence = new Map<string, EvidenceRef>();
  private readonly evidenceOrder: string[] = [];
  private readonly evidenceCap = 4000;

  constructor(private store: Store, private fusion: FusionService) {}

  ingestTelemetry(
    telemetry: NormalizedTelemetry,
    organizationId: string,
    provenance?: ObservationProvenance,
    operationId?: string,
  ): Observation {
    const now = Date.now();
    const sourceId = provenance?.sourceProtocol ?? 'core';
    const confidence = telemetry.linkQuality != null
      ? Math.max(0.3, Math.min(1, telemetry.linkQuality / 100))
      : 0.6;

    const evidence: EvidenceRef = {
      id: randomUUID(),
      kind: 'telemetry',
      sourceId,
      sensorId: provenance?.sourceMessageType,
      rawEventId: provenance?.rawEventId,
      correlationId: provenance?.correlationId,
      occurredAt: telemetry.timestamp,
      receivedAt: provenance?.receivedAt ?? now,
      confidence,
    };
    this.rememberEvidence(evidence);

    const freshnessMs = Math.max(0, now - telemetry.timestamp);
    const qualityState = freshnessMs < 5000 ? 'good' : freshnessMs < 15000 ? 'degraded' : 'stale';
    const obs: Observation = {
      id: randomUUID(),
      organizationId,
      operationId,
      sourceId,
      sensorId: provenance?.sourceMessageType,
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
      quality: {
        confidence,
        freshnessMs,
        state: qualityState,
        lastUpdated: now,
        sourceCount: 1,
      },
      rawEventId: provenance?.rawEventId,
      correlationId: provenance?.correlationId,
      metadata: {
        evidenceId: evidence.id,
        parserVersion: provenance?.parserVersion,
        sourceMessageType: provenance?.sourceMessageType,
      },
    };

    this.store.observations.push(obs);
    if (this.store.observations.length > 2000) this.store.observations.shift();
    this.fusion.ingest(obs);
    return obs;
  }

  getEvidence(id: string): EvidenceRef | undefined {
    return this.evidence.get(id);
  }

  evidenceForObservation(obs: Observation): EvidenceRef | undefined {
    const id = typeof obs.metadata?.evidenceId === 'string' ? obs.metadata.evidenceId : undefined;
    return id ? this.evidence.get(id) : undefined;
  }

  recentEvidence(limit = 100): EvidenceRef[] {
    const n = Math.max(1, Math.min(limit, 500));
    return this.evidenceOrder.slice(-n).reverse()
      .map((id) => this.evidence.get(id))
      .filter((x): x is EvidenceRef => !!x);
  }

  private rememberEvidence(evidence: EvidenceRef): void {
    this.evidence.set(evidence.id, evidence);
    this.evidenceOrder.push(evidence.id);
    while (this.evidenceOrder.length > this.evidenceCap) {
      const oldest = this.evidenceOrder.shift();
      if (oldest) this.evidence.delete(oldest);
    }
  }
}
