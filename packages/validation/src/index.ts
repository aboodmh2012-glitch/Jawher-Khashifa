// Schema registry + validator + quarantine types.
//
//   RawEvent → validate(schemaId, payload)
//                ├── valid   → normalizer / domain
//                └── invalid → QuarantinedEvent (never crashes processing)

import { SCHEMAS, type SchemaId } from './schemas.js';

export * from './schemas.js';

export interface ValidationError {
  path: string;
  message: string;
}

export interface ValidationResult<T = unknown> {
  valid: boolean;
  schemaId: string;
  schemaVersion: number;
  value?: T;
  errors: ValidationError[];
}

export interface QuarantinedEvent {
  id: string;
  schemaId: string;
  schemaVersion: number;
  errors: ValidationError[];
  source: string;
  rawEventId?: string;
  correlationId?: string;
  payload: unknown;
  at: number;
}

export function schemaExists(id: string): id is SchemaId {
  return Object.prototype.hasOwnProperty.call(SCHEMAS, id);
}

export function listSchemas(): Array<{ id: string; version: number }> {
  return Object.entries(SCHEMAS).map(([id, s]) => ({ id, version: s.version }));
}

/** Validate a payload against a registered schema. Never throws. */
export function validate<T = unknown>(schemaId: string, input: unknown): ValidationResult<T> {
  if (!schemaExists(schemaId)) {
    return { valid: false, schemaId, schemaVersion: 0, errors: [{ path: '', message: `unknown schema '${schemaId}'` }] };
  }
  const entry = SCHEMAS[schemaId];
  const result = entry.schema.safeParse(input);
  if (result.success) {
    return { valid: true, schemaId, schemaVersion: entry.version, value: result.data as T, errors: [] };
  }
  return {
    valid: false,
    schemaId,
    schemaVersion: entry.version,
    errors: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
  };
}
