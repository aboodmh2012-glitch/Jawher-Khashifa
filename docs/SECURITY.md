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

### Roles (RBAC) & the PolicyEngine

`platform-admin > org-admin > ops-supervisor > operator > analyst > field-user > viewer`.

Authorization is centralized in **`@fusion/authorization`** — a single
`PolicyEngine.can(actor, action, ctx)` with a capability registry
(`action → minimum role`), not role `if`-statements scattered across routes.
Every endpoint calls one `can(req, reply, action, ctx)` gate. Reads need
`*.read`; mutations need `operator+`; `audit.read`/`raw.reprocess` need
`ops-supervisor+`; `observation/raw/quarantine.read` need `analyst+`.

### Tenant isolation (§C2)

`organizationId` propagates through the domain. The PolicyEngine denies
cross-organization actions unless the actor is `platform-admin`, and every list
endpoint is filtered to the caller's organization server-side (never trust the
frontend). The Realtime Gateway only delivers an event to a connection whose
organization matches. PostgreSQL Row-Level Security is the Phase-D reinforcement.

## Audit V2 (§C4)

Every sensitive action writes an append-only `AuditLog` entry: `auditId`,
`timestamp`, `actorId`, `actorType`, `action`, `resourceType`, `resourceId`,
`organizationId`, optional `operationId`/`correlationId`, `previousValue`,
`newValue`, `sourceIp`, and `result`. Sensitive values (token/password/secret/
key/jwt, recursively) are **redacted** before storage. Exposed at
`GET /api/audit` (supervisor+), tenant-filtered.

## Realtime Gateway V2 (§C1)

The WebSocket gateway authenticates on connect (token; bad token → close 4401),
scopes every connection to its organization, stamps a monotonic **server
sequence** on each event, buffers a resume ring (clients `RESUME` from a seq),
runs heartbeat **ping/pong** with disconnect detection, applies **backpressure**
(drops when the socket buffer is saturated) and inbound **rate limiting**, and
supports `SUBSCRIBE`/`UNSUBSCRIBE` narrowing by organization/operation/asset/
track/type. A cross-organization event is never delivered to another tenant.

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
