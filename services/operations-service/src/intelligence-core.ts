// Deterministic, read-mostly intelligence foundation for situational awareness.
// No external LLM is required: this layer indexes sensors/evidence, snapshots
// fused tracks, and produces evidence-linked operational/data-quality briefs.
// SAFETY: no targeting, engagement, weapon selection, or autonomous action.

import { randomUUID } from 'node:crypto';
import type {
  EvidenceRecord, IntelligenceBrief, Observation, SensorKind, SensorRecord, Track, TrackSnapshot,
} from '@fusion/shared-types';
import type { Store } from './store.js';

const EVIDENCE_CAP = 5000;
const SNAPSHOT_CAP = 10000;

function sensorKey(orgId: string, operationId: string | undefined, sourceId: string, sensorId?: string): string {
  return `${orgId}:${operationId ?? '-'}:${sourceId}:${sensorId ?? 'source'}`;
}

export class IntelligenceCore {
  private sensors = new Map<string, SensorRecord>();
  private evidence = new Map<string, EvidenceRecord>();
  private evidenceOrder: string[] = [];
  private trackSnapshots: TrackSnapshot[] = [];

  constructor(private store: Store) {}

  observeSensor(input: {
    organizationId: string;
    operationId?: string;
    sourceId: string;
    sensorId?: string;
    assetId?: string;
    deviceId?: string;
    kind?: SensorKind;
    at: number;
    capabilities?: string[];
    metadata?: Record<string, unknown>;
  }): SensorRecord {
    const key = sensorKey(input.organizationId, input.operationId, input.sourceId, input.sensorId);
    const existing = this.sensors.get(key);
    if (existing) {
      existing.lastSeenAt = Math.max(existing.lastSeenAt, input.at);
      existing.status = 'online';
      if (input.assetId) existing.assetId = input.assetId;
      if (input.deviceId) existing.deviceId = input.deviceId;
      if (input.capabilities?.length) existing.capabilities = [...new Set([...existing.capabilities, ...input.capabilities])];
      return existing;
    }
    const sensor: SensorRecord = {
      id: input.sensorId ?? randomUUID(),
      organizationId: input.organizationId,
      operationId: input.operationId,
      assetId: input.assetId,
      deviceId: input.deviceId,
      sourceId: input.sourceId,
      kind: input.kind ?? 'telemetry',
      name: input.sensorId ? `${input.sourceId}:${input.sensorId}` : input.sourceId,
      status: 'online',
      capabilities: input.capabilities ?? [],
      firstSeenAt: input.at,
      lastSeenAt: input.at,
      metadata: input.metadata,
    };
    this.sensors.set(key, sensor);
    return sensor;
  }

  recordEvidence(record: Omit<EvidenceRecord, 'id'> & { id?: string }): EvidenceRecord {
    const evidence: EvidenceRecord = { ...record, id: record.id ?? randomUUID() };
    this.evidence.set(evidence.id, evidence);
    this.evidenceOrder.push(evidence.id);
    while (this.evidenceOrder.length > EVIDENCE_CAP) {
      const oldest = this.evidenceOrder.shift();
      if (oldest) this.evidence.delete(oldest);
    }
    return evidence;
  }

  bindEvidenceToObservation(evidenceId: string, observationId: string): void {
    const evidence = this.evidence.get(evidenceId);
    if (evidence) evidence.observationId = observationId;
  }

  evidenceById(id: string): EvidenceRecord | undefined { return this.evidence.get(id); }

  recentEvidence(organizationId: string, operationId?: string, limit = 100): EvidenceRecord[] {
    const n = Math.max(1, Math.min(limit, 500));
    return this.evidenceOrder.slice().reverse()
      .map((id) => this.evidence.get(id))
      .filter((x): x is EvidenceRecord => !!x && x.organizationId === organizationId && (!operationId || x.operationId === operationId))
      .slice(0, n);
  }

  listSensors(organizationId: string, operationId?: string): SensorRecord[] {
    return [...this.sensors.values()]
      .filter((s) => s.organizationId === organizationId && (!operationId || s.operationId === operationId))
      .sort((a, b) => b.lastSeenAt - a.lastSeenAt);
  }

  refreshSensorStates(now = Date.now()): void {
    for (const sensor of this.sensors.values()) {
      const age = Math.max(0, now - sensor.lastSeenAt);
      sensor.status = age < 10_000 ? 'online' : age < 30_000 ? 'degraded' : 'offline';
    }
  }

  recordTrackSnapshot(track: Track, capturedAt = Date.now()): TrackSnapshot {
    const snap: TrackSnapshot = {
      id: randomUUID(),
      trackId: track.id,
      organizationId: track.organizationId,
      operationId: track.operationId,
      capturedAt,
      state: track.state,
      position: { ...track.position },
      velocity: track.velocity ? { ...track.velocity } : undefined,
      heading: track.heading,
      altitude: track.altitude,
      classification: track.classification,
      identity: track.identity,
      confidence: track.confidence,
      quality: { ...track.quality },
      sourceIds: [...(track.sourceIds ?? [])],
      observationIds: [...track.observationIds],
    };
    this.trackSnapshots.push(snap);
    if (this.trackSnapshots.length > SNAPSHOT_CAP) this.trackSnapshots.shift();
    return snap;
  }

  trackHistory(trackId: string, organizationId: string, limit = 200): TrackSnapshot[] {
    const n = Math.max(1, Math.min(limit, 1000));
    return this.trackSnapshots.filter((x) => x.trackId === trackId && x.organizationId === organizationId).slice(-n);
  }

  brief(organizationId: string, operationId?: string): IntelligenceBrief {
    const observations = this.store.observations.filter((o) => o.organizationId === organizationId && (!operationId || o.operationId === operationId));
    const tracks = [...this.store.tracks.values()].filter((t) => t.organizationId === organizationId && (!operationId || t.operationId === operationId));
    const assets = [...this.store.assets.values()].filter((a) => a.orgId === organizationId);
    const incidents = [...this.store.incidents.values()].filter((i) => i.orgId === organizationId && i.status !== 'closed');
    const alerts = [...this.store.alerts.values()].filter((a) => a.orgId === organizationId && a.status !== 'resolved');
    const sensors = this.listSensors(organizationId, operationId);

    const quality = { good: 0, degraded: 0, stale: 0, unknown: 0 };
    let confidenceTotal = 0;
    for (const o of observations) {
      quality[o.quality.state] += 1;
      confidenceTotal += o.confidence;
    }

    const notable: IntelligenceBrief['notable'] = [];
    for (const incident of incidents.filter((i) => i.severity === 'critical' || i.severity === 'major').slice(0, 5)) {
      notable.push({ kind: 'incident', severity: incident.severity === 'critical' ? 'critical' : 'warning', title: incident.title, detail: `${incident.type} · ${incident.status}`, refId: incident.id });
    }
    for (const alert of alerts.filter((a) => a.severity === 'critical' || a.severity === 'warning').slice(0, 5)) {
      notable.push({ kind: 'alert', severity: alert.severity === 'critical' ? 'critical' : 'warning', title: alert.sourceName ?? alert.source, detail: alert.message, refId: alert.id });
    }
    for (const track of tracks.filter((t) => t.quality.state === 'stale' || t.confidence < 0.45).slice(0, 5)) {
      notable.push({ kind: 'quality', severity: 'warning', title: `Low-confidence track ${track.id.slice(0, 8)}`, detail: `confidence=${track.confidence.toFixed(2)} state=${track.state}`, refId: track.id });
    }
    for (const sensor of sensors.filter((s) => s.status !== 'online').slice(0, 5)) {
      notable.push({ kind: 'sensor', severity: sensor.status === 'offline' ? 'critical' : 'warning', title: sensor.name, detail: `sensor ${sensor.status}`, refId: sensor.id });
    }

    const averageConfidence = observations.length ? confidenceTotal / observations.length : 0;
    const recentEvidence = this.recentEvidence(organizationId, operationId, 50);
    const summary = `${assets.length} assets, ${tracks.length} tracks, ${incidents.length} active incidents, ${alerts.length} open alerts; data confidence ${(averageConfidence * 100).toFixed(0)}%.`;

    return {
      generatedAt: Date.now(), organizationId, operationId, summary,
      counts: {
        assets: assets.length,
        tracks: tracks.length,
        incidents: incidents.length,
        openAlerts: alerts.length,
        sensors: sensors.length,
        observations: observations.length,
        staleObservations: quality.stale,
      },
      dataQuality: { ...quality, averageConfidence },
      notable,
      evidenceIds: recentEvidence.map((e) => e.id),
    };
  }
}
