# Development and pilot deployment

Requires Node 20.12+ (Node 22 recommended for the validation environment).

```bash
npm ci
cp .env.example .env
npm run dev
```

API: http://localhost:4000. Web: http://localhost:5173.
Demo accounts: supervisor, operator, analyst, admin. Default password: demo.
The root .env is loaded by the API and Vite; existing process environment takes
precedence. DATA_DIR is resolved relative to the API working directory. Prefer
an absolute DATA_DIR for deployed services. Without it all state is volatile.

```bash
npm run typecheck
npm test
npm run build
npm run start -w @fusion/operations-service
```

For a restricted single-node pilot, set AUTH_MODE=oidc, SIM_ENABLED=false,
ORGANIZATION_ID, OIDC_ISSUER, OIDC_AUDIENCE=fusion-api, OIDC_JWKS_URL and a dedicated
absolute DATA_DIR. Set VITE_OIDC_ISSUER and VITE_OIDC_CLIENT_ID=fusion-web and rebuild.
Provision the IdP account with administrator-managed orgId/role claims. The browser
uses PKCE and returns to its origin root path; subpath hosting is not supported by
the current callback configuration. Deployment-specific public origins and exact
callback URLs must match the Keycloak client. No OIDC client secret goes in Vite.

With NODE_ENV=production the service requires HTTPS identity/origin URLs and rejects
demo auth/simulators. Put API and web behind HTTPS/WSS ingress. Configure API_HOST
explicitly if a container must bind beyond loopback. Use one backend writer per
DATA_DIR; file persistence does not support replicas. Review all limitations and
release gates in [RELEASE_READINESS.md](RELEASE_READINESS.md).

Optional development infrastructure:

```bash
npm run infra:up
npm run infra:down
```

The compose file starts PostgreSQL/PostGIS, TimescaleDB, Keycloak, NATS and MinIO.
Only the OIDC connection is implemented in this increment. Starting a container or
setting DATABASE_URL/NATS_URL does not implement a driver. BUS_DRIVER must remain
memory; other values fail explicitly. Never deploy compose default credentials.
