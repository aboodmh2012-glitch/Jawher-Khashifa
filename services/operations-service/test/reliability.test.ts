import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { buildApp } from '../src/app.js';
import { Store } from '../src/store.js';
import { seedDemo } from '../src/seed.js';
import { signToken, verifyToken } from '../src/auth.js';
import { loadConfig } from '../src/config.js';
import { FilePersistence } from '../src/persistence.js';
import { createBus } from '../src/bus.js';
import { AlertEngine } from '../src/alerts.js';
import { buildContext } from '../src/adapters.js';
import { validGeometry } from '../src/validation.js';

const user = { id: 'operator', username: 'operator', displayName: 'Operator', orgId: 'org-demo', role: 'operator' as const };
const headers = (role = 'operator', orgId = 'org-demo') => ({ authorization: `Bearer ${signToken({ ...user, role: role as typeof user.role, orgId }).token}` });
const sample = (timestamp = Date.now(), lat = 1) => ({ assetId: 'A', deviceId: 'D', timestamp, position: { lat, lon: 1 }, battery: { percentage: 90 } });

async function fixture() {
  const store = new Store('org-demo'); seedDemo(store);
  const result = await buildApp({ store, simulation: false });
  await result.app.ready(); return result;
}

test('HTTP authentication, password verification, organization boundary, and role checks', async () => {
  const { app } = await fixture();
  try {
    assert.equal((await app.inject('/api/assets')).statusCode, 401);
    assert.equal((await app.inject(`/api/assets?token=${signToken(user).token}`)).statusCode, 401);
    assert.equal((await app.inject({ url: '/api/assets', headers: headers('platform-admin', 'other') })).statusCode, 403);
    assert.equal((await app.inject({ url: '/api/assets', headers: headers() })).statusCode, 200);
    assert.equal((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'admin', password: 'wrong' } })).statusCode, 401);
    assert.equal((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'admin', password: 'demo' } })).statusCode, 200);
    assert.equal((await app.inject({ method: 'POST', url: '/api/incidents', headers: headers('analyst'), payload: { title: 'Help', type: 'sar', severity: 'major' } })).statusCode, 403);
    assert.equal(verifyToken(signToken(user).token + '.extra'), null);
    assert.equal(verifyToken(signToken(user, -1).token), null);
  } finally { await app.close(); }
});

test('strict mutation schemas protect identity and validate geometry; optimistic concurrency prevents overwrite', async () => {
  const { app, store } = await fixture();
  try {
    const taskId = [...store.tasks.keys()][0];
    assert.equal((await app.inject({ method: 'PATCH', url: `/api/tasks/${taskId}`, headers: headers(), payload: { id: 'hijack', orgId: 'other' } })).statusCode, 400);
    assert.equal((await app.inject({ method: 'POST', url: '/api/incidents', headers: headers(), payload: { title: '', type: 'sar', severity: 'made-up' } })).statusCode, 400);
    const id = [...store.incidents.keys()][0]; const before = store.incidents.get(id)!.status;
    assert.equal((await app.inject({ method: 'PATCH', url: `/api/incidents/${id}`, headers: headers(), payload: { note: 'Updated notes only' } })).statusCode, 200);
    assert.equal(store.incidents.get(id)!.status, before);
    await app.inject({ method: 'PATCH', url: `/api/incidents/${id}`, headers: headers(), payload: { status: 'closed' } });
    assert.equal(store.audit[0].previousValue, before);
    const feature = [...store.features.values()][0];
    assert.equal((await app.inject({ method: 'PATCH', url: `/api/features/${feature.id}`, headers: headers(), payload: { expectedVersion: 1, properties: { name: 'Updated' } } })).statusCode, 200);
    assert.equal((await app.inject({ method: 'PATCH', url: `/api/features/${feature.id}`, headers: headers(), payload: { expectedVersion: 1, properties: { name: 'Lost update' } } })).statusCode, 409);
    assert.equal((await app.inject({ method: 'POST', url: '/api/features', headers: headers(), payload: { operationId: 'op-demo', type: 'marker', geometryType: 'Point', coordinates: [190, 5] } })).statusCode, 400);
    assert.equal((await app.inject({ url: '/api/raw-events?limit=-1', headers: headers() })).statusCode, 400);
    assert.equal((await app.inject({ url: '/api/telemetry/A?from=abc', headers: headers() })).statusCode, 400);
  } finally { await app.close(); }
});

test('WebSocket withholds snapshot until authentication, rejects other organizations and forbidden origins', async () => {
  const { app } = await fixture();
  try {
    const ws = await app.injectWS('/ws');
    const received: string[] = [];
    ws.on('message', (d: { toString(): string }) => received.push(d.toString()));
    // A bus event before auth must not leak.
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(received.length, 0);
    const response = once(ws, 'message');
    ws.send(JSON.stringify({ type: 'auth', token: signToken(user).token }));
    const [data] = await response;
    const snapshot = JSON.parse(data.toString());
    assert.equal(snapshot.topic, 'snapshot'); assert.ok(snapshot.payload.tasks.length > 0);
    ws.terminate();
    const wrong = await app.injectWS('/ws');
    const closed = once(wrong, 'close');
    wrong.send(JSON.stringify({ type: 'auth', token: signToken({ ...user, orgId: 'other' }).token }));
    assert.equal((await closed)[0], 1008);
    await assert.rejects(app.injectWS('/ws', { headers: { origin: 'https://evil.example' } }));
  } finally { await app.close(); }
});

test('source time ordering keeps late data in history without rewinding current state or duplicating retries', () => {
  const store = new Store('org-demo'); store.upsertAssetSeed({ id: 'A', name: 'A', type: 'sensor' });
  const now = Date.now();
  assert.ok(store.applyTelemetry(sample(now, 3)));
  assert.equal(store.applyTelemetry(sample(now - 1000, 2)), null);
  assert.equal(store.applyTelemetry(sample(now, 3)), null);
  assert.equal(store.assets.get('A')!.position!.lat, 3);
  assert.equal(store.telemetryHistory('A', 0).length, 2);
  assert.equal(store.applyTelemetry(sample(now + 120000)), null);
  assert.equal(store.applyTelemetry(sample(now + 1, NaN)), null);
});

test('comms recovery resolves alert immediately; battery escalation reopens acknowledgement', () => {
  const store = new Store('org-demo'); const bus = createBus(); const engine = new AlertEngine(store, bus);
  const ctx = buildContext(store, bus, engine);
  ctx.onAssetUp({ id: 'A', name: 'A', type: 'sensor' });
  const asset = store.assets.get('A')!; asset.link = 'offline'; engine.commsLost(asset);
  ctx.onTelemetry(sample());
  assert.equal([...store.alerts.values()].find(a => a.kind === 'comms-lost')!.status, 'resolved');
  asset.latest!.battery!.percentage = 15; engine.evaluate(asset);
  const alert = [...store.alerts.values()].find(a => a.kind === 'battery-low')!;
  store.ackAlert(alert.id, 'operator'); asset.latest!.battery!.percentage = 5; engine.evaluate(asset);
  assert.equal(alert.severity, 'critical'); assert.equal(alert.status, 'open');
  assert.equal([...store.alerts.values()].filter(a => a.kind === 'battery-low').length, 1);
});

test('checkpoint restores all state, archives original raw data and rejects organization mismatch', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fusion-test-'));
  try {
    const store = new Store('org-demo'); seedDemo(store);
    const disk = new FilePersistence(dir, store, 'demo');
    store.setJournal((kind, value) => disk.append(kind, value));
    const payload = { x: 1 }; store.addRawEvent('SIM', 'sample', payload); payload.x = 2;
    const inc = store.addIncident({ title: 'Persist me', type: 'sar', severity: 'major' });
    store.addAudit({ userId: 'operator', action: 'create', resource: inc.id, newValue: inc });
    inc.title = 'Changed'; assert.equal((store.audit[0].newValue as typeof inc).title, 'Persist me');
    disk.close();
    const restored = new Store('org-demo'); const next = new FilePersistence(dir, restored, 'demo');
    assert.equal(next.restore(), true); assert.equal(restored.incidents.get(inc.id)!.title, 'Changed');
    assert.equal((restored.rawEvents[0].payload as { x: number }).x, 1);
    const rawFile = readdirSync(dir).find(x => x.startsWith('raw-'))!;
    assert.equal(JSON.parse(readFileSync(join(dir, rawFile), 'utf8')).payload.x, 1);
    assert.throws(() => new Store('other').restoreState(restored.exportState()));
    next.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('production refuses demo authentication, missing durable state and silent bus fallback', () => {
  assert.throws(() => loadConfig({ NODE_ENV: 'production', AUTH_MODE: 'demo' }));
  assert.throws(() => loadConfig({ AUTH_MODE: 'oidc' }));
  assert.throws(() => createBus('nats'));
  assert.equal(validGeometry('Polygon', [[[0,0],[1,0],[1,1],[0,0]]]), true);
  assert.equal(validGeometry('Polygon', [[[0,0],[1,0],[1,1]]]), false);
});

test('operational brief exposes evidence and detects stale source time without mutating records', async () => {
  const { operationalBrief } = await import('../src/insights.js');
  const store = new Store('org-demo'); const now = Date.now();
  store.upsertAssetSeed({ id: 'A', name: 'A', type: 'sensor' });
  store.applyTelemetry(sample(now - 30000));
  store.addTask({ name: 'Inspect', type: 'inspection', deadline: now - 1, status: 'active' });
  const before = JSON.stringify(store.exportState());
  const brief = operationalBrief(store, now);
  assert.equal(brief.provider, 'rules-v1');
  assert.ok(brief.insights.some(x => x.category === 'data-quality' && x.evidence.resourceId === 'A'));
  assert.ok(brief.insights.some(x => x.category === 'task'));
  assert.equal(JSON.stringify(store.exportState()), before);
});
