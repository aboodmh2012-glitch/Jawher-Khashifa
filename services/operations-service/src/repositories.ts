// Memory-backed repository implementations over the in-process Store.
//
// This is the "first implementation may remain memory-backed" cut: business
// logic can already be written against the @fusion/repositories interfaces and
// injected, while production later swaps these for PostgreSQL/PostGIS +
// TimescaleDB implementations WITHOUT touching callers.

import type { Repositories } from '@fusion/repositories';
import type { Store } from './store.js';

/** Driver factory. Memory is the dev/test/demo path; a Postgres/Timescale-backed
 *  implementation plugs in behind the same interfaces (see repositories-postgres.ts).
 *  Note: DB-backed repositories are async by nature — adopting them evolves the
 *  Repositories interface to async variants (a tracked Phase-D follow-up). */
export function createRepositories(store: Store, driver = process.env.REPO_DRIVER ?? 'memory'): Repositories {
  if (driver !== 'memory') {
    console.warn(`[repositories] driver '${driver}' not wired (needs async repositories); using memory.`);
  }
  return createMemoryRepositories(store);
}

export function createMemoryRepositories(store: Store): Repositories {
  return {
    currentState: {
      getAsset: (id) => store.assets.get(id),
      listAssets: (orgId) => [...store.assets.values()].filter((a) => !orgId || a.orgId === orgId),
      upsertAsset: (asset) => { store.assets.set(asset.id, asset); },
    },
    telemetryHistory: {
      append: (sample) => store.pushSample(sample),
      history: (assetId, from, to) => store.telemetryHistory(assetId, from, to),
    },
    rawEvents: {
      append: (raw) => { store.rawEvents.push(raw); },
      recent: (limit) => store.rawEvents.slice(-limit).reverse(),
      byCorrelation: (cid) => store.rawEvents.filter((r) => r.correlationId === cid),
    },
    observations: {
      append: (o) => { store.observations.push(o); },
      recent: (limit) => store.observations.slice(-limit).reverse(),
      byCorrelation: (cid) => store.observations.filter((o) => o.correlationId === cid),
    },
    tracks: {
      upsert: (t) => { store.tracks.set(t.id, t); },
      get: (id) => store.tracks.get(id),
      list: (orgId) => [...store.tracks.values()].filter((t) => !orgId || t.organizationId === orgId),
    },
    domain: {
      listIncidents: () => [...store.incidents.values()],
      listTasks: () => [...store.tasks.values()],
      listFeatures: (opId) => [...store.features.values()].filter((f) => !opId || f.operationId === opId),
      listOperations: () => [...store.operations.values()],
      listAlerts: () => [...store.alerts.values()],
    },
    audit: {
      append: (entry) => { store.audit.unshift(entry); },
      recent: (limit) => store.audit.slice(0, limit),
    },
  };
}
