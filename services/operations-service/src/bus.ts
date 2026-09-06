// Internal event bus (§17, §D1). Thin abstraction over an in-process EventEmitter
// for the MVP ("memory" driver) with eventId de-duplication (idempotency). Swap
// the implementation for NATS JetStream (see bus-nats.ts) without changing
// publishers/subscribers — they only depend on this interface.

import { EventEmitter } from 'node:events';
import { metrics } from '@fusion/observability';
import type { ServerMessage } from '@fusion/event-contracts';

export interface Bus {
  publish(msg: ServerMessage): void;
  subscribe(handler: (msg: ServerMessage) => void): () => void;
}

class MemoryBus implements Bus {
  private ee = new EventEmitter();
  private seen = new Set<string>();
  private order: string[] = [];
  private published = metrics.counter('event_bus_published_total', 'events published to the bus');
  private deduped = metrics.counter('event_bus_deduplicated_total', 'duplicate events dropped by eventId');

  constructor() { this.ee.setMaxListeners(1000); }

  publish(msg: ServerMessage): void {
    const id = (msg as { eventId?: string }).eventId;
    if (id) {
      if (this.seen.has(id)) { this.deduped.inc(); return; }   // idempotency
      this.seen.add(id);
      this.order.push(id);
      if (this.order.length > 5000) { const old = this.order.shift(); if (old) this.seen.delete(old); }
    }
    this.published.inc();
    this.ee.emit('msg', msg);
  }

  subscribe(handler: (msg: ServerMessage) => void): () => void {
    this.ee.on('msg', handler);
    return () => this.ee.off('msg', handler);
  }
}

export function createBus(driver = process.env.BUS_DRIVER ?? 'memory'): Bus {
  if (driver !== 'memory') {
    // Durable drivers (NATS JetStream) connect asynchronously — use
    // createNatsBus() from bus-nats.ts in production. Memory is the dev/test path.
    console.warn(`[bus] driver '${driver}' needs async setup (see bus-nats.ts); using memory bus.`);
  }
  return new MemoryBus();
}
