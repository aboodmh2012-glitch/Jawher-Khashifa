// Realtime Gateway V2 (§C1). Authenticated WebSocket with per-connection tenant
// scoping, server sequence numbers, a resume ring buffer, heartbeat ping/pong,
// backpressure, and rate limiting. Backward compatible: a client that just
// listens (no SUBSCRIBE) receives its organization's events by default and still
// sees `{topic:'snapshot'}` then domain envelopes — the current Command Center
// keeps working; it only additionally replies to heartbeat pings.

import type { FastifyInstance } from 'fastify';
import type { WebSocket } from '@fastify/websocket';
import type { ServerMessage, SnapshotMsg, ClientMessage, SubscriptionChannel } from '@fusion/event-contracts';
import { verifyToken } from './auth.js';
import { metrics } from '@fusion/observability';
import type { Store } from './store.js';
import type { Bus } from './bus.js';

const HEARTBEAT_MS = 20_000;
const PONG_TIMEOUT_MS = 65_000;
const RING = 500;                 // resume buffer depth
const BUFFER_LIMIT = 1_000_000;   // backpressure: drop sends above this bufferedAmount
const RATE_LIMIT = 40;            // inbound client messages per 5s window

interface Conn {
  ws: WebSocket;
  org: string;
  role: string;
  channels: SubscriptionChannel[] | null; // null = default (whole org)
  lastPong: number;
  window: { count: number; start: number };
}

function orgOf(msg: ServerMessage): string | undefined {
  return (msg as { organizationId?: string }).organizationId;
}

export function registerRealtime(app: FastifyInstance, store: Store, bus: Bus): void {
  const clients = new Set<Conn>();
  let seq = 0;
  const ring: Array<{ seq: number; org?: string; data: string; msg: ServerMessage }> = [];
  const gClients = metrics.gauge('realtime_clients', 'connected realtime clients');
  const cDropped = metrics.counter('realtime_dropped_messages_total', 'messages dropped by backpressure');

  bus.subscribe((msg) => {
    seq += 1;
    (msg as { sequence?: number }).sequence = seq; // stamp server sequence
    const org = orgOf(msg);
    const data = JSON.stringify(msg);
    ring.push({ seq, org, data, msg });
    if (ring.length > RING) ring.shift();
    for (const c of clients) if (visible(c, msg, org)) safeSend(c, data);
  });

  function visible(c: Conn, msg: ServerMessage, org?: string): boolean {
    if (org && org !== c.org) return false;            // tenant isolation
    if (!c.channels) return true;                       // default = whole org
    const type = (msg as { type?: string }).type;
    const assetId = (msg as { assetId?: string }).assetId;
    const operationId = (msg as { operationId?: string }).operationId;
    return c.channels.some((ch) => {
      switch (ch.kind) {
        case 'organization': return !ch.id || ch.id === c.org;
        case 'type': return ch.value === type;
        case 'asset': return ch.id === assetId;
        case 'operation': return ch.id === operationId;
        case 'track': return !!type?.startsWith('track.') && ch.id === (msg as { payload?: { id?: string } }).payload?.id;
        default: return false;
      }
    });
  }

  function safeSend(c: Conn, data: string): void {
    if (c.ws.readyState !== c.ws.OPEN) return;
    if ((c.ws.bufferedAmount ?? 0) > BUFFER_LIMIT) { cDropped.inc(); return; } // backpressure — drop
    try { c.ws.send(data); } catch { /* ignore */ }
  }

  app.get('/ws', { websocket: true }, (socket: WebSocket, req) => {
    const token = (req.query as { token?: string })?.token;
    const payload = verifyToken(token);
    if (!payload) {
      try { socket.send(JSON.stringify({ topic: 'error', message: 'unauthorized' })); } catch { /* ignore */ }
      socket.close(4401, 'unauthorized');
      return;
    }
    const conn: Conn = {
      ws: socket, org: payload.orgId, role: payload.role, channels: null,
      lastPong: Date.now(), window: { count: 0, start: Date.now() },
    };
    clients.add(conn);
    gClients.set(clients.size);

    const snap: SnapshotMsg & { snapshotVersion?: number } = { topic: 'snapshot', ts: Date.now(), payload: store.snapshot(), snapshotVersion: seq };
    try { socket.send(JSON.stringify(snap)); } catch { /* ignore */ }

    socket.on('message', (raw: Buffer) => {
      const now = Date.now();
      if (now - conn.window.start > 5000) conn.window = { count: 0, start: now };
      if (++conn.window.count > RATE_LIMIT) return;      // rate limit
      let m: ClientMessage;
      try { m = JSON.parse(raw.toString()); } catch { return; }
      handle(conn, m);
    });
    socket.on('close', () => { clients.delete(conn); gClients.set(clients.size); });
    socket.on('error', () => { clients.delete(conn); gClients.set(clients.size); });
  });

  function handle(conn: Conn, m: ClientMessage): void {
    switch (m.type) {
      case 'ping': safeSend(conn, JSON.stringify({ topic: 'pong', ts: Date.now() })); break;
      case 'pong': conn.lastPong = Date.now(); break;
      case 'subscribe': conn.channels = (conn.channels ?? []).concat(m.channels); break;
      case 'unsubscribe':
        if (conn.channels) {
          conn.channels = conn.channels.filter((c) => !m.channels.some((x) => x.kind === c.kind && x.id === c.id && x.value === c.value));
        }
        break;
      case 'resume':
        for (const e of ring) if (e.seq > m.fromSeq && visible(conn, e.msg, e.org)) safeSend(conn, e.data);
        break;
      case 'ack': break; // memory gateway: no durable offset to advance
      default: break;
    }
  }

  const hb = setInterval(() => {
    const now = Date.now();
    for (const c of [...clients]) {
      if (now - c.lastPong > PONG_TIMEOUT_MS) { try { c.ws.close(4408, 'heartbeat timeout'); } catch { /* ignore */ } clients.delete(c); continue; }
      safeSend(c, JSON.stringify({ topic: 'ping', ts: now }));
    }
  }, HEARTBEAT_MS);
  app.addHook('onClose', async () => clearInterval(hb));
}
