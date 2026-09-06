// REST API. Grouped under /api. Every capability check goes through the
// PolicyEngine (§C3) — no scattered role if-statements. List endpoints are
// tenant-filtered to the caller's organization (§C2); only platform-admin sees
// across organizations. Sensitive actions write V2 audit records (§C4).

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { envelope } from '@fusion/event-contracts';
import type { IncidentStatus } from '@fusion/shared-types';
import { policy, type Action, type Actor, type PolicyContext } from '@fusion/authorization';
import type { Store } from './store.js';
import type { Bus } from './bus.js';
import { verifyToken, signToken, type TokenPayload } from './auth.js';
import { openApiSpec } from './openapi.js';
import { listSchemas } from '@fusion/validation';
import type { Repositories } from '@fusion/repositories';
import { buildOperationalPicture, parsePictureFilter } from './operational-picture.js';

function auth(req: FastifyRequest): TokenPayload | null {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : (req.query as { token?: string })?.token;
  return verifyToken(token);
}
const actorOf = (a: TokenPayload): Actor => ({ userId: a.sub, role: a.role, organizationId: a.orgId });

export function registerRoutes(app: FastifyInstance, store: Store, bus: Bus, repos: Repositories): void {
  app.get('/health', async () => ({ status: 'ok', ts: Date.now() }));
  app.get('/api/openapi.json', async () => openApiSpec);

  app.post('/api/auth/login', async (req, reply) => {
    const { username } = (req.body ?? {}) as { username?: string; password?: string };
    const user = username ? store.users.get(username) : undefined;
    if (!user) return reply.code(401).send({ error: 'invalid credentials' });
    // DEMO: any password accepted. Real deployments delegate to Keycloak/OIDC.
    const { token, expiresAt } = signToken(user);
    store.addAudit({ actorId: user.id, action: 'auth.login', resourceType: 'session', resourceId: user.id, organizationId: user.orgId, sourceIp: req.ip, newValue: { role: user.role } });
    return { token, user, expiresAt };
  });

  app.get('/api/auth/me', async (req, reply) => {
    const a = auth(req);
    if (!a) return reply.code(401).send({ error: 'unauthorized' });
    return store.users.get(a.sub) ?? reply.code(404).send({ error: 'not found' });
  });

  /** Single authorization gate: authenticate, then PolicyEngine.can(actor, action, ctx). */
  const can = (req: FastifyRequest, reply: FastifyReply, action: Action, ctx: PolicyContext = {}): TokenPayload | undefined => {
    const a = auth(req);
    if (!a) { reply.code(401).send({ error: 'unauthorized' }); return undefined; }
    const decision = policy.can(actorOf(a), action, { organizationId: a.orgId, ...ctx });
    if (!decision.allow) { reply.code(403).send({ error: 'forbidden', reason: decision.reason }); return undefined; }
    return a;
  };
  /** Tenant scope for list endpoints: undefined = all (platform-admin), else the caller's org. */
  const scope = (a: TokenPayload): string | undefined => (a.role === 'platform-admin' ? undefined : a.orgId);

  // ---- reference data ----
  app.get('/api/organizations', async (req, reply) => {
    const a = can(req, reply, 'organization.read'); if (!a) return;
    const org = scope(a);
    return [...store.orgs.values()].filter((o) => !org || o.id === org);
  });
  app.get('/api/users', async (req, reply) => {
    const a = can(req, reply, 'organization.read'); if (!a) return;
    const org = scope(a);
    return [...store.users.values()].filter((u) => !org || u.orgId === org);
  });

  // ---- assets & telemetry ----
  app.get('/api/assets', async (req, reply) => {
    const a = can(req, reply, 'asset.read'); if (!a) return;
    const org = scope(a);
    return [...store.assets.values()].filter((x) => !org || x.orgId === org);
  });
  app.get('/api/assets/:id', async (req, reply) => {
    const a = can(req, reply, 'asset.read'); if (!a) return;
    const asset = store.assets.get((req.params as { id: string }).id);
    if (!asset) return reply.code(404).send({ error: 'not found' });
    if (scope(a) && asset.orgId !== a.orgId) return reply.code(404).send({ error: 'not found' });
    return asset;
  });
  app.get('/api/telemetry/:assetId', async (req, reply) => {
    const a = can(req, reply, 'telemetry.read'); if (!a) return;
    const { assetId } = req.params as { assetId: string };
    const asset = store.assets.get(assetId);
    if (scope(a) && asset && asset.orgId !== a.orgId) return reply.code(404).send({ error: 'not found' });
    const { from, to } = req.query as { from?: string; to?: string };
    return repos.telemetryHistory.history(assetId, from ? Number(from) : undefined, to ? Number(to) : undefined);
  });

  // ---- incidents ----
  app.get('/api/incidents', async (req, reply) => {
    const a = can(req, reply, 'incident.read'); if (!a) return;
    const org = scope(a);
    return [...store.incidents.values()].filter((i) => !org || i.orgId === org);
  });
  app.post('/api/incidents', async (req, reply) => {
    const a = can(req, reply, 'incident.create'); if (!a) return;
    const body = req.body as { title: string; type: string; severity: 'info' | 'minor' | 'major' | 'critical'; location?: { lat: number; lon: number }; description?: string };
    const inc = store.addIncident(body);
    store.addAudit({ actorId: a.sub, action: 'incident.create', resourceType: 'incident', resourceId: inc.id, sourceIp: req.ip, newValue: inc });
    bus.publish(envelope('incident.created', inc));
    bus.publish(envelope('event', store.addEvent('incident.created', `Incident: ${inc.title}`, inc.id, inc.severity === 'critical' ? 'critical' : 'warning')));
    return reply.code(201).send(inc);
  });
  app.patch('/api/incidents/:id', async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const before = store.incidents.get(id);
    const a = can(req, reply, 'incident.update', { resourceId: id, organizationId: before?.orgId }); if (!a) return;
    const patch = req.body as { status?: IncidentStatus; note?: string };
    const inc = store.updateIncident(id, { status: patch.status }, patch.note);
    if (!inc) return reply.code(404).send({ error: 'not found' });
    store.addAudit({ actorId: a.sub, action: 'incident.update', resourceType: 'incident', resourceId: id, sourceIp: req.ip, previousValue: before?.status, newValue: inc.status });
    bus.publish(envelope('incident.updated', inc));
    return inc;
  });

  // ---- tasks ----
  app.get('/api/tasks', async (req, reply) => {
    const a = can(req, reply, 'task.read'); if (!a) return;
    const org = scope(a);
    return [...store.tasks.values()].filter((t) => !org || t.orgId === org);
  });
  app.post('/api/tasks', async (req, reply) => {
    const a = can(req, reply, 'task.create'); if (!a) return;
    const task = store.addTask(req.body as Parameters<typeof store.addTask>[0]);
    store.addAudit({ actorId: a.sub, action: 'task.create', resourceType: 'task', resourceId: task.id, sourceIp: req.ip, newValue: task });
    bus.publish(envelope('task.created', task));
    return reply.code(201).send(task);
  });
  app.patch('/api/tasks/:id', async (req, reply) => {
    const a = can(req, reply, 'task.update'); if (!a) return;
    const id = (req.params as { id: string }).id;
    const task = store.updateTask(id, req.body as object);
    if (!task) return reply.code(404).send({ error: 'not found' });
    store.addAudit({ actorId: a.sub, action: 'task.update', resourceType: 'task', resourceId: id, sourceIp: req.ip, newValue: task });
    bus.publish(envelope('task.updated', task));
    return task;
  });

  // ---- alerts ----
  app.get('/api/alerts', async (req, reply) => {
    const a = can(req, reply, 'alert.read'); if (!a) return;
    const org = scope(a);
    return [...store.alerts.values()].filter((x) => !org || x.orgId === org).sort((x, y) => y.createdAt - x.createdAt);
  });
  app.post('/api/alerts/:id/ack', async (req, reply) => {
    const a = can(req, reply, 'alert.ack'); if (!a) return;
    const id = (req.params as { id: string }).id;
    const notes = (req.body as { notes?: string } | undefined)?.notes;
    const alert = store.ackAlert(id, a.sub, notes);
    if (!alert) return reply.code(404).send({ error: 'not found' });
    store.addAudit({ actorId: a.sub, action: 'alert.ack', resourceType: 'alert', resourceId: id, sourceIp: req.ip });
    bus.publish(envelope('alert.acknowledged', alert));
    return alert;
  });

  // ---- operations / features / channels ----
  app.get('/api/operations', async (req, reply) => {
    const a = can(req, reply, 'operation.read'); if (!a) return;
    const org = scope(a);
    return [...store.operations.values()].filter((o) => !org || o.organizationId === org);
  });
  app.get('/api/telemetry/channels', async (req, reply) => can(req, reply, 'telemetry.read') && store.channels);

  app.get('/api/features', async (req, reply) => {
    const a = can(req, reply, 'feature.read'); if (!a) return;
    const opId = (req.query as { operationId?: string }).operationId;
    const org = scope(a);
    return [...store.features.values()].filter((f) => (!opId || f.operationId === opId) && (!org || f.orgId === org));
  });
  app.post('/api/features', async (req, reply) => {
    const a = can(req, reply, 'feature.create'); if (!a) return;
    const feat = store.addFeature(req.body as Parameters<typeof store.addFeature>[0]);
    store.addAudit({ actorId: a.sub, action: 'feature.create', resourceType: 'feature', resourceId: feat.id, operationId: feat.operationId, sourceIp: req.ip, newValue: feat });
    bus.publish(envelope('feature.created', feat));
    return reply.code(201).send(feat);
  });
  app.patch('/api/features/:id', async (req, reply) => {
    const a = can(req, reply, 'feature.update'); if (!a) return;
    const feat = store.updateFeature((req.params as { id: string }).id, req.body as object);
    if (!feat) return reply.code(404).send({ error: 'not found' });
    store.addAudit({ actorId: a.sub, action: 'feature.update', resourceType: 'feature', resourceId: feat.id, operationId: feat.operationId, sourceIp: req.ip });
    bus.publish(envelope('feature.updated', feat));
    return feat;
  });
  app.delete('/api/features/:id', async (req, reply) => {
    const a = can(req, reply, 'feature.delete'); if (!a) return;
    const id = (req.params as { id: string }).id;
    const feat = store.features.get(id);
    if (!store.deleteFeature(id)) return reply.code(404).send({ error: 'not found' });
    store.addAudit({ actorId: a.sub, action: 'feature.delete', resourceType: 'feature', resourceId: id, operationId: feat?.operationId, sourceIp: req.ip });
    bus.publish(envelope('feature.deleted', { id, operationId: feat?.operationId ?? '' }));
    return reply.code(204).send();
  });

  // ---- raw journal ----
  app.get('/api/raw-events', async (req, reply) => {
    const a = can(req, reply, 'raw.read'); if (!a) return;
    const limit = Number((req.query as { limit?: string }).limit ?? 100);
    return store.rawEvents.slice(-limit).reverse();
  });
  app.get('/api/raw-events/by-correlation/:cid', async (req, reply) => {
    const a = can(req, reply, 'raw.read'); if (!a) return;
    return repos.rawEvents.byCorrelation((req.params as { cid: string }).cid);
  });
  app.post('/api/raw-events/reprocess', async (req, reply) => {
    const a = can(req, reply, 'raw.reprocess'); if (!a) return;
    store.addAudit({ actorId: a.sub, action: 'raw.reprocess', resourceType: 'journal', sourceIp: req.ip });
    return { journaled: store.rawEvents.length, note: 'reprocess is a Phase-2 batch job (journal is retained for replay)' };
  });

  // ---- recognized operational picture / tracks / observations (Phase B) ----
  app.get('/api/operational-picture', async (req, reply) => {
    const a = can(req, reply, 'picture.read'); if (!a) return;
    const f = parsePictureFilter(req.query as Record<string, string | undefined>);
    if (scope(a)) f.organizationId = a.orgId;   // force tenant scope for non-admins
    return buildOperationalPicture(store, f);
  });
  app.get('/api/tracks', async (req, reply) => {
    const a = can(req, reply, 'track.read'); if (!a) return;
    const { state } = req.query as { state?: string };
    const org = scope(a);
    return [...store.tracks.values()].filter((t) => (!state || t.state === state) && (!org || t.organizationId === org));
  });
  app.get('/api/observations', async (req, reply) => {
    const a = can(req, reply, 'observation.read'); if (!a) return;
    const limit = Number((req.query as { limit?: string }).limit ?? 100);
    const org = scope(a);
    return store.observations.filter((o) => !org || o.organizationId === org).slice(-limit).reverse();
  });

  // ---- schema registry + quarantine (data quality) ----
  app.get('/api/schemas', async (req, reply) => can(req, reply, 'schema.read') && listSchemas());
  app.get('/api/quarantine', async (req, reply) => {
    const a = can(req, reply, 'quarantine.read'); if (!a) return;
    const limit = Number((req.query as { limit?: string }).limit ?? 100);
    return store.quarantine.slice(-limit).reverse();
  });

  // ---- events / map / audit / integrations ----
  app.get('/api/events', async (req, reply) => {
    const a = can(req, reply, 'incident.read'); if (!a) return;
    const org = scope(a);
    return store.events.filter((e) => !org || e.orgId === org);
  });
  app.get('/api/map/geofences', async (req, reply) => {
    const a = can(req, reply, 'feature.read'); if (!a) return;
    const org = scope(a);
    return [...store.geofences.values()].filter((g) => !org || g.orgId === org);
  });
  app.get('/api/map/routes', async (req, reply) => {
    const a = can(req, reply, 'feature.read'); if (!a) return;
    const org = scope(a);
    return [...store.routes.values()].filter((r) => !org || r.orgId === org);
  });
  app.get('/api/audit', async (req, reply) => {
    const a = can(req, reply, 'audit.read'); if (!a) return;
    const org = scope(a);
    return store.audit.filter((x) => !org || x.organizationId === org);
  });
  app.get('/api/integrations', async (req, reply) => can(req, reply, 'asset.read') && ([
    { kind: 'skynode', name: 'Skynode/PX4 Simulator', status: 'active' },
    { kind: 'generic-fleet', name: 'Generic Fleet Simulator', status: 'active' },
    { kind: 'tak', name: 'TAK Interop (CoT)', status: 'available' },
    { kind: 'mavlink', name: 'Generic MAVLink', status: 'scaffold' },
    { kind: 'video', name: 'Video (RTSP/WebRTC/HLS)', status: 'scaffold' },
    { kind: 'openmct', name: 'Open MCT telemetry feed', status: 'available' },
  ]));
}
