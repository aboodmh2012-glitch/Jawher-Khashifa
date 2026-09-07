// Lightweight token auth for the MVP (§14). A signed, expiring token — enough to
// carry identity + role for RBAC and audit. In production this is replaced by
// Keycloak / OIDC (validate the IdP's JWT here instead of minting our own).

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { User, Role } from '@fusion/shared-types';
import { config } from './config.js';

export interface TokenPayload { sub: string; role: Role; orgId: string; exp: number }

const b64 = (s: string) => Buffer.from(s).toString('base64url');
const unb64 = (s: string) => Buffer.from(s, 'base64url').toString('utf8');

function sign(body: string): string {
  return createHmac('sha256', config.jwtSecret).update(body).digest('base64url');
}

export function signToken(user: User, ttlMs = 8 * 3600_000): { token: string; expiresAt: number } {
  const exp = Date.now() + ttlMs;
  const payload: TokenPayload = { sub: user.username, role: user.role, orgId: user.orgId, exp };
  const body = b64(JSON.stringify(payload));
  return { token: `${body}.${sign(body)}`, expiresAt: exp };
}

export function verifyToken(token: string | undefined): TokenPayload | null {
  if (!token) return null;
  if (token.length > 8192 || token.split('.').length !== 2) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = sign(body);
  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(unb64(body)) as TokenPayload;
    if (!payload || typeof payload.sub !== 'string' || !payload.sub ||
        typeof payload.orgId !== 'string' || !payload.orgId ||
        !Object.hasOwn(RANK, payload.role) || !Number.isFinite(payload.exp) || payload.exp <= Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

/** Coarse role ranking for RBAC checks. */
const RANK: Record<Role, number> = {
  viewer: 0, 'field-user': 1, analyst: 2, operator: 3, 'ops-supervisor': 4, 'org-admin': 5, 'platform-admin': 6,
};
export function atLeast(role: Role, min: Role): boolean { return RANK[role] >= RANK[min]; }


// OIDC access tokens use asymmetric signatures and explicit audience/issuer checks.
import { createRemoteJWKSet, jwtVerify } from 'jose';
const jwks = config.oidcJwksUrl ? createRemoteJWKSet(new URL(config.oidcJwksUrl)) : undefined;
export async function authenticate(token: string | undefined): Promise<TokenPayload | null> {
  if (config.authMode === 'demo') return verifyToken(token);
  if (!token || token.length > 16384 || !jwks) return null;
  try {
    const { payload } = await jwtVerify(token, jwks, {
      issuer: config.oidcIssuer, audience: config.oidcAudience, algorithms: ['RS256', 'ES256'],
      requiredClaims: ['sub', 'exp', 'iat', 'orgId', 'role'],
    });
    if (typeof payload.sub !== 'string' || !payload.sub || typeof payload.orgId !== 'string' ||
        typeof payload.role !== 'string' || !Object.hasOwn(RANK, payload.role)) return null;
    return { sub: payload.sub, role: payload.role as Role, orgId: payload.orgId, exp: payload.exp! * 1000 };
  } catch { return null; }
}

export function validDemoPassword(password: unknown): boolean {
  if (typeof password !== 'string' || password.length > 1024) return false;
  const digest = (s: string) => createHmac('sha256', config.jwtSecret).update(s).digest();
  return timingSafeEqual(digest(password), digest(config.demoPassword));
}
