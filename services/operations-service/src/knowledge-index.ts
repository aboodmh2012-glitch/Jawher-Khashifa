// Lightweight RAG/knowledge foundation for operational awareness.
// This is a deterministic lexical index over tenant-scoped operational records.
// It deliberately avoids embeddings/provider lock-in; a vector backend can replace
// scoring later without changing the gateway contract.

import type { Store } from './store.js';
import type { IntelligenceCore } from './intelligence-core.js';

export type KnowledgeKind = 'asset' | 'incident' | 'alert' | 'operation' | 'track' | 'sensor' | 'evidence';

export interface KnowledgeHit {
  kind: KnowledgeKind;
  id: string;
  title: string;
  text: string;
  score: number;
  occurredAt?: number;
  refs?: string[];
}

function tokens(input: string): string[] {
  return [...new Set(input.toLowerCase().split(/[^\p{L}\p{N}_-]+/u).filter((x) => x.length >= 2))];
}

function scoreText(query: string[], text: string): number {
  const normalized = text.toLowerCase();
  let score = 0;
  for (const token of query) {
    if (normalized.includes(token)) score += 1;
    if (normalized.startsWith(token)) score += 0.25;
  }
  return score / Math.max(query.length, 1);
}

export class OperationalKnowledgeIndex {
  constructor(private store: Store, private intelligence: IntelligenceCore) {}

  search(organizationId: string, query: string, operationId?: string, limit = 12): KnowledgeHit[] {
    const q = tokens(query);
    if (!q.length) return [];
    const hits: KnowledgeHit[] = [];
    const add = (hit: Omit<KnowledgeHit, 'score'>) => {
      const score = scoreText(q, `${hit.title} ${hit.text}`);
      if (score > 0) hits.push({ ...hit, score });
    };

    for (const a of this.store.assets.values()) if (a.orgId === organizationId) {
      add({ kind: 'asset', id: a.id, title: a.name, text: `${a.type} ${a.link} ${a.health} ${(a.tags ?? []).join(' ')}`, occurredAt: a.lastSeen });
    }
    for (const i of this.store.incidents.values()) if (i.orgId === organizationId) {
      add({ kind: 'incident', id: i.id, title: i.title, text: `${i.type} ${i.severity} ${i.status} ${i.description ?? ''}`, occurredAt: i.updatedAt, refs: i.attachmentIds });
    }
    for (const a of this.store.alerts.values()) if (a.orgId === organizationId) {
      add({ kind: 'alert', id: a.id, title: a.sourceName ?? a.source, text: `${a.kind} ${a.severity} ${a.status} ${a.message}`, occurredAt: a.createdAt });
    }
    for (const o of this.store.operations.values()) if (o.organizationId === organizationId && (!operationId || o.id === operationId)) {
      add({ kind: 'operation', id: o.id, title: o.name, text: `${o.status} ${o.priority ?? ''} ${o.description ?? ''}`, occurredAt: o.createdAt });
    }
    for (const t of this.store.tracks.values()) if (t.organizationId === organizationId && (!operationId || t.operationId === operationId)) {
      add({ kind: 'track', id: t.id, title: t.identity ?? `Track ${t.id.slice(0, 8)}`, text: `${t.classification} ${t.state} confidence ${t.confidence.toFixed(2)} ${t.sourceIds?.join(' ') ?? ''}`, occurredAt: t.lastSeenAt, refs: t.observationIds });
    }
    for (const s of this.intelligence.listSensors(organizationId, operationId)) {
      add({ kind: 'sensor', id: s.id, title: s.name, text: `${s.kind} ${s.status} ${s.sourceId} ${s.capabilities.join(' ')}`, occurredAt: s.lastSeenAt });
    }
    for (const e of this.intelligence.recentEvidence(organizationId, operationId, 250)) {
      add({ kind: 'evidence', id: e.id, title: `${e.kind} evidence`, text: `${e.sourceId} ${e.sensorId ?? ''} confidence ${e.confidence.toFixed(2)}`, occurredAt: e.occurredAt, refs: [e.rawEventId, e.observationId].filter((x): x is string => !!x) });
    }

    return hits.sort((a, b) => b.score - a.score || (b.occurredAt ?? 0) - (a.occurredAt ?? 0)).slice(0, Math.max(1, Math.min(limit, 50)));
  }
}
