// REST API (§18). Grouped under /api. Reads are open to any authenticated user;
// mutations require an operator+ role and generate audit events (§14).

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { envelope } from '@fusion/event-contracts';
import type { IncidentStatus } from '@fusion/shared-types';
import type { Store } from './store.js';
import type { Bus } from './bus.js';
import { verifyToken, signToken, atLeast, type TokenPayload } from './auth.js';
import { openApiSpec } from './openapi.js';

function auth(req: FastifyRequest): TokenPayload | null {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : (req.query as { token?: string })?.token;
  return verifyToken(token);
}

export function registerRoutes(app: FastifyInstance, store: Store, bus: Bus): void {
  app.get('/health', async () => ({ status: 'ok', ts: Date.now() }));
  app.get('/api/openapi.json', async () => openApiSpec);

  // ---- auth ----
  app.post('/api/auth/login', async (req, reply) => {
    const { username } = (req.body ?? {}) as { username?: string; password?: string };
    const user = username ? store.users.get(username) : undefined;
    if (!user) return reply.code(401).send({ error: 'invalid credentials' });
    // DEMO: any password accepted. Real deployments delegate to Keycloak/OIDC.
    const { token, expiresAt } = signToken(user);
    store.addAudit({ userId: user.id, action: 'auth.login', resource: 'session', ip: req.ip, newValue: { role: user.role } });
    return { token, user, expiresAt };
  });

  app.get('/api/auth/me', async (req, reply) => {
    const a = auth(req);
    if (!a) return reply.code(401).send({ error: 'unauthorized' });
    const user = store.users.get(a.sub);
    return user ?? reply.code(404).send({ error: 'not found' });
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
    return store.telemetryHistory(assetId, from ? Number(from) : undefined, to ? Number(to) : undefined);
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
    const before = store.incidents.get(id);
    const inc = store.updateIncident(id, { status: patch.status }, patch.note);
    if (!inc) return reply.code(404).send({ error: 'not found' });
    store.addAudit({ userId: a.sub, action: 'incident.update', resource: id, previousValue: before?.status, newValue: inc.status });
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
    const feat = store.addFeature(req.body as Parameters<typeof store.addFeature>[0]);
    store.addAudit({ userId: a.sub, action: 'feature.create', resource: feat.id, newValue: feat });
    bus.publish(envelope('feature.created', feat));
    return reply.code(201).send(feat);
  });
  app.patch('/api/features/:id', async (req, reply) => {
    const a = requireRole(req, reply, 'operator'); if (!a) return;
    const feat = store.updateFeature((req.params as { id: string }).id, req.body as object);
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
    return store.rawEvents.slice(-limit).reverse();
  });
  app.post('/api/raw-events/reprocess', async (req, reply) => {
    const a = requireRole(req, reply, 'ops-supervisor'); if (!a) return;
    // Seam for replaying the journal through current parsers/normalizers.
    store.addAudit({ userId: a.sub, action: 'raw.reprocess', resource: 'journal' });
    return { journaled: store.rawEvents.length, note: 'reprocess is a Phase-2 batch job (journal is retained for replay)' };
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
    { kind: 'skynode', name: 'Skynode/PX4 Simulator', status: 'active' },
    { kind: 'generic-fleet', name: 'Generic Fleet Simulator', status: 'active' },
    { kind: 'tak', name: 'TAK Interop (CoT)', status: 'available' },
    { kind: 'mavlink', name: 'Generic MAVLink', status: 'scaffold' },
    { kind: 'video', name: 'Video (RTSP/WebRTC/HLS)', status: 'scaffold' },
    { kind: 'openmct', name: 'Open MCT telemetry feed', status: 'available' },
  ]));
}
