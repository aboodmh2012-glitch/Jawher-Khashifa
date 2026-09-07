import type { DataQuality, Track } from './entities.js';

export type SensorKind = 'telemetry' | 'position' | 'camera' | 'thermal' | 'radar' | 'environmental' | 'report' | 'other';

export interface SensorRecord {
  id: string;
  organizationId: string;
  operationId?: string;
  assetId?: string;
  deviceId?: string;
  sourceId: string;
  kind: SensorKind;
  name: string;
  status: 'online' | 'offline' | 'degraded' | 'unknown';
  capabilities: string[];
  firstSeenAt: number;
  lastSeenAt: number;
  metadata?: Record<string, unknown>;
}

export interface EvidenceRecord {
  id: string;
  organizationId: string;
  operationId?: string;
  kind: 'telemetry' | 'sensor' | 'report' | 'media' | 'external';
  sourceId: string;
  sensorId?: string;
  assetId?: string;
  rawEventId?: string;
  correlationId?: string;
  observationId?: string;
  occurredAt: number;
  receivedAt: number;
  confidence: number;
  quality: DataQuality;
  metadata?: Record<string, unknown>;
}

export interface TrackSnapshot {
  id: string;
  trackId: string;
  organizationId: string;
  operationId?: string;
  capturedAt: number;
  state: Track['state'];
  position: Track['position'];
  velocity?: Track['velocity'];
  heading?: number;
  altitude?: number;
  classification: string;
  identity?: string;
  confidence: number;
  quality: DataQuality;
  sourceIds: string[];
  observationIds: string[];
}

export interface IntelligenceBrief {
  generatedAt: number;
  organizationId: string;
  operationId?: string;
  summary: string;
  counts: {
    assets: number;
    tracks: number;
    incidents: number;
    openAlerts: number;
    sensors: number;
    observations: number;
    staleObservations: number;
  };
  dataQuality: {
    good: number;
    degraded: number;
    stale: number;
    unknown: number;
    averageConfidence: number;
  };
  notable: Array<{
    kind: 'incident' | 'alert' | 'track' | 'sensor' | 'quality';
    severity: 'info' | 'warning' | 'critical';
    title: string;
    detail: string;
    refId?: string;
  }>;
  evidenceIds: string[];
}
