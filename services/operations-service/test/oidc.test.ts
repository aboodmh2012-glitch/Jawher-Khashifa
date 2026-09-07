import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';

test('OIDC verifies issuer, audience, signature, expiration and required application claims', async () => {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const key = { ...await exportJWK(publicKey), kid: 'test', alg: 'RS256', use: 'sig' };
  const server = createServer((_req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ keys: [key] })); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address() as { port: number };
  process.env.AUTH_MODE = 'oidc'; process.env.OIDC_ISSUER = 'https://identity.example/realms/fusion';
  process.env.OIDC_AUDIENCE = 'fusion-api'; process.env.OIDC_JWKS_URL = `http://127.0.0.1:${address.port}/jwks`;
  const { authenticate, signToken } = await import('../src/auth.js');
  const mint = (claims: Record<string, unknown> = {}, audience = 'fusion-api', expiry = '5m') => new SignJWT({ orgId: 'org-demo', role: 'operator', ...claims })
    .setProtectedHeader({ alg: 'RS256', kid: 'test' }).setIssuer(process.env.OIDC_ISSUER!)
    .setAudience(audience).setSubject('subject-1').setIssuedAt().setExpirationTime(expiry).sign(privateKey);
  try {
    assert.equal((await authenticate(await mint()))?.sub, 'subject-1');
    assert.equal(await authenticate(await mint({}, 'other-api')), null);
    assert.equal(await authenticate(await mint({ role: 'invented-role' })), null);
    assert.equal(await authenticate(await mint({ orgId: null })), null);
    assert.equal(await authenticate(await mint({}, 'fusion-api', '-1s')), null);
    assert.equal(await authenticate(signToken({ id: 'x', username: 'x', orgId: 'org-demo', role: 'operator', displayName: 'x' }).token), null);
  } finally { server.close(); await once(server, 'close'); }
});
