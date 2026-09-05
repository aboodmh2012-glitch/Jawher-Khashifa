# Security

## Safety boundary (§28)

This platform is for **civilian** operations: emergency management, search &
rescue, inspection, mapping, fleet management, public safety, and infrastructure
monitoring. It deliberately does **not** implement, and must not be extended to
implement:

- weapon control or fire control
- weapon assignment or targeting
- strike planning or kinetic threat prioritization
- autonomous engagement

The TAK adapter emits **civilian affiliation symbology only** and carries no
weapon or engagement semantics.

## Identity & access (§14)

- **MVP:** a signed, expiring bearer token (`services/operations-service/src/auth.ts`)
  carries identity + role. Demo login accepts any password for the seeded users.
- **Production:** replace with **Keycloak / OIDC** (realm in
  `infrastructure/keycloak/`). Validate the IdP's JWT in the gateway instead of
  minting tokens.

### Roles (RBAC)

`platform-admin > org-admin > ops-supervisor > operator > analyst > field-user > viewer`.

Reads require any authenticated user; mutations (incidents, tasks, alert ack)
require **operator+**; the audit log requires **supervisor+**. Enforcement is in
`routes.ts` via `requireRole`.

## Audit (§14)

Every sensitive action writes an `AuditLog` entry: user, action, resource,
timestamp, IP/session when available, and previous/new values. Exposed at
`GET /api/audit` (supervisor+).

## Transport & secrets

- CORS is restricted to the configured web origin.
- Never commit credentials — use `.env` (git-ignored); `.env.example` documents
  the keys. Rotate `JWT_SECRET`, MinIO and database passwords before any real
  deployment.
- Terminate TLS at the gateway/ingress in production; the TAK connection uses
  mutual-TLS with client certificates.

## Degraded-network posture (§21)

Link state is surfaced explicitly (live/delayed/offline/unknown) so operators are
never shown stale data as if it were live. Client reconnects automatically and
rehydrates from a server snapshot.
