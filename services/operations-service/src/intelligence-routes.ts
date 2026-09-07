import type { FastifyInstance, FastifyRequest } from 'fastify';
import { policy } from '@fusion/authorization';
import type { Store } from './store.js';
import type { IntelligenceCore } from './intelligence-core.js';
import { verifyToken } from './auth.js';

function bearer(req: FastifyRequest): string | undefined {
  const header = req.headers.authorization;
  return header?.startsWith('Bearer ') ? header.slice(7) : undefined;
}

function authorizePicture(req: FastifyRequest) {
  const token = verifyToken(bearer(req));
  if (!token) return { token: null, reason: 'unauthorized' } as const;
  const decision = policy.can(
    { userId: token.sub, role: token.role, organizationId: token.orgId },
    'picture.read',
    { organizationId: token.orgId },
  );
  return decision.allow ? { token, reason: null } as const : { token: null, reason: decision.reason ?? 'forbidden' } as const;
}

function text(v: unknown): string { return typeof v === 'string' ? v.toLowerCase() : ''; }

/**
 * Read-only Intelligence API. All outputs are evidence-linked and tenant scoped.
 * It provides deterministic decision support; it cannot execute operational actions.
 */
export function registerIntelligenceRoutes(app: FastifyInstance, store: Store, intelligence: IntelligenceCore): void {
  app.get('/api/intelligence/brief', async (req, reply) => {
    const auth = authorizePicture(req);
    if (!auth.token) return reply.code(auth.reason === 'unauthorized' ? 401 : 403).send({ error: auth.reason });
    const { operationId } = req.query as { operationId?: string };
    return intelligence.brief(auth.token.orgId, operationId);
  });

  app.get('/api/intelligence/sensors', async (req, reply) => {
    const auth = authorizePicture(req);
    if (!auth.token) return reply.code(auth.reason === 'unauthorized' ? 401 : 403).send({ error: auth.reason });
    const { operationId } = req.query as { operationId?: string };
    intelligence.refreshSensorStates();
    return intelligence.listSensors(auth.token.orgId, operationId);
  });

  app.get('/api/intelligence/evidence', async (req, reply) => {
    const auth = authorizePicture(req);
    if (!auth.token) return reply.code(auth.reason === 'unauthorized' ? 401 : 403).send({ error: auth.reason });
    const q = req.query as { operationId?: string; limit?: string };
    const limit = q.limit ? Number(q.limit) : 100;
    if (!Number.isFinite(limit)) return reply.code(400).send({ error: 'invalid limit' });
    return intelligence.recentEvidence(auth.token.orgId, q.operationId, limit);
  });

  app.get('/api/intelligence/evidence/:id', async (req, reply) => {
    const auth = authorizePicture(req);
    if (!auth.token) return reply.code(auth.reason === 'unauthorized' ? 401 : 403).send({ error: auth.reason });
    const evidence = intelligence.evidenceById((req.params as { id: string }).id);
    if (!evidence || evidence.organizationId !== auth.token.orgId) return reply.code(404).send({ error: 'not found' });
    return evidence;
  });

  app.get('/api/intelligence/tracks/:id/history', async (req, reply) => {
    const auth = authorizePicture(req);
    if (!auth.token) return reply.code(auth.reason === 'unauthorized' ? 401 : 403).send({ error: auth.reason });
    const q = req.query as { limit?: string };
    const limit = q.limit ? Number(q.limit) : 200;
    if (!Number.isFinite(limit)) return reply.code(400).send({ error: 'invalid limit' });
    return intelligence.trackHistory((req.params as { id: string }).id, auth.token.orgId, limit);
  });

  // Unified read-only search across the operational model. This is deliberately
  // deterministic so a future LLM can call it as an approved tool rather than
  // receiving direct database access.
  app.get('/api/intelligence/search', async (req, reply) => {
    const auth = authorizePicture(req);
    if (!auth.token) return reply.code(auth.reason === 'unauthorized' ? 401 : 403).send({ error: auth.reason });
    const q = text((req.query as { q?: string }).q).trim();
    if (q.length < 2) return reply.code(400).send({ error: 'q must contain at least 2 characters' });
    const orgId = auth.token.orgId;

    const assets = [...store.assets.values()].filter((x) => x.orgId === orgId && `${x.name} ${x.type} ${(x.tags ?? []).join(' ')}`.toLowerCase().includes(q)).slice(0, 20);
    const incidents = [...store.incidents.values()].filter((x) => x.orgId === orgId && `${x.title} ${x.type} ${x.description ?? ''}`.toLowerCase().includes(q)).slice(0, 20);
    const alerts = [...store.alerts.values()].filter((x) => x.orgId === orgId && `${x.message} ${x.sourceName ?? ''} ${x.kind}`.toLowerCase().includes(q)).slice(0, 20);
    const operations = [...store.operations.values()].filter((x) => x.organizationId === orgId && `${x.name} ${x.description ?? ''}`.toLowerCase().includes(q)).slice(0, 20);
    const tracks = [...store.tracks.values()].filter((x) => x.organizationId === orgId && `${x.classification} ${x.identity ?? ''} ${x.state}`.toLowerCase().includes(q)).slice(0, 20);
    const sensors = intelligence.listSensors(orgId).filter((x) => `${x.name} ${x.kind} ${x.sourceId}`.toLowerCase().includes(q)).slice(0, 20);

    return { query: q, assets, incidents, alerts, operations, tracks, sensors };
  });

  // Narrow natural-language-like query surface for UI/agents. It maps requests
  // to approved read-only tools; no arbitrary SQL, code execution, or mutations.
  app.post('/api/intelligence/query', async (req, reply) => {
    const auth = authorizePicture(req);
    if (!auth.token) return reply.code(auth.reason === 'unauthorized' ? 401 : 403).send({ error: auth.reason });
    const body = (req.body ?? {}) as { intent?: string; operationId?: string; query?: string };
    const intent = body.intent ?? 'brief';
    if (intent === 'brief' || intent === 'status' || intent === 'quality') {
      return { intent, result: intelligence.brief(auth.token.orgId, body.operationId) };
    }
    if (intent === 'incidents') {
      return { intent, result: [...store.incidents.values()].filter((x) => x.orgId === auth.token!.orgId && x.status !== 'closed') };
    }
    if (intent === 'alerts') {
      return { intent, result: [...store.alerts.values()].filter((x) => x.orgId === auth.token!.orgId && x.status !== 'resolved') };
    }
    if (intent === 'sensors') {
      intelligence.refreshSensorStates();
      return { intent, result: intelligence.listSensors(auth.token.orgId, body.operationId) };
    }
    if (intent === 'search') {
      const q = text(body.query).trim();
      if (q.length < 2) return reply.code(400).send({ error: 'query must contain at least 2 characters' });
      const assets = [...store.assets.values()].filter((x) => x.orgId === auth.token!.orgId && `${x.name} ${x.type}`.toLowerCase().includes(q)).slice(0, 20);
      const incidents = [...store.incidents.values()].filter((x) => x.orgId === auth.token!.orgId && `${x.title} ${x.description ?? ''}`.toLowerCase().includes(q)).slice(0, 20);
      return { intent, query: q, result: { assets, incidents } };
    }
    return reply.code(400).send({ error: 'unsupported intent', allowed: ['brief', 'status', 'quality', 'incidents', 'alerts', 'sensors', 'search'] });
  });
}
