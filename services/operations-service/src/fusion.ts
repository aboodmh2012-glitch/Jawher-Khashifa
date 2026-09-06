// Fusion / track management (Phase B). Consumes Observations and maintains
// Tracks — the platform's fused, situational-awareness understanding of observed
// entities. Deterministic and simple by design; the algorithm pieces are behind
// interfaces so they can be replaced later without touching callers.
//
// SAFETY: situational awareness only. No targeting, engagement, or weapon logic.

import { randomUUID } from 'node:crypto';
import type { Observation, Track, TrackState, DataQuality } from '@fusion/shared-types';
import { envelope, type EventMeta, type Topic, type ServerMessage } from '@fusion/event-contracts';
import type { Store } from './store.js';
import type { Bus } from './bus.js';

/** Decide which existing track (if any) an observation belongs to. */
export interface TrackAssociator {
  associate(obs: Observation, index: Map<string, string>): string | null;
}
/** Fold an observation's kinematics into a track. */
export interface TrackUpdater {
  apply(track: Track, obs: Observation): void;
}
/** Compute a 0..1 confidence for a track at a point in time. */
export interface ConfidenceCalculator {
  compute(track: Track, now: number): number;
}

// --- default deterministic implementations ---------------------------------

/** Associate by assetId — one track per known asset (prevents obvious dupes). */
export class AssetIdAssociator implements TrackAssociator {
  associate(obs: Observation, index: Map<string, string>): string | null {
    return obs.assetId ? index.get(obs.assetId) ?? null : null;
  }
}

export class KinematicUpdater implements TrackUpdater {
  apply(track: Track, obs: Observation): void {
    if (obs.position) track.position = obs.position;
    if (obs.velocity) track.velocity = obs.velocity;
    if (obs.heading != null) track.heading = obs.heading;
    if (obs.altitude != null) track.altitude = obs.altitude;
    if (obs.classification) track.classification = obs.classification;
    track.lastSeenAt = obs.occurredAt;
    track.sourceCount += 1;
    track.observationIds.push(obs.id);
    if (track.observationIds.length > 20) track.observationIds.shift();
  }
}

export class FreshnessConfidence implements ConfidenceCalculator {
  compute(track: Track, now: number): number {
    const ageMs = now - track.lastSeenAt;
    const base = 0.4 + 0.12 * Math.min(track.sourceCount, 5);   // more sources → more confident
    const penalty = ageMs < 5000 ? 0 : ageMs < 15000 ? 0.2 : 0.45; // decay with staleness
    return Math.max(0, Math.min(1, base - penalty));
  }
}

// --- thresholds -------------------------------------------------------------
const CONFIRM_COUNT = 3;   // observations before tentative → confirmed
const COAST_MS = 6000;     // no updates → coasting
const LOST_MS = 20000;     // → lost
const ARCHIVE_MS = 60000;  // → archived (removed)

export class FusionService {
  private index = new Map<string, string>(); // assetId → trackId

  constructor(
    private store: Store,
    private bus: Bus,
    private associator: TrackAssociator = new AssetIdAssociator(),
    private updater: TrackUpdater = new KinematicUpdater(),
    private confidence: ConfidenceCalculator = new FreshnessConfidence(),
  ) {}

  /** Fold one observation into the track picture. */
  ingest(obs: Observation): Track | null {
    if (!obs.position) return null; // need a position to place a track
    const now = Date.now();
    let created = false;
    let trackId = this.associator.associate(obs, this.index);
    let track = trackId ? this.store.tracks.get(trackId) : undefined;

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
        quality: this.quality(obs.confidence, 0, now),
        firstSeenAt: obs.occurredAt,
        lastSeenAt: obs.occurredAt,
        sourceCount: 0,
        observationIds: [],
      };
      this.store.tracks.set(track.id, track);
      if (obs.assetId) this.index.set(obs.assetId, track.id);
      created = true;
    }

    this.updater.apply(track, obs);
    const prevState = track.state;
    if (track.state === 'tentative' && track.sourceCount >= CONFIRM_COUNT) track.state = 'confirmed';
    else if (track.state === 'coasting' || track.state === 'lost') track.state = 'confirmed'; // re-acquired
    track.confidence = this.confidence.compute(track, now);
    track.quality = this.quality(track.confidence, track.sourceCount, track.lastSeenAt);

    this.publish(created ? 'track.created' : 'track.updated', track, obs);
    if (!created && prevState !== track.state && (prevState === 'coasting' || prevState === 'lost')) {
      // re-acquisition already covered by track.updated
    }
    return track;
  }

  /** Age tracks that stopped receiving observations. Call periodically. */
  sweep(now = Date.now()): void {
    for (const track of [...this.store.tracks.values()]) {
      const age = now - track.lastSeenAt;
      const prev = track.state;
      if (track.state === 'confirmed' || track.state === 'tentative') {
        if (age > COAST_MS) track.state = 'coasting';
      } else if (track.state === 'coasting') {
        if (age > LOST_MS) track.state = 'lost';
      } else if (track.state === 'lost') {
        if (age > ARCHIVE_MS) track.state = 'archived';
      }
      if (track.state === prev) continue;
      track.confidence = this.confidence.compute(track, now);
      track.quality = this.quality(track.confidence, track.sourceCount, track.lastSeenAt);
      if (track.state === 'coasting') this.publish('track.coasting', track);
      else if (track.state === 'lost') this.publish('track.lost', track);
      else if (track.state === 'archived') {
        this.publish('track.lost', track);
        this.store.tracks.delete(track.id);
        for (const [asset, id] of this.index) if (id === track.id) this.index.delete(asset);
      } else this.publish('track.updated', track);
    }
  }

  private quality(confidence: number, sourceCount: number, lastUpdated: number): DataQuality {
    const ageMs = Date.now() - lastUpdated;
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
    // envelope() with a union `type` yields a union payload-typed envelope; each
    // concrete track.* topic is a ServerMessage member, so this narrows safely.
    this.bus.publish(envelope(type, track, meta) as ServerMessage);
  }
}
