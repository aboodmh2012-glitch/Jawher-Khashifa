// WebSocket hub (§17). Every browser COP connects here, receives a snapshot to
// hydrate, then a live stream of typed envelopes from the internal bus.

import type { FastifyInstance } from 'fastify';
import type { WebSocket } from '@fastify/websocket';
import type { Store } from './store.js';
import type { Bus } from './bus.js';
import type { SnapshotMsg } from '@fusion/event-contracts';

export function registerRealtime(app: FastifyInstance, store: Store, bus: Bus): void {
  const clients = new Set<WebSocket>();

  bus.subscribe((msg) => {
    const data = JSON.stringify(msg);
    for (const ws of clients) {
      if (ws.readyState === ws.OPEN) ws.send(data);
    }
  });

  app.get('/ws', { websocket: true }, (socket: WebSocket) => {
    clients.add(socket);
    const snap: SnapshotMsg = { topic: 'snapshot', ts: Date.now(), payload: store.snapshot() };
    socket.send(JSON.stringify(snap));
    socket.on('close', () => clients.delete(socket));
    socket.on('error', () => clients.delete(socket));
  });
}
