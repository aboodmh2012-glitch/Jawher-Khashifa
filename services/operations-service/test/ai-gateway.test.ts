import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.js';
import { IntelligenceCore } from '../src/intelligence-core.js';
import { AIGateway } from '../src/ai-gateway.js';

test('AI gateway exposes only registered read-only tools', () => {
  const store = new Store('org-a');
  const intelligence = new IntelligenceCore(store);
  const gateway = new AIGateway(store, intelligence);
  const names = gateway.tools.list().map((x) => x.name);
  assert.ok(names.includes('get_operational_brief'));
  assert.ok(names.includes('search_operational_data'));
  assert.equal(names.some((x) => /create|update|delete|command|dispatch/i.test(x)), false);
});

test('agent allowlist blocks tools outside its profile', () => {
  const store = new Store('org-a');
  const intelligence = new IntelligenceCore(store);
  const gateway = new AIGateway(store, intelligence);

  const result = gateway.run({
    organizationId: 'org-a',
    agent: 'fleet',
    tools: [{ name: 'list_sensors' }],
  });

  assert.equal(result.mode, 'deterministic-read-only');
  assert.equal(result.toolResults.length, 1);
  assert.equal(result.toolResults[0]?.tool, 'get_operational_brief');
});

test('knowledge search is tenant scoped', () => {
  const store = new Store('org-a');
  const intelligence = new IntelligenceCore(store);
  const gateway = new AIGateway(store, intelligence);
  store.upsertAssetSeed({ id: 'a1', name: 'Rescue Alpha', type: 'uav', orgId: 'org-a' });
  store.upsertAssetSeed({ id: 'b1', name: 'Rescue Bravo', type: 'uav', orgId: 'org-b' });

  const hits = gateway.knowledge.search('org-a', 'rescue');
  assert.equal(hits.some((x) => x.id === 'a1'), true);
  assert.equal(hits.some((x) => x.id === 'b1'), false);
});

test('gateway returns evidence-linked context without mutation', () => {
  const store = new Store('org-a');
  const intelligence = new IntelligenceCore(store);
  const gateway = new AIGateway(store, intelligence);
  store.addIncident({ title: 'Lost link', type: 'communications', severity: 'major' });

  const before = store.incidents.size;
  const result = gateway.run({
    organizationId: 'org-a',
    agent: 'incident',
    question: 'lost link',
    tools: [{ name: 'list_incidents' }, { name: 'get_operational_brief' }],
  });

  assert.equal(store.incidents.size, before);
  assert.equal(result.toolResults.every((x) => x.ok), true);
  assert.equal(result.knowledge.some((x) => x.kind === 'incident'), true);
});
