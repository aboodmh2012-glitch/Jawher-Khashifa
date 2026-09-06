import { test } from 'node:test';
import assert from 'node:assert/strict';
import { policy } from '@fusion/authorization';
import { Store } from '../src/store.js';
import { signToken } from '../src/auth.js';
import { buildApp } from '../src/main.js';
import type { User } from '@fusion/shared-types';

test('PolicyEngine: role capability gates', () => {
  const viewer = { userId: 'v', role: 'viewer' as const, organizationId: 'org' };
  const operator = { userId: 'o', role: 'operator' as const, organizationId: 'org' };
  const supervisor = { userId: 's', role: 'ops-supervisor' as const, organizationId: 'org' };
  assert.equal(policy.can(viewer, 'asset.read').allow, true);
  assert.equal(policy.can(viewer, 'incident.create').allow, false);      // below operator
  assert.equal(policy.can(operator, 'incident.create').allow, true);
  assert.equal(policy.can(operator, 'audit.read').allow, false);         // below supervisor
  assert.equal(policy.can(supervisor, 'audit.read').allow, true);
});

test('PolicyEngine: tenant isolation (cross-org denied except platform-admin)', () => {
  const opA = { userId: 'a', role: 'operator' as const, organizationId: 'A' };
  const admin = { userId: 'z', role: 'platform-admin' as const, organizationId: 'A' };
  assert.equal(policy.can(opA, 'incident.update', { organizationId: 'A' }).allow, true);
  const denied = policy.can(opA, 'incident.update', { organizationId: 'B' });
  assert.equal(denied.allow, false);
  assert.match(denied.reason ?? '', /cross-tenant/);
  assert.equal(policy.can(admin, 'incident.update', { organizationId: 'B' }).allow, true); // admin crosses
});

test('Audit V2 redacts sensitive values', () => {
  const store = new Store('org-demo');
  const log = store.addAudit({
    actorId: 'u1', action: 'auth.login', resourceType: 'session',
    newValue: { token: 'SECRET', nested: { password: 'p', keep: 'ok' }, role: 'operator' },
  });
  const nv = log.newValue as { token: string; nested: { password: string; keep: string } };
  assert.equal(nv.token, '[redacted]');
  assert.equal(nv.nested.password, '[redacted]');
  assert.equal(nv.nested.keep, 'ok');                 // non-sensitive preserved
  assert.equal(log.result, 'success');
  assert.equal(log.actorType, 'user');
});

test('Tenant isolation in API: a foreign-org user sees none of demo-org data', async () => {
  const { app, store, dispose } = await buildApp();
  try {
    const other: User = { id: 'ext', orgId: 'org-other', username: 'ext', displayName: 'Ext', role: 'operator' };
    store.users.set('ext', other);
    const { token } = signToken(other);

    const foreign = await app.inject({ method: 'GET', url: '/api/assets', headers: { authorization: `Bearer ${token}` } });
    assert.equal(foreign.statusCode, 200);
    assert.equal(foreign.json().length, 0);           // sees nothing from org-demo

    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'operator', password: 'x' } });
    const demoTok = login.json().token as string;
    const demo = await app.inject({ method: 'GET', url: '/api/assets', headers: { authorization: `Bearer ${demoTok}` } });
    assert.ok(demo.json().length > 0);                 // demo-org operator sees assets
  } finally {
    await dispose();
  }
});
