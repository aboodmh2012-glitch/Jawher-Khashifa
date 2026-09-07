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
import { FilePersistence } from './persistence.js';

export async function buildApp(options: { store?: Store; simulation?: boolean; dataDir?: string; logger?: boolean } = {}) {
  const app = Fastify({ logger: options.logger ?? false, bodyLimit: 256 * 1024,
    ajv: { customOptions: { removeAdditional: false, coerceTypes: false } } });
  await app.register(cors, { origin: config.corsOrigin });
  await app.register(websocket, { options: { maxPayload: 20 * 1024 } });
  const store = options.store ?? new Store(config.defaultOrgId);
  const dataDir = options.dataDir ?? config.dataDir;
  const persistence = dataDir ? new FilePersistence(dataDir, store, config.authMode) : undefined;
  if (!persistence?.restore() && !options.store && config.authMode === 'demo') seedDemo(store);
  if (config.authMode === 'oidc') store.users.clear(); // IdP owns identities, never seed demo users
  persistence?.checkpoint();
  if (persistence) store.setJournal((kind, value) => persistence.append(kind, value));
  const bus = createBus();
  const alerts = new AlertEngine(store, bus);
  registerRoutes(app, store, bus);
  registerRealtime(app, store, bus);
  // Successful REST mutations are checkpointed before acknowledging the response.
  app.addHook('onSend', async (request, reply, payload) => {
    if (persistence && ['POST','PATCH','DELETE'].includes(request.method) && reply.statusCode < 400) persistence.checkpoint();
    return payload;
  });
  const stop = options.simulation === false ? () => {} : startAdapters(store, bus, alerts);
  const timer = setInterval(() => {
    for (const asset of store.refreshLinkStates()) {
      bus.publish(envelope('asset.health', { assetId: asset.id, health: asset.health, link: asset.link }));
      alerts.commsLost(asset);
    }
    try { persistence?.checkpoint(); }
    catch (error) { app.log.fatal(error, 'Checkpoint failed; stopping ingestion'); stop(); clearInterval(timer); void app.close(); }
  }, 1000);
  app.addHook('onClose', async () => { clearInterval(timer); stop(); persistence?.close(); });
  return { app, store, bus, alerts };
}
