import type { FastifyInstance } from 'fastify';
import type { WebSocket } from '@fastify/websocket';
import type { Store } from './store.js';
import type { Bus } from './bus.js';
import { authenticate } from './auth.js';
import { config } from './config.js';

// Authenticate in the first frame: no access tokens in URLs, logs or history.
export function registerRealtime(app: FastifyInstance, store: Store, bus: Bus): void {
  const clients = new Map<WebSocket, number>();
  const sockets = new Set<WebSocket>();
  const unsubscribe = bus.subscribe(msg => {
    const data = JSON.stringify(msg);
    for (const [ws, expires] of clients) {
      if (expires <= Date.now()) { clients.delete(ws); ws.close(1008, 'Session expired'); }
      else if (ws.bufferedAmount > 1024 * 1024) { clients.delete(ws); ws.close(1013, 'Reconnect for snapshot'); }
      else if (ws.readyState === ws.OPEN) ws.send(data);
    }
  });
  app.get('/ws', { websocket: true, preValidation: async (req, reply) => {
    if (req.headers.origin && !config.corsOrigin.includes(req.headers.origin)) {
      return reply.code(403).send({ error: 'origin forbidden' });
    }
  } }, socket => {
    sockets.add(socket);
    let authenticating = false;
    const timeout = setTimeout(() => socket.close(1008, 'Authentication required'), 5000);
    let expiry: ReturnType<typeof setTimeout> | undefined;
    socket.on('message', async (data: { toString(): string }) => {
      if (clients.has(socket) || authenticating) { socket.close(1008, 'Unexpected message'); return; }
      authenticating = true;
      try {
        const frame = JSON.parse(data.toString());
        const identity = frame.type === 'auth' && typeof frame.token === 'string' ? await authenticate(frame.token) : null;
        if (!identity || identity.orgId !== store.orgId) { socket.close(1008, 'Unauthorized'); return; }
        if (socket.readyState !== socket.OPEN) return;
        clearTimeout(timeout);
        clients.set(socket, identity.exp);
        // Poll for expiry even when the bus is idle; avoids long-timer overflow.
        expiry = setInterval(() => {
          if (Date.now() >= identity.exp) { clients.delete(socket); socket.close(1008, 'Session expired'); }
        }, 1000);
        socket.send(JSON.stringify({ topic: 'snapshot', ts: Date.now(), payload: store.snapshot() }));
      } catch { socket.close(1008, 'Invalid authentication frame'); }
    });
    const cleanup = () => { clearTimeout(timeout); clearInterval(expiry); clients.delete(socket); sockets.delete(socket); };
    socket.on('close', cleanup); socket.on('error', cleanup);
  });
  app.addHook('preClose', async () => { unsubscribe(); for (const socket of sockets) socket.terminate(); });
}
