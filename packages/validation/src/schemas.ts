// Versioned runtime schemas. Compile-time TS types are NOT enough at trust
// boundaries — external/adapter payloads must be validated at runtime before
// they enter domain processing. Schemas are versioned (name.vN) so the wire
// format can evolve without breaking older producers.

import { z } from 'zod';

const geoPoint = z.object({
  lat: z.number().gte(-90).lte(90),
  lon: z.number().gte(-180).lte(180),
  altitude: z.number().optional(),
});

/** telemetry.v1 — the normalized, vendor-neutral telemetry sample. */
export const telemetryV1 = z.object({
  deviceId: z.string().min(1),
  assetId: z.string().min(1),
  timestamp: z.number().positive(),
  position: geoPoint,
  heading: z.number().optional(),
  groundSpeed: z.number().optional(),
  verticalSpeed: z.number().optional(),
  battery: z.object({ voltage: z.number().optional(), percentage: z.number().min(0).max(100).optional(), current: z.number().optional() }).optional(),
  linkQuality: z.number().min(0).max(100).optional(),
}).passthrough();

/** observation.v1 — one source's report at one time (Phase B populates it). */
export const observationV1 = z.object({
  id: z.string().min(1),
  sourceId: z.string().min(1),
  timestamp: z.number().positive(),
  position: geoPoint.optional(),
  confidence: z.number().min(0).max(1),
  rawEventId: z.string().optional(),
  correlationId: z.string().optional(),
}).passthrough();

/** track.v1 — fused understanding of an observed entity (Phase B). */
export const trackV1 = z.object({
  id: z.string().min(1),
  state: z.enum(['tentative', 'confirmed', 'coasting', 'lost', 'archived']),
  confidence: z.number().min(0).max(1),
  firstSeenAt: z.number().positive(),
  lastSeenAt: z.number().positive(),
}).passthrough();

/** feature.v1 — a canonical map annotation. */
export const featureV1 = z.object({
  operationId: z.string().min(1),
  type: z.string().min(1),
  geometryType: z.enum(['Point', 'LineString', 'Polygon', 'MultiPoint', 'MultiLineString', 'MultiPolygon']),
  coordinates: z.unknown(),
}).passthrough();

/** incident.v1 — an incident record. */
export const incidentV1 = z.object({
  title: z.string().min(1),
  type: z.string().min(1),
  severity: z.enum(['info', 'minor', 'major', 'critical']),
}).passthrough();

export const SCHEMAS = {
  'telemetry.v1': { version: 1, schema: telemetryV1 },
  'observation.v1': { version: 1, schema: observationV1 },
  'track.v1': { version: 1, schema: trackV1 },
  'feature.v1': { version: 1, schema: featureV1 },
  'incident.v1': { version: 1, schema: incidentV1 },
} as const;

export type SchemaId = keyof typeof SCHEMAS;
