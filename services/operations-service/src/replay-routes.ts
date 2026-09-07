import type { FastifyInstance, FastifyRequest } from 'fastify';
import { policy } from '@fusion/authorization';
import type { Store } from './store.js';
import { verifyToken } from './auth.js';
import { buildReplayFrame } from './replay.js';

function bearer(req: FastifyRequest): string | undefined {
  const header = req.headers.authorization;
  return header?.startsWith('Bearer ') ? header.slice(7) : undefined;
}

/** Authenticated, tenant-scoped, read-only historical picture. */
export function registerReplayRoutes(app: FastifyInstance, store: Store): void {
  app.get('/api/replay', async (req, reply) => {
    const token = verifyToken(bearer(req));
    if (!token) return reply.code(401).send({ error: 'unauthorized' });

    const decision = policy.can(
      { userId: token.sub, role: token.role, organizationId: token.orgId },
      'picture.read',
      { organizationId: token.orgId },
    );
    if (!decision.allow) return reply.code(403).send({ error: 'forbidden', reason: decision.reason });

    const q = req.query as { at?: string; windowMs?: string; operationId?: string };
    const at = q.at ? Number(q.at) : Date.now();
    const windowMs = q.windowMs ? Number(q.windowMs) : undefined;
    if (!Number.isFinite(at) || (windowMs != null && !Number.isFinite(windowMs))) {
      return reply.code(400).send({ error: 'invalid replay time/window' });
    }

    return buildReplayFrame(store, {
      organizationId: token.orgId,
      operationId: q.operationId,
      at,
      windowMs,
    });
  });
}
