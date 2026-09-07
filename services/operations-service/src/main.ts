import { config } from './config.js';
import { buildApp } from './app.js';

async function main() {
  const { app } = await buildApp({ logger: true });
  const close = async () => { await app.close(); };
  process.once('SIGINT', close); process.once('SIGTERM', close);
  await app.listen({ port: config.port, host: config.host });
  app.log.info({ authMode: config.authMode, persistence: config.dataDir ? 'file-checkpoint' : 'memory', simulation: config.sim.enabled }, 'Runtime configuration');
}
main().catch(error => { console.error(error); process.exit(1); });
