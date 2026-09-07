import test from 'node:test';
import assert from 'node:assert/strict';
import type { Track } from '@fusion/shared-types';
import { Store } from '../src/store.js';
import { IntelligenceCore } from '../src/intelligence-core.js';

test('intelligence core scopes sensors and evidence by organization', () => {
  const store = new Store('org-a');
  const core = new IntelligenceCore(store);
  const sensor = core.observeSensor({ organizationId: 'org-a', sourceId: 'SIM', sensorId: 'gps', assetId: 'a1', at: 1000 });
  core.observeSensor({ organizationId: 'org-b', sourceId: 'SIM', sensorId: 'gps', assetId: 'b1', at: 1000 });

  const evidence = core.recordEvidence({
    organizationId: 'org-a', kind: 'telemetry', sourceId: 'SIM', sensorId: sensor.id,
    assetId: 'a1', occurredAt: 1000, receivedAt: 1001, confidence: 0.9,
    quality: { confidence: 0.9, state: 'good', lastUpdated: 1001, sourceCount: 1 },
  });

  assert.equal(core.listSensors('org-a').length, 1);
  assert.equal(core.listSensors('org-b').length, 1);
  assert.equal(core.recentEvidence('org-a').length, 1);
  assert.equal(core.recentEvidence('org-b').length, 0);
  assert.equal(core.evidenceById(evidence.id)?.assetId, 'a1');
});

test('track history stores immutable snapshots', () => {
  const store = new Store('org-a');
  const core = new IntelligenceCore(store);
  const track: Track = {
    id: 't1', organizationId: 'org-a', state: 'confirmed',
    position: { lat: 1, lon: 2 }, classification: 'asset', confidence: 0.8,
    quality: { confidence: 0.8, state: 'good' }, firstSeenAt: 1, lastSeenAt: 2,
    sourceCount: 1, sourceIds: ['SIM'], observationIds: ['o1'],
  };
  core.recordTrackSnapshot(track, 10);
  track.position.lat = 9;
  track.observationIds.push('o2');
  core.recordTrackSnapshot(track, 20);

  const history = core.trackHistory('t1', 'org-a');
  assert.equal(history.length, 2);
  assert.equal(history[0]?.position.lat, 1);
  assert.equal(history[1]?.position.lat, 9);
  assert.deepEqual(history[0]?.observationIds, ['o1']);
});

test('brief summarizes quality without inventing conclusions', () => {
  const store = new Store('org-a');
  const core = new IntelligenceCore(store);
  store.upsertAssetSeed({ id: 'a1', name: 'Asset 1', type: 'ground-vehicle' });
  store.observations.push({
    id: 'o1', organizationId: 'org-a', sourceId: 'SIM', assetId: 'a1',
    occurredAt: Date.now(), receivedAt: Date.now(), position: { lat: 1, lon: 2 },
    confidence: 0.5, quality: { confidence: 0.5, state: 'degraded' },
  });

  const brief = core.brief('org-a');
  assert.equal(brief.counts.assets, 1);
  assert.equal(brief.counts.observations, 1);
  assert.equal(brief.dataQuality.degraded, 1);
  assert.equal(brief.dataQuality.averageConfidence, 0.5);
});
