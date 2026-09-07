import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.js';
import { seedDemo } from '../src/seed.js';
import type { Device } from '@fusion/shared-types';

function withDevices(store: Store, ids: string[]) {
  for (const id of ids) store.devices.set(id, { id, organizationId: 'org-demo' } as Device);
}

test('Asset↔Device: many devices, one primary, and a device can move assets', () => {
  const store = new Store('org-demo');
  withDevices(store, ['D1', 'D2', 'D3']);
  store.linkAssetDevice('A1', 'D1', { role: 'autopilot', isPrimary: true });
  store.linkAssetDevice('A1', 'D2', { role: 'camera' });
  store.linkAssetDevice('A1', 'D3', { role: 'gps' });
  assert.equal(store.devicesOfAsset('A1').length, 3);
  assert.equal(store.assetOfDevice('D2'), 'A1');

  // remove D2 from A1, mount it on A2 — it moved
  store.unlinkAssetDevice('A1', 'D2');
  assert.equal(store.devicesOfAsset('A1').length, 2);
  store.linkAssetDevice('A2', 'D2', { role: 'camera' });
  assert.equal(store.assetOfDevice('D2'), 'A2');
  assert.equal(store.devicesOfAsset('A2').length, 1);
});

test('RawEvent starts received and advances status; payload untouched', () => {
  const store = new Store('org-demo');
  const raw = store.addRawEvent('SKYNODE', 'telemetry', { lat: 1, lon: 2 }, { assetId: 'A1' });
  assert.equal(raw.processingStatus, 'received');
  assert.equal(raw.organizationId, 'org-demo');
  assert.equal(raw.adapterId, 'skynode');
  store.setRawEventStatus(raw.id, 'normalized');
  assert.equal(store.rawEvents.find((r) => r.id === raw.id)?.processingStatus, 'normalized');
  assert.deepEqual(raw.payload, { lat: 1, lon: 2 }); // payload immutable across status change
});

test('org hierarchy seeds and links Team → Unit → OpsCenter → Region', () => {
  const store = new Store('org-demo');
  seedDemo(store);
  const team = store.teams.get('team-1');
  assert.equal(team?.unitId, 'unit-1');
  assert.equal(store.units.get('unit-1')?.operationsCenterId, 'oc-1');
  assert.equal(store.operationsCenters.get('oc-1')?.regionId, 'region-1');
  assert.equal(store.regions.get('region-1')?.organizationId, 'org-demo');

  // seeded Asset↔Device for UAV-01
  const devs = store.devicesOfAsset('UAV-01');
  assert.equal(devs.length, 3);
  const primary = store.assetDevices.filter((l) => l.assetId === 'UAV-01' && l.isPrimary && l.removedAt == null);
  assert.equal(primary.length, 1);
  assert.equal(store.agents.get('AGENT-UAV-01')?.assetId, 'UAV-01');
});
