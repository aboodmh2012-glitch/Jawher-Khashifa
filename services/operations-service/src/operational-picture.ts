// Recognized Operational Picture (Phase B). The backend — not the frontend —
// assembles the authoritative picture, filtered to what the caller is authorized
// to see. Clients render the snapshot; they never compute global truth.

import type {
  Asset, Track, Incident, OperationalTask, Feature, Alert, Operation,
} from '@fusion/shared-types';
import type { Store } from './store.js';

export interface PictureFilter {
  organizationId?: string;
  operationId?: string;
  bbox?: [number, number, number, number]; // [west, south, east, north]
  assetType?: string;
  trackState?: string;
}

export interface OperationalPictureSnapshot {
  generatedAt: number;
  assets: Asset[];
  tracks: Track[];
  incidents: Incident[];
  tasks: OperationalTask[];
  features: Feature[];
  alerts: Alert[];
  operations: Operation[];
  systemStatus: {
    assets: number;
    online: number;
    tracks: number;
    confirmedTracks: number;
    openAlerts: number;
    quarantine: number;
    rawEvents: number;
    observations: number;
    mode: string;
  };
}

function inBbox(pos: { lat: number; lon: number } | undefined, b?: [number, number, number, number]): boolean {
  if (!b) return true;
  if (!pos) return false;
  const [w, s, e, n] = b;
  return pos.lon >= w && pos.lon <= e && pos.lat >= s && pos.lat <= n;
}

export function buildOperationalPicture(store: Store, f: PictureFilter = {}, mode = 'demo-memory'): OperationalPictureSnapshot {
  const org = f.organizationId;

  const assets = [...store.assets.values()].filter((a) =>
    (!org || a.orgId === org) &&
    (!f.assetType || a.type === f.assetType) &&
    inBbox(a.position, f.bbox));

  const tracks = [...store.tracks.values()].filter((t) =>
    (!org || t.organizationId === org) &&
    (!f.operationId || t.operationId === f.operationId) &&
    (!f.trackState || t.state === f.trackState) &&
    inBbox(t.position, f.bbox));

  const incidents = [...store.incidents.values()].filter((i) =>
    (!org || i.orgId === org) && inBbox(i.location, f.bbox));

  const tasks = [...store.tasks.values()].filter((t) => !org || t.orgId === org);
  const features = [...store.features.values()].filter((ft) => !f.operationId || ft.operationId === f.operationId);
  const alerts = [...store.alerts.values()].filter((a) => a.status !== 'resolved' && (!org || a.orgId === org));
  const operations = [...store.operations.values()].filter((o) => !org || o.organizationId === org);

  return {
    generatedAt: Date.now(),
    assets, tracks, incidents, tasks, features, alerts, operations,
    systemStatus: {
      assets: assets.length,
      online: assets.filter((a) => a.link === 'live').length,
      tracks: tracks.length,
      confirmedTracks: tracks.filter((t) => t.state === 'confirmed').length,
      openAlerts: alerts.filter((a) => a.status === 'open').length,
      quarantine: store.quarantine.length,
      rawEvents: store.rawEvents.length,
      observations: store.observations.length,
      mode,
    },
  };
}

/** Parse the query object into a typed filter. */
export function parsePictureFilter(q: Record<string, string | undefined>): PictureFilter {
  const f: PictureFilter = {
    organizationId: q.organizationId,
    operationId: q.operationId,
    assetType: q.assetType,
    trackState: q.trackState,
  };
  if (q.bbox) {
    const parts = q.bbox.split(',').map(Number);
    if (parts.length === 4 && parts.every((n) => !Number.isNaN(n))) {
      f.bbox = parts as [number, number, number, number];
    }
  }
  return f;
}
