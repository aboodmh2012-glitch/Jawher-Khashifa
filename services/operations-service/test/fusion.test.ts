import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Store } from '../src/store.js';
import { createBus } from '../src/bus.js';
import { FusionService } from '../src/fusion.js';
import type { Observation } from '@fusion/shared-types';

function obs(assetId: string, at: number, lat = 24, lon = 54): Observation {
  return {
    id: randomUUID(), organizationId: 'org-demo', sourceId: 'SIM', assetId,
    occurredAt: at, receivedAt: at, position: { lat, lon }, confidence: 0.6,
    quality: { confidence: 0.6, state: 'good', lastUpdated: at, sourceCount: 1 },
  };
}

function fixture() {
  const store = new Store('org-demo');
  const bus = createBus();
  const events: string[] = [];
  bus.subscribe((m) => events.push(m.type));
  return { store, fusion: new FusionService(store, bus), events };
}

test('observation creates a tentative track', () => {
  const { store, fusion, events } = fixture();
  fusion.ingest(obs('A1', Date.now()));
  assert.equal(store.tracks.size, 1);
  const t = [...store.tracks.values()][0];
  assert.equal(t.state, 'tentative');
  assert.ok(events.includes('track.created'));
});

test('observations from one asset fuse into ONE track (dedup) and confirm', () => {
  const { store, fusion } = fixture();
  const now = Date.now();
  for (let i = 0; i < 3; i++) fusion.ingest(obs('A1', now + i));
  assert.equal(store.tracks.size, 1);                 // no duplicate tracks
  const t = [...store.tracks.values()][0];
  assert.equal(t.state, 'confirmed');                 // ≥ CONFIRM_COUNT observations
  assert.equal(t.sourceCount, 3);
});

test('confidence stays within [0,1]', () => {
  const { store, fusion } = fixture();
  const now = Date.now();
  for (let i = 0; i < 6; i++) fusion.ingest(obs('A1', now + i));
  const t = [...store.tracks.values()][0];
  assert.ok(t.confidence >= 0 && t.confidence <= 1);
});

test('track lifecycle ages confirmed → coasting → lost → archived', () => {
  const { store, fusion, events } = fixture();
  const t0 = Date.now();
  for (let i = 0; i < 3; i++) fusion.ingest(obs('A1', t0 + i));
  const id = [...store.tracks.values()][0].id;

  fusion.sweep(t0 + 7000);
  assert.equal(store.tracks.get(id)?.state, 'coasting');
  assert.ok(events.includes('track.coasting'));

  fusion.sweep(t0 + 21000);
  assert.equal(store.tracks.get(id)?.state, 'lost');
  assert.ok(events.includes('track.lost'));

  fusion.sweep(t0 + 61000);
  assert.equal(store.tracks.get(id), undefined);      // archived → removed
});

test('re-acquisition brings a coasting track back to confirmed', () => {
  const { store, fusion } = fixture();
  const t0 = Date.now();
  for (let i = 0; i < 3; i++) fusion.ingest(obs('A1', t0 + i));
  const id = [...store.tracks.values()][0].id;
  fusion.sweep(t0 + 7000);
  assert.equal(store.tracks.get(id)?.state, 'coasting');
  fusion.ingest(obs('A1', t0 + 8000));                // fresh observation
  assert.equal(store.tracks.get(id)?.state, 'confirmed');
});
