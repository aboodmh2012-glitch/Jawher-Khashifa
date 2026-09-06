import { test } from 'node:test';
import assert from 'node:assert/strict';
import { envelope } from '@fusion/event-contracts';
import { validate } from '@fusion/validation';
import { buildApp } from '../src/main.js';

test('EventEnvelope V2 serialization is stable and self-validates', () => {
  const e = envelope('asset.telemetry', { deviceId: 'd', assetId: 'A1', timestamp: Date.now(), position: { lat: 24, lon: 54 } },
    { source: 'SKYNODE', correlationId: 'CID', causationId: 'RAW', assetId: 'A1', organizationId: 'org' });
  const round = JSON.parse(JSON.stringify(e));
  // every field that has a value survives the round-trip unchanged
  for (const k of ['eventId', 'type', 'schemaVersion', 'source', 'occurredAt', 'receivedAt', 'correlationId', 'causationId', 'assetId', 'organizationId'] as const) {
    assert.deepEqual(round[k], e[k], `field ${k} stable`);
  }
  assert.deepEqual(round.payload, e.payload);
  assert.equal(round.topic, round.type);            // legacy alias survives
  assert.equal(round.ts, round.occurredAt);
  assert.equal(validate('envelope.v1', round).valid, true);
});

test('REST + health endpoints work (inject, no socket) and enforce auth', async () => {
  const { app, dispose } = await buildApp();
  try {
    const live = await app.inject({ method: 'GET', url: '/health/live' });
    assert.equal(live.statusCode, 200);
    assert.equal(live.json().status, 'live');

    const ready = await app.inject({ method: 'GET', url: '/health/ready' });
    assert.equal(ready.statusCode, 200);
    assert.equal(ready.json().status, 'ready');

    const noauth = await app.inject({ method: 'GET', url: '/api/assets' });
    assert.equal(noauth.statusCode, 401);           // frontend never enforces auth

    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'operator', password: 'x' } });
    assert.equal(login.statusCode, 200);
    const token = login.json().token as string;

    const assets = await app.inject({ method: 'GET', url: '/api/assets', headers: { authorization: `Bearer ${token}` } });
    assert.equal(assets.statusCode, 200);
    assert.ok(Array.isArray(assets.json()));

    const schemas = await app.inject({ method: 'GET', url: '/api/schemas', headers: { authorization: `Bearer ${token}` } });
    assert.ok(schemas.json().some((s: { id: string }) => s.id === 'envelope.v1'));
  } finally {
    await dispose();
  }
});
