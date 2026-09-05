// Internal event bus (§17). A thin abstraction over an in-process EventEmitter
// for the MVP ("memory" driver). Swap the implementation for NATS or MQTT later
// without changing publishers/subscribers — they only depend on this interface.

import { EventEmitter } from 'node:events';
import type { ServerMessage } from '@fusion/event-contracts';

export interface Bus {
  publish(msg: ServerMessage): void;
  subscribe(handler: (msg: ServerMessage) => void): () => void;
}

class MemoryBus implements Bus {
  private ee = new EventEmitter();
  constructor() { this.ee.setMaxListeners(1000); }
  publish(msg: ServerMessage): void { this.ee.emit('msg', msg); }
  subscribe(handler: (msg: ServerMessage) => void): () => void {
    this.ee.on('msg', handler);
    return () => this.ee.off('msg', handler);
  }
}

export function createBus(driver = process.env.BUS_DRIVER ?? 'memory'): Bus {
  // 'nats' | 'mqtt' drivers plug in here in Phase 7.
  if (driver !== 'memory') {
    console.warn(`[bus] driver '${driver}' not bundled in MVP; using memory bus.`);
  }
  return new MemoryBus();
}
