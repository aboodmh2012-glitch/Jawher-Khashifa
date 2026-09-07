// Fusion / track management (Phase B). Consumes Observations and maintains
// Tracks — the platform's fused, situational-awareness understanding of observed
// entities. Deterministic and simple by design; algorithm pieces remain behind
// interfaces so they can be replaced later without touching callers.
//
// SAFETY: situational awareness only. No targeting, engagement, or weapon logic.

import { randomUUID } from 'node:crypto';
import type { Observation, Track, DataQuality } from '@fusion/shared-types';
import { envelope, type EventMeta, type Topic, type ServerMessage } from '@fusion/event-contracts';
import type { Store } from './store.js';
import type { Bus } from './bus.js';

function assetScopeKey(obs: Pick<Observation, 'organizationId' | 'operationId' | 'assetId'>): string | null {
  if (!obs.assetId) return null;
  return `${obs.organizationId}:${obs.operationId ?? '-'}:${obs.assetId}`;
}

/** Decide which existing track (if any) an observation belongs to. */
export interface TrackAssociator {
  associate(obs: Observation, index: Map<string, string>): string | null;
}
/** Fold an observation's kinematics/provenance into a track. */
export interface TrackUpdater {
  apply(track: Track, obs: Observation): void;
}
/** Compute a 0..1 confidence for a track at a point in time. */
export interface ConfidenceCalculator {
  compute(track: Track, now: number): number;
}

// --- default deterministic implementations ---------------------------------

/**
 * Associate by a tenant/operation-scoped asset key. The same external assetId in
 * another organization or operation can never collide with this index.
 */
export class AssetIdAssociator implements TrackAssociator {
  associate(obs: Observation, index: Map<string, string>): string | null {
    const key = assetScopeKey(obs);
    return key ? index.get(key) ?? null : null;
  }
}

export class KinematicUpdater implements TrackUpdater {
  apply(track: Track, obs: Observation): void {
    // Preserve provenance even when an observation arrives late, but never let a
    // late packet roll the current operational picture backwards in time.
    const isCurrent = obs.occurredAt >= track.lastSeenAt;
    if (isCurrent) {
      if (obs.position) track.position = obs.position;
      if (obs.velocity) track.velocity = obs.velocity;
      if (obs.heading != null) track.heading = obs.heading;
      if (obs.altitude != null) track.altitude = obs.altitude;
      if (obs.classification) track.classification = obs.classification;
      if (obs.identity) track.identity = obs.identity;
      track.lastSeenAt = obs.occurredAt;
    }

    const sources = new Set(track.sourceIds ?? []);
    sources.add(obs.sourceId);
    track.sourceIds = [...sources].slice(-32);
    track.sourceCount = track.sourceIds.length;

    if (!track.observationIds.includes(obs.id)) {
      track.observationIds.push(obs.id);
      if (track.observationIds.length > 50) track.observationIds.shift();
    }
  }
}

export class FreshnessConfidence implements ConfidenceCalculator {
  compute(track: Track, now: number): number {
    const ageMs = Math.max(0, now - track.lastSeenAt);
    const distinctSources = track.sourceIds?.length ?? track.sourceCount;
    const base = 0.35 + 0.13 * Math.min(distinctSources, 5);
    const penalty = ageMs < 5000 ? 0 : ageMs < 15000 ? 0.2 : ageMs < 30000 ? 0.4 : 0.6;
    return Math.max(0, Math.min(1, base - penalty));
  }
}

// --- thresholds -------------------------------------------------------------
const CONFIRM_OBSERVATIONS = 3;
const COAST_MS = 6000;
const LOST_MS = 20000;
const ARCHIVE_MS = 60000;

export class FusionService {
  private index = new Map<string, string>(); // org:operation:assetId → trackId

  constructor(
    private store: Store,
    private bus: Bus,
    private associator: TrackAssociator = new AssetIdAssociator(),
    private updater: TrackUpdater = new KinematicUpdater(),
    private confidence: ConfidenceCalculator = new FreshnessConfidence(),
  ) {
    // Rebuild the deterministic association index from restored state.
    for (const track of this.store.tracks.values()) {
      const assetId = typeof track.metadata?.assetId === 'string' ? track.metadata.assetId : undefined;
      if (assetId) {
        const key = assetScopeKey({ organizationId: track.organizationId, operationId: track.operationId, assetId });
        if (key) this.index.set(key, track.id);
      }
    }
  }

  /** Fold one observation into the track picture. */
  ingest(obs: Observation): Track | null {
    if (!obs.position) return null;
    const now = Date.now();
    let created = false;
    const trackId = this.associator.associate(obs, this.index);
    let track = trackId ? this.store.tracks.get(trackId) : undefined;

    // Defensive scope check in case a custom associator returns an invalid track.
    if (track && (track.organizationId !== obs.organizationId || track.operationId !== obs.operationId)) {
      track = undefined;
    }

    if (!track) {
      track = {
        id: randomUUID(),
        organizationId: obs.organizationId,
        operationId: obs.operationId,
        state: 'tentative',
        position: obs.position,
        velocity: obs.velocity,
        heading: obs.heading,
        altitude: obs.altitude,
        classification: obs.classification ?? 'unknown',
        identity: obs.identity,
        confidence: obs.confidence,
        quality: this.quality(obs.confidence, 1, obs.occurredAt, now),
        firstSeenAt: obs.occurredAt,
        lastSeenAt: obs.occurredAt,
        sourceCount: 0,
        sourceIds: [],
        observationIds: [],
        metadata: obs.assetId ? { assetId: obs.assetId } : undefined,
      };
      this.store.tracks.set(track.id, track);
      const key = assetScopeKey(obs);
      if (key) this.index.set(key, track.id);
      created = true;
    }

    const previousState = track.state;
    this.updater.apply(track, obs);

    if (track.state === 'tentative' && track.observationIds.length >= CONFIRM_OBSERVATIONS) {
      track.state = 'confirmed';
    } else if ((track.state === 'coasting' || track.state === 'lost') && obs.occurredAt >= track.lastSeenAt) {
      track.state = 'confirmed';
    }

    track.confidence = this.confidence.compute(track, now);
    track.quality = this.quality(track.confidence, track.sourceCount, track.lastSeenAt, now);

    this.publish(created ? 'track.created' : 'track.updated', track, obs);
    if (!created && previousState !== track.state) {
      // State change is already represented by the updated track event.
    }
    return track;
  }

  /** Age tracks that stopped receiving observations. Call periodically. */
  sweep(now = Date.now()): void {
    for (const track of [...this.store.tracks.values()]) {
      const age = Math.max(0, now - track.lastSeenAt);
      const previous = track.state;
      if (track.state === 'confirmed' || track.state === 'tentative') {
        if (age > COAST_MS) track.state = 'coasting';
      } else if (track.state === 'coasting') {
        if (age > LOST_MS) track.state = 'lost';
      } else if (track.state === 'lost') {
        if (age > ARCHIVE_MS) track.state = 'archived';
      }
      if (track.state === previous) continue;

      track.confidence = this.confidence.compute(track, now);
      track.quality = this.quality(track.confidence, track.sourceCount, track.lastSeenAt, now);
      if (track.state === 'coasting') this.publish('track.coasting', track);
      else if (track.state === 'lost') this.publish('track.lost', track);
      else if (track.state === 'archived') {
        this.publish('track.lost', track);
        this.store.tracks.delete(track.id);
        for (const [key, id] of this.index) if (id === track.id) this.index.delete(key);
      } else this.publish('track.updated', track);
    }
  }

  private quality(confidence: number, sourceCount: number, lastUpdated: number, now = Date.now()): DataQuality {
    const ageMs = Math.max(0, now - lastUpdated);
    const state: DataQuality['state'] = ageMs < 5000 ? 'good' : ageMs < 15000 ? 'degraded' : 'stale';
    return { confidence, freshnessMs: ageMs, sourceCount, lastUpdated, state };
  }

  private publish(type: Extract<Topic, `track.${string}`>, track: Track, obs?: Observation): void {
    const meta: EventMeta = {
      source: 'fusion',
      correlationId: obs?.correlationId,
      causationId: obs?.id,
      assetId: obs?.assetId,
      organizationId: track.organizationId,
      operationId: track.operationId,
    };
    this.bus.publish(envelope(type, track, meta) as ServerMessage);
  }
}
