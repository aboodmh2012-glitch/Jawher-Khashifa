// Fusion Operations Platform — operations-service bootstrap.
// REST + WebSocket + in-memory store + demo simulators. Starts with no database
// so the MVP command center runs from `npm run dev` alone.

import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import { envelope } from '@fusion/event-contracts';
import { config } from './config.js';
import { Store } from './store.js';
import { createBus } from './bus.js';
import { AlertEngine } from './alerts.js';
import { registerRoutes } from './routes.js';
import { registerRealtime } from './realtime.js';
import { startAdapters } from './adapters.js';
import { seedDemo } from './seed.js';
import { createRepositories } from './repositories.js';
import { FusionService } from './fusion.js';
import { metrics } from '@fusion/observability';

export interface BuiltApp {
  app: FastifyInstance;
  store: Store;
  dispose: () => Promise<void>;
}

/** Build the fully-wired app WITHOUT listening — used by main() and by tests
 *  (via app.inject), so REST/health invariants can be tested without a socket. */
export async function buildApp(): Promise<BuiltApp> {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } });
  const state = { ready: false };

  await app.register(cors, { origin: config.corsOrigin });
  await app.register(websocket);

  // API latency + request counters (§D3).
  const reqs = metrics.counter('api_requests_total', 'HTTP requests handled');
  const latency = metrics.histogram('api_request_duration_ms', 'HTTP request duration (ms)');
  app.addHook('onResponse', async (req, reply) => {
    reqs.inc(1, { method: req.method, status: String(reply.statusCode) });
    latency.observe(reply.elapsedTime, { method: req.method });
  });

  const busDriver = process.env.BUS_DRIVER ?? 'memory';
  const repoDriver = process.env.REPO_DRIVER ?? 'memory';

  // Health (infra-level). Live = process up. Ready = critical deps initialized.
  app.get('/health/live', async () => ({ status: 'live', ts: Date.now() }));
  app.get('/health/ready', async (_req, reply) => {
    if (!state.ready) return reply.code(503).send({ status: 'starting', ts: Date.now() });
    return {
      status: 'ready', ts: Date.now(),
      checks: {
        store: store.assets.size >= 0 ? 'ok' : 'fail',
        bus: `ok (${busDriver})`,
        repositories: `ok (${repoDriver})`,
        metrics: 'ok',
        mode: config.sim.enabled ? 'demo-memory' : 'live',
      },
    };
  });
  // Prometheus metrics (unauthenticated scrape endpoint, like /health).
  app.get('/metrics', async (_req, reply) => {
    reply.header('content-type', 'text/plain; version=0.0.4');
    return metrics.render();
  });

  const store = new Store(config.defaultOrgId);
  const bus = createBus(busDriver);
  const alerts = new AlertEngine(store, bus);
  const fusion = new FusionService(store, bus);
  const repositories = createRepositories(store, repoDriver);

  seedDemo(store);
  registerRoutes(app, store, bus, repositories);
  registerRealtime(app, store, bus);
  const stopAdapters = startAdapters(store, bus, alerts, fusion);

  // Periodic sweep: age out silent assets (comms-lost alerts) and age tracks
  // through coasting → lost → archived.
  const gTracks = metrics.gauge('track_count', 'active tracks');
  const gStale = metrics.gauge('stale_assets', 'assets not currently live');
  const gAssets = metrics.gauge('asset_count', 'known assets');
  const sweep = setInterval(() => {
    for (const asset of store.refreshLinkStates()) {
      bus.publish(envelope('asset.health', { assetId: asset.id, health: asset.health }));
      alerts.commsLost(asset);
    }
    fusion.sweep();
    gTracks.set(store.tracks.size);
    gAssets.set(store.assets.size);
    gStale.set([...store.assets.values()].filter((a) => a.link !== 'live').length);
  }, 4000);

  await app.ready();
  state.ready = true;

  const dispose = async () => { clearInterval(sweep); stopAdapters(); await app.close(); };
  return { app, store, dispose };
}

async function main() {
  const { app, dispose } = await buildApp();
  const close = async () => { await dispose(); process.exit(0); };
  process.on('SIGINT', close);
  process.on('SIGTERM', close);

  await app.listen({ port: config.port, host: config.host });
  app.log.info(`Fusion operations-service listening on http://${config.host}:${config.port}`);
  app.log.info(`Demo mode: ${config.sim.enabled ? 'ON' : 'OFF'} — login with any password as: supervisor / operator / analyst / admin`);
}

// Only start listening when executed directly (not when imported by tests).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
