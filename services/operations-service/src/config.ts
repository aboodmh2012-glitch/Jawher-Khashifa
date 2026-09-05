// Environment configuration for the operations-service.

export const config = {
  port: Number(process.env.API_PORT ?? 4000),
  host: process.env.API_HOST ?? '0.0.0.0',
  corsOrigin: process.env.CORS_ORIGIN ?? true, // reflect origin in dev
  jwtSecret: process.env.JWT_SECRET ?? 'dev-secret',
  sim: {
    enabled: (process.env.SIM_ENABLED ?? 'true') !== 'false',
    uavCount: Number(process.env.SIM_ASSET_COUNT ?? 5),
    center: {
      lat: Number(process.env.SIM_CENTER_LAT ?? 24.47),
      lon: Number(process.env.SIM_CENTER_LON ?? 54.37),
    },
  },
  defaultOrgId: 'org-demo',
};
