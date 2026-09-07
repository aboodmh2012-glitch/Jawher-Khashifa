// AI Gateway: one safe boundary between future model providers and operational data.
// Current implementation is deterministic/read-only. A future local/cloud LLM may
// consume the prepared context, but it still must use the same approved tool layer.

import type { IntelligenceCore } from './intelligence-core.js';
import { AIToolRegistry, type ToolCall, type ToolContext, type ToolResult } from './ai-tools.js';
import { OperationalKnowledgeIndex, type KnowledgeHit } from './knowledge-index.js';
import { getAgentProfile, listAgentProfiles, type AgentKind } from './ai-agents.js';
import type { Store } from './store.js';

export interface GatewayRequest {
  organizationId: string;
  operationId?: string;
  userId?: string;
  agent?: AgentKind;
  question?: string;
  tools?: ToolCall[];
  knowledgeLimit?: number;
}

export interface GatewayResponse {
  generatedAt: number;
  agent: string;
  mode: 'deterministic-read-only';
  question?: string;
  guidance: string[];
  knowledge: KnowledgeHit[];
  toolResults: ToolResult[];
  summary: string;
  evidenceIds: string[];
}

export class AIGateway {
  readonly tools: AIToolRegistry;
  readonly knowledge: OperationalKnowledgeIndex;

  constructor(private store: Store, private intelligence: IntelligenceCore) {
    this.tools = new AIToolRegistry(store, intelligence);
    this.knowledge = new OperationalKnowledgeIndex(store, intelligence);
  }

  agents() { return listAgentProfiles(); }

  run(request: GatewayRequest): GatewayResponse {
    const profile = getAgentProfile(request.agent ?? 'operations') ?? getAgentProfile('operations')!;
    const ctx: ToolContext = {
      organizationId: request.organizationId,
      operationId: request.operationId,
      userId: request.userId,
    };

    const explicit = request.tools ?? [];
    const safeCalls = explicit.filter((call) => profile.allowedTools.includes(call.name));
    if (!safeCalls.length) safeCalls.push({ name: 'get_operational_brief' });

    const toolResults = safeCalls.map((call) => this.tools.call(ctx, call));
    const knowledge = request.question
      ? this.knowledge.search(request.organizationId, request.question, request.operationId, request.knowledgeLimit ?? 10)
      : [];

    const briefResult = toolResults.find((r) => r.tool === 'get_operational_brief' && r.ok)?.data as { summary?: string; evidenceIds?: string[] } | undefined;
    const evidenceIds = new Set<string>(briefResult?.evidenceIds ?? []);
    for (const hit of knowledge) if (hit.kind === 'evidence') evidenceIds.add(hit.id);

    const summary = briefResult?.summary ?? this.fallbackSummary(request.organizationId, request.operationId);
    return {
      generatedAt: Date.now(),
      agent: profile.id,
      mode: 'deterministic-read-only',
      question: request.question,
      guidance: profile.guidance,
      knowledge,
      toolResults,
      summary,
      evidenceIds: [...evidenceIds].slice(0, 100),
    };
  }

  private fallbackSummary(organizationId: string, operationId?: string): string {
    const brief = this.intelligence.brief(organizationId, operationId);
    return brief.summary;
  }
}
