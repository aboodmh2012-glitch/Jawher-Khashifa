// NATS JetStream bus (§D1) — the production durable-bus seam. Persistent events,
// durable consumers, ACK, retry, replay and dedup are provided by JetStream.
//
// This is a scaffold behind the SAME Bus interface: no business service imports
// NATS directly. It lazy-imports `nats` so the dev/test build never needs it;
// wire it in production with `const bus = await createNatsBus(url, subject)`.
// It is intentionally NOT the default (memory bus is), and is not exercised in
// the demo — do not assume it is production-verified until run against a cluster.

import type { Bus } from './bus.js';
import type { ServerMessage } from '@fusion/event-contracts';

export interface NatsBusOptions {
  url?: string;         // nats://host:4222
  subject?: string;     // e.g. 'fusion.events'
  stream?: string;      // JetStream stream name
}

// Minimal structural types for the subset of `nats` we use (keeps this decoupled
// from the optional dependency's types).
interface StringCodecT { encode(s: string): Uint8Array; decode(d: Uint8Array): string }
interface NatsMsg { data: Uint8Array; ack(): void }
interface JetStreamT {
  publish(subject: string, data: Uint8Array, opts?: { msgID?: string }): Promise<unknown>;
  subscribe(subject: string, opts?: unknown): Promise<AsyncIterable<NatsMsg>>;
}
interface NatsConn { jetstream(): JetStreamT; drain(): Promise<void> }
interface NatsModule {
  connect(opts: { servers: string }): Promise<NatsConn>;
  StringCodec(): StringCodecT;
  default?: NatsModule;
}

export async function createNatsBus(opts: NatsBusOptions = {}): Promise<Bus> {
  // `nats` is an OPTIONAL runtime dependency — import via a non-literal specifier
  // so the dev/test typecheck never needs the package installed.
  let mod: NatsModule;
  try {
    mod = (await import('nats' as string)) as unknown as NatsModule;
  } catch {
    throw new Error("[bus-nats] the 'nats' package is not installed — run `npm i nats` to enable JetStream.");
  }
  const nats = (mod.default ?? mod) as NatsModule;
  const url = opts.url ?? process.env.NATS_URL ?? 'nats://localhost:4222';
  const subject = opts.subject ?? 'fusion.events';
  const nc = await nats.connect({ servers: url });
  const js = nc.jetstream();
  const sc = nats.StringCodec();

  return {
    publish(msg: ServerMessage): void {
      const id = (msg as { eventId?: string }).eventId;
      void js.publish(subject, sc.encode(JSON.stringify(msg)), id ? { msgID: id } : undefined);
    },
    subscribe(handler: (msg: ServerMessage) => void): () => void {
      let stop = false;
      (async () => {
        const sub = await js.subscribe(subject);
        for await (const m of sub) {
          if (stop) break;
          try { handler(JSON.parse(sc.decode(m.data)) as ServerMessage); } catch { /* ignore */ }
          m.ack();
        }
      })().catch((e) => console.error('[bus-nats] consumer error:', (e as Error).message));
      return () => { stop = true; void nc.drain(); };
    },
  };
}
