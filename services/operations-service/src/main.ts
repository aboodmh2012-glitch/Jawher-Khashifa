// Fusion Operations Platform — operations-service bootstrap.
// REST + WebSocket + in-memory store + demo simulators. Starts with no database
// so the MVP command center runs from `npm run dev` alone (§30).

import Fastify from 'fastify';
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
import { createMemoryRepositories } from './repositories.js';

async function main() {
  const app = Fastify({ logger: { level: 'info', transport: undefined } });
  await app.register(cors, { origin: config.corsOrigin });
  await app.register(websocket);

  const store = new Store(config.defaultOrgId);
  const bus = createBus();
  const alerts = new AlertEngine(store, bus);
  const repositories = createMemoryRepositories(store);

  seedDemo(store);
  registerRoutes(app, store, bus, repositories);
  registerRealtime(app, store, bus);
  const stopAdapters = startAdapters(store, bus, alerts);

  // Link-state sweep (§21): age out silent assets and drive comms-lost alerts.
  const sweep = setInterval(() => {
    for (const asset of store.refreshLinkStates()) {
      bus.publish(envelope('asset.health', { assetId: asset.id, health: asset.health }));
      alerts.commsLost(asset);
    }
  }, 4000);

  const close = async () => { clearInterval(sweep); stopAdapters(); await app.close(); process.exit(0); };
  process.on('SIGINT', close);
  process.on('SIGTERM', close);

  await app.listen({ port: config.port, host: config.host });
  app.log.info(`Fusion operations-service listening on http://${config.host}:${config.port}`);
  app.log.info(`Demo mode: ${config.sim.enabled ? 'ON' : 'OFF'} — login with any password as: supervisor / operator / analyst / admin`);
}

main().catch((err) => { console.error(err); process.exit(1); });
