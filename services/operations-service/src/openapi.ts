// Hand-authored OpenAPI 3.1 document (§18). Served at GET /api/openapi.json.
// Kept dependency-free for a reliably-bootable MVP; can be replaced by
// @fastify/swagger generation later.

export const openApiSpec = {
  openapi: '3.1.0',
  info: { title: 'Fusion Operations Platform API', version: '0.1.0', description: 'Operations & situational-awareness backend (MVP).' },
  servers: [{ url: 'http://localhost:4000' }],
  components: {
    securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } },
  },
  security: [{ bearerAuth: [] }],
  paths: {
    '/health': { get: { summary: 'Liveness', security: [], responses: { 200: { description: 'ok' } } } },
    '/api/auth/login': { post: { summary: 'Login (demo: any password)', security: [], responses: { 200: { description: 'token + user' }, 401: { description: 'invalid' } } } },
    '/api/auth/me': { get: { summary: 'Current user' } },
    '/api/assets': { get: { summary: 'List assets' } },
    '/api/assets/{id}': { get: { summary: 'Get asset' } },
    '/api/telemetry/{assetId}': { get: { summary: 'Telemetry history', parameters: [{ name: 'from', in: 'query' }, { name: 'to', in: 'query' }] } },
    '/api/incidents': { get: { summary: 'List incidents' }, post: { summary: 'Create incident (operator+)' } },
    '/api/incidents/{id}': { patch: { summary: 'Update incident (operator+)' } },
    '/api/tasks': { get: { summary: 'List tasks' }, post: { summary: 'Create task (operator+)' } },
    '/api/tasks/{id}': { patch: { summary: 'Update task (operator+)' } },
    '/api/alerts': { get: { summary: 'List alerts' } },
    '/api/alerts/{id}/ack': { post: { summary: 'Acknowledge alert (operator+)' } },
    '/api/events': { get: { summary: 'Recent events' } },
    '/api/map/geofences': { get: { summary: 'List geofences' } },
    '/api/map/routes': { get: { summary: 'List routes' } },
    '/api/audit': { get: { summary: 'Audit log (supervisor+)' } },
    '/api/integrations': { get: { summary: 'Adapter/integration status' } },
  },
} as const;
