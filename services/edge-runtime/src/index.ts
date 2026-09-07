import type { EdgeCursor, EdgeRuntimeStatus } from '@fusion/platform-contracts';

export interface EdgeEvent<T = unknown> {
  id: string;
  source: string;
  sequence: number;
  occurredAt: number;
  receivedAt: number;
  payload: T;
}

export interface EdgeJournal {
  append(event: EdgeEvent): Promise<void>;
  readAfter(source: string, sequence: number, limit: number): Promise<EdgeEvent[]>;
  pendingCount(): Promise<number>;
}

export interface SyncTransport {
  connected(): boolean;
  push(events: EdgeEvent[]): Promise<{ acceptedThrough: Record<string, number> }>;
}

export class MemoryEdgeJournal implements EdgeJournal {
  private readonly events: EdgeEvent[] = [];

  async append(event: EdgeEvent): Promise<void> {
    const duplicate = this.events.some((item) => item.source === event.source && item.sequence === event.sequence);
    if (!duplicate) this.events.push(event);
  }

  async readAfter(source: string, sequence: number, limit: number): Promise<EdgeEvent[]> {
    return this.events
      .filter((event) => event.source === source && event.sequence > sequence)
      .sort((a, b) => a.sequence - b.sequence)
      .slice(0, limit);
  }

  async pendingCount(): Promise<number> {
    return this.events.length;
  }
}

export class EdgeRuntime {
  private readonly cursors = new Map<string, EdgeCursor>();
  private state: EdgeRuntimeStatus['state'] = 'starting';
  private lastSyncAt?: number;

  constructor(
    readonly nodeId: string,
    private readonly journal: EdgeJournal,
    private readonly transport: SyncTransport,
  ) {}

  async ingest(event: EdgeEvent): Promise<void> {
    // Journal first. Edge data must survive an unavailable upstream connection.
    await this.journal.append(event);
    this.state = this.transport.connected() ? 'online' : 'degraded';
  }

  async sync(source: string, batchSize = 250): Promise<number> {
    if (!this.transport.connected()) {
      this.state = 'degraded';
      return 0;
    }

    const cursor = this.cursors.get(source)?.sequence ?? 0;
    const batch = await this.journal.readAfter(source, cursor, batchSize);
    if (batch.length === 0) {
      this.state = 'online';
      return 0;
    }

    const result = await this.transport.push(batch);
    const accepted = result.acceptedThrough[source];
    if (accepted != null && accepted > cursor) {
      this.cursors.set(source, { source, sequence: accepted, updatedAt: Date.now() });
    }
    this.lastSyncAt = Date.now();
    this.state = 'online';
    return batch.length;
  }

  async status(): Promise<EdgeRuntimeStatus> {
    return {
      nodeId: this.nodeId,
      state: this.state,
      connected: this.transport.connected(),
      queueDepth: await this.journal.pendingCount(),
      lastSyncAt: this.lastSyncAt,
      cursors: [...this.cursors.values()],
    };
  }
}
