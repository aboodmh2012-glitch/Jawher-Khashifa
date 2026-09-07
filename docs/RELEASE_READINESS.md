# Reliability increment — release readiness

Baseline reviewed: `22b25997bbb5c08e7691774c4c0e5357c9071451` (default branch, 7 September 2026).
Status: reviewable foundation increment; not a final production release.

## Implemented and tested

- Demo login verifies a password, rejects missing/incorrect credentials and limits attempts per IP. Demo tokens have strict shape/expiry validation and a generated secret when unset. Production rejects demo mode.
- OIDC access tokens: JOSE verification against configured JWKS, explicit issuer/audience, RS256 or ES256, required subject/expiry/issued-at/role/orgId. Browser authorization-code flow uses PKCE through oidc-client-ts; no browser client secret. Tokens remain in session storage, which is still accessible to same-origin JavaScript.
- One organization per backend process. Every protected REST route and WS authentication rejects a token from another organization, including platform-admin. Shared multi-tenant hosting is not implemented.
- WebSockets receive no snapshot or events before a valid first authentication frame. No URL bearer tokens. Origin allowlist, five-second auth deadline, 20 KiB frame cap, expiry closure and 1 MiB outgoing buffer threshold. Reconnect uses backoff; logout clears data and stops reconnecting.
- Runtime body schemas reject extra fields, identity/organization overrides, bad enum values and malformed geometry. Feature PATCH requires expectedVersion; conflict returns 409. Notes-only incident updates preserve status, and audit records retain previous values.
- Late telemetry remains in bounded sorted history without changing newer current state. Samples are deduplicated by asset/device/source timestamp within that history window. Invalid position/time and far-future source timestamps are rejected. Receive time drives connection freshness. This is not an exactly-once delivery system.
- File checkpoints restore domain state, bounded history, journal index, and audit index. Original raw messages and audit records are appended/fsynced into daily JSONL files. Restored alerts rebuild their active-rule index.
- Link recovery clears communication alerts, low-battery escalation reopens an acknowledged alert, and geofence holes are excluded.
- `/api/insights` and Operations brief UI provide deterministic, read-only checks with record IDs: stale links, stale source time, critical incidents and overdue work. Provider is explicitly `rules-v1`; no local language model has been installed.
- Snapshot now includes tasks and link-state changes are propagated to clients. Unimplemented bus drivers fail startup; unimplemented reprocessing returns 501.

## Persistence guarantees and limits

`DATA_DIR` enables one-process file storage. The writer lock is local-host/PID based;
never share the directory between hosts, containers with separate PID namespaces,
or replicas. A live lock is rejected; a dead local writer's lock is reclaimed.
The directory and files should live on a persistent local filesystem with backups.
Do not use network filesystems for this driver.

Successful REST writes are checkpointed before HTTP acknowledgement. Telemetry
checkpoints run every second. Source/audit appends are fsynced before returning to
the producer. A hard crash between telemetry checkpoints can lose the latest
**derived** state; raw archives retain source data. There is no automatic archive
reprocessing yet, so archived data is not automatically applied on restart.
Mutations, audit entries, and bus publications do not form a database transaction.
A failed write can have an uncertain outcome; do not blindly retry creates.

In-memory limits remain: 600 telemetry samples per asset, 2,000 indexed raw events,
1,000 indexed audit entries, 500 timeline events. Files contain additional archive
records, but API range queries do not scan them. Daily archives need operator-managed
retention and backup. File appends/checkpoints block the Node event loop; this driver
is for a small single-node pilot and must be replaced before high-rate ingestion.

## Identity setup and remaining verification

The Keycloak realm contains a public `fusion-web` client with PKCE S256,
audience `fusion-api`, and user-attribute mappers for `orgId` and `role`.
Configure these attributes as **administrator-editable only** in Keycloak User
Profile; assign exactly one supported application role. Never allow end users to
set these claims. Remove wildcards and use exact deployment redirect/origin URLs.
Existing realms need the corresponding client/mappers updated; importing a realm
file does not automatically update an existing realm.

Production startup guards require OIDC, HTTPS identity endpoints and origins,
DATA_DIR, ORGANIZATION_ID, and no simulators. These guards are not a production
certification. The deployment still needs HTTPS/WSS termination, short-lived access
tokens, IdP account lifecycle/MFA, gateway rate limits, backup/restore rehearsal,
and a real-browser login/logout test against the target Keycloak realm.
Token revocation is not immediate: valid JWTs remain usable until expiration.

## Validation evidence

- TypeScript checks: backend and frontend passed.
- Vite production bundle: passed; large MapLibre-containing bundle warning remains.
- Node suite: 12 tests passed, covering HTTP auth/RBAC/org isolation, WS first-frame
  auth, hostile origins, OIDC signed tokens, schema rejection, conflicts, ordering,
  alert recovery, persistence, immutable audit snapshots and evidence-only insights.
- Browser visual QA was attempted but the cloud browser rejected the localhost
  preview with `ERR_BLOCKED_BY_CLIENT`; no visual/end-to-end browser pass is claimed.
- No hardware, real Keycloak realm, PostgreSQL/NATS transport, load test or
  disaster-recovery exercise has been completed in this increment.

## Blockers for the final platform

1. Transactional PostgreSQL/PostGIS persistence, migrations, RLS and tenant isolation tests; transactional outbox with durable event IDs/cursors and idempotent consumers.
2. Real telemetry-only adapter transports, source authentication, reconnect lifecycle and captured-fixture/hardware acceptance tests.
3. Replay jobs with parser versions, quarantine/dead-letter handling and bounded asynchronous archival/retention.
4. Media session brokerage, team communications, full incident/task workflows and operations ownership across resources.
5. Offline client persistence/synchronization after durable realtime and local store stabilize; conflict policy, tombstones and scope-bound cursors.
6. Signed app manifests, process isolation, capabilities, quotas and audited install/upgrade/rollback before arbitrary app loading.
7. A separate local inference service, licensed domain model and curated knowledge corpus, retrieval authorization, evidence citations, refusal/abstention evaluation and no write tools.
8. Arabic/RTL/mobile/accessibility implementation, browser tests, dependency/security review, telemetry load/soak and recovery testing, monitoring and operating runbooks.

## Sources consulted

- [OWASP WebSocket security](https://cheatsheetseries.owasp.org/cheatsheets/WebSocket_Security_Cheat_Sheet.html): explicit authentication, origin checks and bounded connections.
- [OWASP authentication](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html): protect sign-in and session handling.
- [Keycloak JavaScript guide](https://www.keycloak.org/securing-apps/javascript-adapter): public clients and narrowly configured redirects/origins.
- [NATS JetStream](https://docs.nats.io/concepts/jetstream): durable replay and at-least-once delivery; consumers need duplicate handling.
- [PostgreSQL row security](https://www.postgresql.org/docs/current/ddl-rowsecurity.html): policies for future shared tenancy.
- [MAVSDK telemetry](https://mavsdk.mavlink.io/main/en/cpp/api_reference/classmavsdk_1_1_telemetry.html): telemetry-only integration boundary.
- [llama.cpp server](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md) and [grammars](https://github.com/ggml-org/llama.cpp/blob/master/grammars/README.md): separate local inference and constrained output; grammar is not a factuality or safety guarantee.
- [OpenTelemetry signals](https://opentelemetry.io/docs/concepts/signals/): target tracing, metrics and logs.
