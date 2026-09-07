// REST API (§18). Grouped under /api. Reads are open to any authenticated user;
// mutations require an operator+ role and generate audit events (§14).

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { envelope } from '@fusion/event-contracts';
import type { IncidentStatus } from '@fusion/shared-types';
import type { Store } from './store.js';
import type { Bus } from './bus.js';
import { authenticate, validDemoPassword, signToken, atLeast, type TokenPayload } from './auth.js';
import { openApiSpec } from './openapi.js';

import { config } from './config.js';
import { operationalBrief } from './insights.js';
import { bodySchemas, validGeometry } from './validation.js';
const identities = new WeakMap<FastifyRequest, TokenPayload>();
const auth = (req: FastifyRequest) => identities.get(req) ?? null;

export function registerRoutes(app: FastifyInstance, store: Store, bus: Bus): void {
  app.addHook('onRoute', route => {
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    for (const method of methods) {
      const schema = bodySchemas[`${method} ${route.url}`];
      if (schema) route.schema = { ...route.schema, body: schema };
    }
  });
  app.addHook('onRequest', async (req, reply) => {
    const path = req.url.split('?')[0];
    if (!path.startsWith('/api/') || ['/api/auth/login', '/api/auth/config'].includes(path)) return;
    const header = req.headers.authorization;
    const identity = await authenticate(header?.startsWith('Bearer ') ? header.slice(7) : undefined);
    if (!identity) return reply.code(401).send({ error: 'unauthorized' });
    if (identity.orgId !== store.orgId) return reply.code(403).send({ error: 'organization mismatch' });
    identities.set(req, identity);
  });
  app.get('/api/auth/config', async () => ({ mode: config.authMode }));
  const attempts = new Map<string, { count: number; reset: number }>();
  app.get('/health', async () => ({ status: 'ok', ts: Date.now() }));
  app.get('/api/openapi.json', async () => openApiSpec);

  // ---- auth ----
  app.post('/api/auth/login', async (req, reply) => {
    if (config.authMode !== 'demo') return reply.code(404).send({ error: 'Use OIDC sign-in' });
    const now = Date.now();
    for (const [key, value] of attempts) if (value.reset <= now) attempts.delete(key);
    const attempt = attempts.get(req.ip) ?? { count: 0, reset: now + 60_000 };
    if (attempt.count >= 10 || (!attempts.has(req.ip) && attempts.size >= 10000)) {
      return reply.header('Retry-After', '60').code(429).send({ error: 'Too many login attempts' });
    }
    attempt.count++; attempts.set(req.ip, attempt);
    const { username, password } = (req.body ?? {}) as { username?: string; password?: string };
    const user = username ? store.users.get(username) : undefined;
    const passwordValid = validDemoPassword(password);
    if (!user || !passwordValid) return reply.code(401).send({ error: 'invalid credentials' });
    const { token, expiresAt } = signToken(user);
    store.addAudit({ userId: user.id, action: 'auth.login', resource: 'session', ip: req.ip, newValue: { role: user.role } });
    return { token, user, expiresAt };
  });

  app.get('/api/auth/me', async (req, reply) => {
    const a = auth(req);
    if (!a) return reply.code(401).send({ error: 'unauthorized' });
    const user = store.users.get(a.sub);
    return user ?? { id: a.sub, username: a.sub, displayName: a.sub, role: a.role, orgId: a.orgId };
  });

  // gate for everything below
  const requireAuth = (req: FastifyRequest, reply: import('fastify').FastifyReply): TokenPayload | undefined => {
    const a = auth(req);
    if (!a) { reply.code(401).send({ error: 'unauthorized' }); return undefined; }
    return a;
  };
  const requireRole = (req: FastifyRequest, reply: import('fastify').FastifyReply, min: Parameters<typeof atLeast>[1]): TokenPayload | undefined => {
    const a = requireAuth(req, reply);
    if (!a) return undefined;
    if (!atLeast(a.role, min)) { reply.code(403).send({ error: 'forbidden' }); return undefined; }
    return a;
  };

  app.get('/api/insights', async (req, reply) => requireAuth(req, reply) && operationalBrief(store));

  // ---- reference data ----
  app.get('/api/organizations', async (req, reply) => requireAuth(req, reply) && [...store.orgs.values()]);
  app.get('/api/users', async (req, reply) => requireAuth(req, reply) && [...store.users.values()]);

  // ---- assets & telemetry ----
  app.get('/api/assets', async (req, reply) => requireAuth(req, reply) && [...store.assets.values()]);
  app.get('/api/assets/:id', async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    const a = store.assets.get((req.params as { id: string }).id);
    return a ?? reply.code(404).send({ error: 'not found' });
  });
  app.get('/api/telemetry/:assetId', async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    const { assetId } = req.params as { assetId: string };
    const { from, to } = req.query as { from?: string; to?: string };
    if ([from, to].some(v => v !== undefined && (typeof v !== 'string' || !v.trim() || !Number.isFinite(Number(v)) || Number(v) < 0)) ||
        (from !== undefined && to !== undefined && Number(from) > Number(to))) return reply.code(400).send({ error: 'Invalid time range' });
    return store.telemetryHistory(assetId, from !== undefined ? Number(from) : undefined, to !== undefined ? Number(to) : undefined);
  });

  // ---- incidents ----
  app.get('/api/incidents', async (req, reply) => requireAuth(req, reply) && [...store.incidents.values()]);
  app.post('/api/incidents', async (req, reply) => {
    const a = requireRole(req, reply, 'operator'); if (!a) return;
    const body = req.body as { title: string; type: string; severity: 'info' | 'minor' | 'major' | 'critical'; location?: { lat: number; lon: number }; description?: string };
    const inc = store.addIncident(body);
    store.addAudit({ userId: a.sub, action: 'incident.create', resource: inc.id, newValue: inc });
    bus.publish(envelope('incident.created', inc));
    bus.publish(envelope('event', store.addEvent('incident.created', `Incident: ${inc.title}`, inc.id, inc.severity === 'critical' ? 'critical' : 'warning')));
    return reply.code(201).send(inc);
  });
  app.patch('/api/incidents/:id', async (req, reply) => {
    const a = requireRole(req, reply, 'operator'); if (!a) return;
    const id = (req.params as { id: string }).id;
    const patch = req.body as { status?: IncidentStatus; note?: string };
    const before = store.incidents.get(id)?.status;
    const inc = store.updateIncident(id, patch.status ? { status: patch.status } : {}, patch.note);
    if (!inc) return reply.code(404).send({ error: 'not found' });
    store.addAudit({ userId: a.sub, action: 'incident.update', resource: id, previousValue: before, newValue: inc.status });
    bus.publish(envelope('incident.updated', inc));
    return inc;
  });

  // ---- tasks ----
  app.get('/api/tasks', async (req, reply) => requireAuth(req, reply) && [...store.tasks.values()]);
  app.post('/api/tasks', async (req, reply) => {
    const a = requireRole(req, reply, 'operator'); if (!a) return;
    const task = store.addTask(req.body as Parameters<typeof store.addTask>[0]);
    store.addAudit({ userId: a.sub, action: 'task.create', resource: task.id, newValue: task });
    bus.publish(envelope('task.created', task));
    return reply.code(201).send(task);
  });
  app.patch('/api/tasks/:id', async (req, reply) => {
    const a = requireRole(req, reply, 'operator'); if (!a) return;
    const id = (req.params as { id: string }).id;
    const task = store.updateTask(id, req.body as object);
    if (!task) return reply.code(404).send({ error: 'not found' });
    store.addAudit({ userId: a.sub, action: 'task.update', resource: id, newValue: task });
    bus.publish(envelope('task.updated', task));
    return task;
  });

  // ---- alerts ----
  app.get('/api/alerts', async (req, reply) => requireAuth(req, reply) && [...store.alerts.values()].sort((x, y) => y.createdAt - x.createdAt));
  app.post('/api/alerts/:id/ack', async (req, reply) => {
    const a = requireRole(req, reply, 'operator'); if (!a) return;
    const id = (req.params as { id: string }).id;
    const notes = (req.body as { notes?: string } | undefined)?.notes;
    const alert = store.ackAlert(id, a.sub, notes);
    if (!alert) return reply.code(404).send({ error: 'not found' });
    store.addAudit({ userId: a.sub, action: 'alert.ack', resource: id });
    bus.publish(envelope('alert.acknowledged', alert));
    return alert;
  });

  // ---- operations / features / channels / raw journal ----
  app.get('/api/operations', async (req, reply) => requireAuth(req, reply) && [...store.operations.values()]);
  app.get('/api/telemetry/channels', async (req, reply) => requireAuth(req, reply) && store.channels);

  app.get('/api/features', async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    const opId = (req.query as { operationId?: string }).operationId;
    return [...store.features.values()].filter((f) => !opId || f.operationId === opId);
  });
  app.post('/api/features', async (req, reply) => {
    const a = requireRole(req, reply, 'operator'); if (!a) return;
    const body = req.body as Parameters<typeof store.addFeature>[0];
    if (!store.operations.has(body.operationId) || !validGeometry(body.geometryType, body.coordinates)) {
      return reply.code(400).send({ error: 'Invalid operation or geometry' });
    }
    const feat = store.addFeature({ ...body, createdBy: a.sub, source: 'user' });
    store.addAudit({ userId: a.sub, action: 'feature.create', resource: feat.id, newValue: feat });
    bus.publish(envelope('feature.created', feat));
    return reply.code(201).send(feat);
  });
  app.patch('/api/features/:id', async (req, reply) => {
    const a = requireRole(req, reply, 'operator'); if (!a) return;
    const id = (req.params as { id: string }).id;
    const current = store.features.get(id);
    if (!current) return reply.code(404).send({ error: 'not found' });
    const { expectedVersion, ...patch } = req.body as Partial<import('@fusion/shared-types').Feature> & { expectedVersion: number };
    if (expectedVersion !== current.version) return reply.code(409).send({ error: 'Feature changed; reload before saving', currentVersion: current.version });
    if (!validGeometry(patch.geometryType ?? current.geometryType, patch.coordinates ?? current.coordinates)) {
      return reply.code(400).send({ error: 'Invalid geometry' });
    }
    const feat = store.updateFeature(id, patch);
    if (!feat) return reply.code(404).send({ error: 'not found' });
    store.addAudit({ userId: a.sub, action: 'feature.update', resource: feat.id });
    bus.publish(envelope('feature.updated', feat));
    return feat;
  });
  app.delete('/api/features/:id', async (req, reply) => {
    const a = requireRole(req, reply, 'operator'); if (!a) return;
    const id = (req.params as { id: string }).id;
    const feat = store.features.get(id);
    if (!store.deleteFeature(id)) return reply.code(404).send({ error: 'not found' });
    store.addAudit({ userId: a.sub, action: 'feature.delete', resource: id });
    bus.publish(envelope('feature.deleted', { id, operationId: feat?.operationId ?? '' }));
    return reply.code(204).send();
  });

  app.get('/api/raw-events', async (req, reply) => {
    const a = requireRole(req, reply, 'analyst'); if (!a) return;
    const limit = Number((req.query as { limit?: string }).limit ?? 100);
    if (!Number.isInteger(limit) || limit < 1 || limit > 2000) return reply.code(400).send({ error: 'limit must be 1..2000' });
    return store.rawEvents.slice(-limit).reverse();
  });
  app.post('/api/raw-events/reprocess', async (req, reply) => {
    const a = requireRole(req, reply, 'ops-supervisor'); if (!a) return;
    // Seam for replaying the journal through current parsers/normalizers.
    store.addAudit({ userId: a.sub, action: 'raw.reprocess', resource: 'journal' });
    return reply.code(501).send({ error: 'Reprocessing is not implemented. The retained journal is available for inspection.' });
  });

  // ---- events / map / audit / integrations ----
  app.get('/api/events', async (req, reply) => requireAuth(req, reply) && store.events);
  app.get('/api/map/geofences', async (req, reply) => requireAuth(req, reply) && [...store.geofences.values()]);
  app.get('/api/map/routes', async (req, reply) => requireAuth(req, reply) && [...store.routes.values()]);
  app.get('/api/audit', async (req, reply) => {
    const a = requireRole(req, reply, 'ops-supervisor'); if (!a) return;
    return store.audit;
  });
  app.get('/api/integrations', async (req, reply) => requireAuth(req, reply) && ([
    { kind: 'skynode', name: 'Skynode/PX4 Simulator', status: config.sim.enabled ? 'simulated' : 'disabled' },
    { kind: 'generic-fleet', name: 'Generic Fleet Simulator', status: config.sim.enabled ? 'simulated' : 'disabled' },
    { kind: 'tak', name: 'TAK Interop (CoT)', status: 'available' },
    { kind: 'mavlink', name: 'Generic MAVLink', status: 'scaffold' },
    { kind: 'video', name: 'Video (RTSP/WebRTC/HLS)', status: 'scaffold' },
    { kind: 'openmct', name: 'Open MCT telemetry feed', status: 'available' },
  ]));
}
