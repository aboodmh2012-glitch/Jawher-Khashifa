import { test } from 'node:test';
import assert from 'node:assert/strict';
import { envelope, newId } from '@fusion/event-contracts';
import { validate, listSchemas } from '@fusion/validation';
import { Store } from '../src/store.js';
import { createBus } from '../src/bus.js';
import { AlertEngine } from '../src/alerts.js';
import { buildContext } from '../src/adapters.js';
import { createMemoryRepositories } from '../src/repositories.js';
import { FusionService } from '../src/fusion.js';
import type { NormalizedTelemetry } from '@fusion/shared-types';

test('envelope V2: unique ids, correlation propagates, legacy aliases kept', () => {
  const a = envelope('asset.position', { assetId: 'X', lat: 1, lon: 2 });
  const b = envelope('asset.position', { assetId: 'X', lat: 1, lon: 2 });
  assert.notEqual(a.eventId, b.eventId);            // globally unique
  assert.equal(a.topic, a.type);                    // legacy discriminant alias
  assert.equal(a.ts, a.occurredAt);                 // legacy timestamp alias
  const c = envelope('asset.telemetry', {} as never, { correlationId: 'CID-1', causationId: 'RAW-1', source: 'SKYNODE' });
  assert.equal(c.correlationId, 'CID-1');           // correlation carried through
  assert.equal(c.causationId, 'RAW-1');
  assert.equal(c.source, 'SKYNODE');
});

test('validation: valid telemetry passes, invalid is rejected, unknown schema rejected', () => {
  const ids = listSchemas().map((s) => s.id);
  for (const id of ['raw-event.v1', 'asset.v1', 'telemetry.v1', 'observation.v1', 'track.v1', 'feature.v1', 'incident.v1']) {
    assert.ok(ids.includes(id), `schema ${id} registered`);
  }
  assert.equal(validate('asset.v1', { id: 'A1', orgId: 'o', name: 'U1', type: 'uav' }).valid, true);
  assert.equal(validate('asset.v1', { id: 'A1', orgId: 'o', name: 'U1', type: 'bogus' }).valid, false);
  const good = validate('telemetry.v1', { deviceId: 'd', assetId: 'A1', timestamp: Date.now(), position: { lat: 24, lon: 54 } });
  assert.equal(good.valid, true);
  const bad = validate('telemetry.v1', { deviceId: 'd', assetId: 'A1', timestamp: Date.now(), position: { lat: 999, lon: 54 } });
  assert.equal(bad.valid, false);
  assert.ok(bad.errors.length > 0);
  assert.equal(validate('nope.v9', {}).valid, false);
});

function fixture() {
  const store = new Store('org-demo');
  store.upsertAssetSeed({ id: 'A1', name: 'Unit 1', type: 'uav' });
  const bus = createBus();
  const alerts = new AlertEngine(store, bus);
  const fusion = new FusionService(store, bus);
  const ctx = buildContext(store, bus, alerts, fusion);
  return { store, ctx };
}

test('provenance survives: raw → correlationId → normalized telemetry', () => {
  const { store, ctx } = fixture();
  const ref = ctx.onRaw('SIM', 'test', { id: 'A1' }, { assetId: 'A1' });
  assert.ok(ref.rawEventId && ref.correlationId);
  const t: NormalizedTelemetry = { deviceId: 'd', assetId: 'A1', timestamp: Date.now(), position: { lat: 24, lon: 54 } };
  ctx.onTelemetry(t, ref);
  const asset = store.assets.get('A1')!;
  assert.equal(asset.latest?.provenance?.correlationId, ref.correlationId);
  assert.equal(asset.latest?.provenance?.rawEventId, ref.rawEventId);
  // and the raw journal is traceable by correlationId
  const repos = createMemoryRepositories(store);
  assert.equal(repos.rawEvents.byCorrelation(ref.correlationId).length, 1);
});

test('invalid telemetry is quarantined, not crashed', () => {
  const { store, ctx } = fixture();
  const ref = ctx.onRaw('SIM', 'test', { id: 'A1' }, { assetId: 'A1' });
  const before = store.quarantine.length;
  // lat out of range → fails telemetry.v1
  ctx.onTelemetry({ deviceId: 'd', assetId: 'A1', timestamp: Date.now(), position: { lat: 999, lon: 54 } }, ref);
  assert.equal(store.quarantine.length, before + 1);
  assert.equal(store.quarantine.at(-1)?.correlationId, ref.correlationId);
  // asset state was NOT updated from the invalid sample
  assert.equal(store.assets.get('A1')?.latest, undefined);
});

test('raw is journaled before derived data (ordering invariant)', () => {
  const { store, ctx } = fixture();
  assert.equal(store.rawEvents.length, 0);
  const ref = ctx.onRaw('SIM', 'test', { id: 'A1' }, { assetId: 'A1' });
  assert.equal(store.rawEvents.length, 1);           // raw exists first
  ctx.onTelemetry({ deviceId: 'd', assetId: 'A1', timestamp: Date.now(), position: { lat: 24, lon: 54 } }, ref);
  assert.equal(store.assets.get('A1')?.latest?.provenance?.rawEventId, store.rawEvents[0].id);
  assert.ok(newId().length > 0);
});
