// Approved read-only tool registry for AI/agent consumers.
// Models never receive direct Store/database access. Every tool is tenant scoped,
// deterministic, JSON-serializable, and incapable of mutation.

import type { Store } from './store.js';
import type { IntelligenceCore } from './intelligence-core.js';
import { buildReplayFrame } from './replay.js';

export interface ToolContext {
  organizationId: string;
  operationId?: string;
  userId?: string;
}

export interface ToolCall {
  name: string;
  args?: Record<string, unknown>;
}

export interface ToolResult {
  tool: string;
  ok: boolean;
  data?: unknown;
  error?: string;
}

export interface ReadOnlyTool {
  name: string;
  description: string;
  execute(ctx: ToolContext, args: Record<string, unknown>): unknown;
}

function str(v: unknown): string | undefined { return typeof v === 'string' ? v : undefined; }
function num(v: unknown): number | undefined { return typeof v === 'number' && Number.isFinite(v) ? v : undefined; }

export class AIToolRegistry {
  private tools = new Map<string, ReadOnlyTool>();

  constructor(private store: Store, private intelligence: IntelligenceCore) {
    this.registerDefaults();
  }

  list(): Array<Pick<ReadOnlyTool, 'name' | 'description'>> {
    return [...this.tools.values()].map(({ name, description }) => ({ name, description }));
  }

  call(ctx: ToolContext, call: ToolCall): ToolResult {
    const tool = this.tools.get(call.name);
    if (!tool) return { tool: call.name, ok: false, error: 'unknown tool' };
    try {
      return { tool: call.name, ok: true, data: tool.execute(ctx, call.args ?? {}) };
    } catch (error) {
      return { tool: call.name, ok: false, error: error instanceof Error ? error.message : 'tool failed' };
    }
  }

  private add(tool: ReadOnlyTool): void { this.tools.set(tool.name, tool); }

  private registerDefaults(): void {
    this.add({
      name: 'get_operational_brief',
      description: 'Evidence-linked operational and data-quality summary.',
      execute: (ctx) => this.intelligence.brief(ctx.organizationId, ctx.operationId),
    });
    this.add({
      name: 'list_incidents',
      description: 'List active incidents in the caller organization.',
      execute: (ctx) => [...this.store.incidents.values()].filter((x) => x.orgId === ctx.organizationId && x.status !== 'closed'),
    });
    this.add({
      name: 'list_alerts',
      description: 'List unresolved alerts in the caller organization.',
      execute: (ctx) => [...this.store.alerts.values()].filter((x) => x.orgId === ctx.organizationId && x.status !== 'resolved'),
    });
    this.add({
      name: 'list_sensors',
      description: 'List known sensor/source registry records and health.',
      execute: (ctx) => { this.intelligence.refreshSensorStates(); return this.intelligence.listSensors(ctx.organizationId, ctx.operationId); },
    });
    this.add({
      name: 'list_tracks',
      description: 'List fused situational-awareness tracks with confidence and provenance.',
      execute: (ctx) => [...this.store.tracks.values()].filter((x) => x.organizationId === ctx.organizationId && (!ctx.operationId || x.operationId === ctx.operationId)),
    });
    this.add({
      name: 'get_track_history',
      description: 'Get bounded historical snapshots of a track.',
      execute: (ctx, args) => {
        const trackId = str(args.trackId); if (!trackId) throw new Error('trackId required');
        return this.intelligence.trackHistory(trackId, ctx.organizationId, Math.min(num(args.limit) ?? 100, 500));
      },
    });
    this.add({
      name: 'get_recent_evidence',
      description: 'Get recent evidence/provenance records.',
      execute: (ctx, args) => this.intelligence.recentEvidence(ctx.organizationId, ctx.operationId, Math.min(num(args.limit) ?? 50, 200)),
    });
    this.add({
      name: 'get_replay_frame',
      description: 'Reconstruct a read-only historical operational frame from observations.',
      execute: (ctx, args) => buildReplayFrame(this.store, {
        organizationId: ctx.organizationId,
        operationId: ctx.operationId,
        at: num(args.at) ?? Date.now(),
        windowMs: num(args.windowMs),
      }),
    });
    this.add({
      name: 'search_operational_data',
      description: 'Search assets, incidents, alerts, operations, tracks, and sensors.',
      execute: (ctx, args) => {
        const q = (str(args.query) ?? '').trim().toLowerCase();
        if (q.length < 2) throw new Error('query must contain at least 2 characters');
        const org = ctx.organizationId;
        return {
          assets: [...this.store.assets.values()].filter((x) => x.orgId === org && `${x.name} ${x.type} ${(x.tags ?? []).join(' ')}`.toLowerCase().includes(q)).slice(0, 20),
          incidents: [...this.store.incidents.values()].filter((x) => x.orgId === org && `${x.title} ${x.type} ${x.description ?? ''}`.toLowerCase().includes(q)).slice(0, 20),
          alerts: [...this.store.alerts.values()].filter((x) => x.orgId === org && `${x.message} ${x.sourceName ?? ''} ${x.kind}`.toLowerCase().includes(q)).slice(0, 20),
          operations: [...this.store.operations.values()].filter((x) => x.organizationId === org && `${x.name} ${x.description ?? ''}`.toLowerCase().includes(q)).slice(0, 20),
          tracks: [...this.store.tracks.values()].filter((x) => x.organizationId === org && `${x.classification} ${x.identity ?? ''} ${x.state}`.toLowerCase().includes(q)).slice(0, 20),
          sensors: this.intelligence.listSensors(org).filter((x) => `${x.name} ${x.kind} ${x.sourceId}`.toLowerCase().includes(q)).slice(0, 20),
        };
      },
    });
  }
}
