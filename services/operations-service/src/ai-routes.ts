import type { FastifyInstance, FastifyRequest } from 'fastify';
import { policy } from '@fusion/authorization';
import { verifyToken } from './auth.js';
import type { AIGateway } from './ai-gateway.js';
import type { AgentKind } from './ai-agents.js';
import type { ToolCall } from './ai-tools.js';

function bearer(req: FastifyRequest): string | undefined {
  const header = req.headers.authorization;
  return header?.startsWith('Bearer ') ? header.slice(7) : undefined;
}

function authorize(req: FastifyRequest) {
  const token = verifyToken(bearer(req));
  if (!token) return { token: null, reason: 'unauthorized' } as const;
  const decision = policy.can(
    { userId: token.sub, role: token.role, organizationId: token.orgId },
    'picture.read',
    { organizationId: token.orgId },
  );
  return decision.allow ? { token, reason: null } as const : { token: null, reason: decision.reason ?? 'forbidden' } as const;
}

/** Read-only AI boundary. No arbitrary provider prompt can bypass tool permissions. */
export function registerAIRoutes(app: FastifyInstance, gateway: AIGateway): void {
  app.get('/api/ai/agents', async (req, reply) => {
    const auth = authorize(req);
    if (!auth.token) return reply.code(auth.reason === 'unauthorized' ? 401 : 403).send({ error: auth.reason });
    return gateway.agents();
  });

  app.get('/api/ai/tools', async (req, reply) => {
    const auth = authorize(req);
    if (!auth.token) return reply.code(auth.reason === 'unauthorized' ? 401 : 403).send({ error: auth.reason });
    return gateway.tools.list();
  });

  app.get('/api/ai/knowledge', async (req, reply) => {
    const auth = authorize(req);
    if (!auth.token) return reply.code(auth.reason === 'unauthorized' ? 401 : 403).send({ error: auth.reason });
    const q = req.query as { q?: string; operationId?: string; limit?: string };
    const query = (q.q ?? '').trim();
    if (query.length < 2) return reply.code(400).send({ error: 'q must contain at least 2 characters' });
    const limit = q.limit ? Number(q.limit) : 12;
    if (!Number.isFinite(limit)) return reply.code(400).send({ error: 'invalid limit' });
    return gateway.knowledge.search(auth.token.orgId, query, q.operationId, limit);
  });

  app.post('/api/ai/query', async (req, reply) => {
    const auth = authorize(req);
    if (!auth.token) return reply.code(auth.reason === 'unauthorized' ? 401 : 403).send({ error: auth.reason });
    const body = (req.body ?? {}) as {
      agent?: AgentKind;
      operationId?: string;
      question?: string;
      tools?: ToolCall[];
      knowledgeLimit?: number;
    };
    if (body.question != null && typeof body.question !== 'string') return reply.code(400).send({ error: 'question must be a string' });
    if (body.tools != null && !Array.isArray(body.tools)) return reply.code(400).send({ error: 'tools must be an array' });
    return gateway.run({
      organizationId: auth.token.orgId,
      operationId: body.operationId,
      userId: auth.token.sub,
      agent: body.agent,
      question: body.question,
      tools: body.tools,
      knowledgeLimit: body.knowledgeLimit,
    });
  });
}
