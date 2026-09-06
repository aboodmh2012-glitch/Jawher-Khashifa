// Repository interfaces — the seam that lets business logic depend on storage
// CONTRACTS, not on a concrete store or DB client. The MVP ships memory-backed
// implementations; production swaps in PostgreSQL/PostGIS + TimescaleDB + object
// storage behind these same interfaces (no business-logic change).
//
// State vs history is separated on purpose: CurrentStateRepository is a hot,
// point-read store (the map reads from it); TelemetryHistory/Observation/Track
// are append-heavy time-series stores.

import type {
  Asset, TelemetrySample, RawEvent, Observation, Track,
  Incident, OperationalTask, Feature, Operation, Alert, AuditLog,
} from '@fusion/shared-types';

export interface CurrentStateRepository {
  getAsset(id: string): Asset | undefined;
  listAssets(organizationId?: string): Asset[];
  upsertAsset(asset: Asset): void;
}

export interface TelemetryHistoryRepository {
  append(sample: TelemetrySample): void;
  history(assetId: string, from?: number, to?: number): TelemetrySample[];
}

export interface RawEventRepository {
  append(raw: RawEvent): void;
  recent(limit: number): RawEvent[];
  byCorrelation(correlationId: string): RawEvent[];
}

export interface ObservationRepository {
  append(observation: Observation): void;
  recent(limit: number): Observation[];
  byCorrelation(correlationId: string): Observation[];
}

export interface TrackRepository {
  upsert(track: Track): void;
  get(id: string): Track | undefined;
  list(organizationId?: string): Track[];
}

export interface DomainRepository {
  listIncidents(): Incident[];
  listTasks(): OperationalTask[];
  listFeatures(operationId?: string): Feature[];
  listOperations(): Operation[];
  listAlerts(): Alert[];
}

export interface AuditRepository {
  append(entry: AuditLog): void;
  recent(limit: number): AuditLog[];
}

/** Aggregate handed to services via dependency injection. */
export interface Repositories {
  currentState: CurrentStateRepository;
  telemetryHistory: TelemetryHistoryRepository;
  rawEvents: RawEventRepository;
  observations: ObservationRepository;
  tracks: TrackRepository;
  domain: DomainRepository;
  audit: AuditRepository;
}
