import './env.js';
import { randomBytes } from 'node:crypto';

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const production = env.NODE_ENV === 'production';
  const authMode = env.AUTH_MODE ?? (production ? 'oidc' : 'demo');
  if (!['demo', 'oidc'].includes(authMode)) throw new Error('Unsupported AUTH_MODE');
  if (production && authMode !== 'oidc') throw new Error('Production requires OIDC');
  const corsOrigin = (env.CORS_ORIGIN ?? 'http://localhost:5173').split(',').map(x => x.trim());
  for (const origin of corsOrigin) {
    const url = new URL(origin);
    if (url.origin !== origin || (production && url.protocol !== 'https:')) throw new Error('CORS_ORIGIN must contain exact web origins (HTTPS in production)');
  }
  if (authMode === 'oidc' && (!env.OIDC_ISSUER || !env.OIDC_AUDIENCE || !env.OIDC_JWKS_URL)) {
    throw new Error('OIDC requires OIDC_ISSUER, OIDC_AUDIENCE and OIDC_JWKS_URL');
  }
  if (production && (!env.DATA_DIR || !env.ORGANIZATION_ID)) throw new Error('Production requires DATA_DIR and ORGANIZATION_ID');
  if (production && (env.SIM_ENABLED === 'true' || ![env.OIDC_ISSUER, env.OIDC_JWKS_URL].every(x => x?.startsWith('https://')))) {
    throw new Error('Production forbids simulators and requires HTTPS identity endpoints');
  }
  return {
    production, authMode, corsOrigin,
    port: Number(env.API_PORT ?? 4000), host: env.API_HOST ?? '127.0.0.1',
    jwtSecret: env.JWT_SECRET ?? randomBytes(32).toString('hex'),
    demoPassword: env.DEMO_PASSWORD ?? 'demo',
    oidcIssuer: env.OIDC_ISSUER, oidcAudience: env.OIDC_AUDIENCE, oidcJwksUrl: env.OIDC_JWKS_URL,
    dataDir: env.DATA_DIR,
    sim: { enabled: (env.SIM_ENABLED ?? (authMode === 'demo' ? 'true' : 'false')) === 'true',
      uavCount: Number(env.SIM_ASSET_COUNT ?? 5),
      center: { lat: Number(env.SIM_CENTER_LAT ?? 24.47), lon: Number(env.SIM_CENTER_LON ?? 54.37) } },
    defaultOrgId: env.ORGANIZATION_ID ?? 'org-demo',
  };
}
export const config = loadConfig();
