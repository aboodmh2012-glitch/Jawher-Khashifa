// @fusion/schemas — versioned runtime schemas (Zod). Compile-time TS types are
// NOT enough at trust boundaries; external/adapter payloads and the event
// envelope are validated at runtime before entering domain processing. Schemas
// are versioned (name.vN) so the wire format can evolve without breaking
// older producers. The @fusion/validation package consumes this registry.

import { z } from 'zod';

const geoPoint = z.object({
  lat: z.number().gte(-90).lte(90),
  lon: z.number().gte(-180).lte(180),
  altitude: z.number().optional(),
});

/** envelope.v1 — the transport envelope every bus/WS message travels in. */
export const EventEnvelopeSchema = z.object({
  eventId: z.string().min(1),
  type: z.string().min(1),
  schemaVersion: z.number().int().nonnegative(),
  source: z.string().min(1),
  occurredAt: z.number().positive(),
  receivedAt: z.number().positive(),
  correlationId: z.string().min(1),
  causationId: z.string().optional(),
  organizationId: z.string().optional(),
  operationId: z.string().optional(),
  assetId: z.string().optional(),
  deviceId: z.string().optional(),
  sequence: z.number().optional(),
  traceId: z.string().optional(),
  payload: z.unknown(),
}).passthrough();

/** raw-event.v1 — the journaled, unparsed source message envelope. */
export const RawEventSchema = z.object({
  id: z.string().min(1),
  protocol: z.string().min(1),
  messageType: z.string().min(1),
  payloadFormat: z.enum(['json', 'xml', 'text', 'binary-base64']),
  receivedAt: z.number().positive(),
  parserVersion: z.string().min(1),
  correlationId: z.string().min(1),
  deviceId: z.string().optional(),
  assetId: z.string().optional(),
}).passthrough();

/** asset.v1 — a registered asset (vendor-neutral). */
export const AssetSchema = z.object({
  id: z.string().min(1),
  orgId: z.string().min(1),
  name: z.string().min(1),
  type: z.enum(['uav', 'ground-vehicle', 'vessel', 'team', 'sensor', 'camera', 'infrastructure', 'marker']),
}).passthrough();

/** telemetry.v1 — the normalized, vendor-neutral telemetry sample. */
export const NormalizedTelemetrySchema = z.object({
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
export const ObservationSchema = z.object({
  id: z.string().min(1),
  sourceId: z.string().min(1),
  occurredAt: z.number().positive(),
  receivedAt: z.number().positive(),
  position: geoPoint.optional(),
  confidence: z.number().min(0).max(1),
  rawEventId: z.string().optional(),
  correlationId: z.string().optional(),
}).passthrough();

/** track.v1 — fused understanding of an observed entity (Phase B). */
export const TrackSchema = z.object({
  id: z.string().min(1),
  state: z.enum(['tentative', 'confirmed', 'coasting', 'lost', 'archived']),
  confidence: z.number().min(0).max(1),
  firstSeenAt: z.number().positive(),
  lastSeenAt: z.number().positive(),
}).passthrough();

/** feature.v1 — a canonical map annotation. */
export const FeatureSchema = z.object({
  operationId: z.string().min(1),
  type: z.string().min(1),
  geometryType: z.enum(['Point', 'LineString', 'Polygon', 'MultiPoint', 'MultiLineString', 'MultiPolygon']),
  coordinates: z.unknown(),
}).passthrough();

/** incident.v1 — an incident record. */
export const IncidentSchema = z.object({
  title: z.string().min(1),
  type: z.string().min(1),
  severity: z.enum(['info', 'minor', 'major', 'critical']),
}).passthrough();

/** The versioned registry consumed by the validator. */
export const SCHEMAS = {
  'envelope.v1': { version: 1, schema: EventEnvelopeSchema },
  'raw-event.v1': { version: 1, schema: RawEventSchema },
  'asset.v1': { version: 1, schema: AssetSchema },
  'telemetry.v1': { version: 1, schema: NormalizedTelemetrySchema },
  'observation.v1': { version: 1, schema: ObservationSchema },
  'track.v1': { version: 1, schema: TrackSchema },
  'feature.v1': { version: 1, schema: FeatureSchema },
  'incident.v1': { version: 1, schema: IncidentSchema },
} as const;

export type SchemaId = keyof typeof SCHEMAS;
