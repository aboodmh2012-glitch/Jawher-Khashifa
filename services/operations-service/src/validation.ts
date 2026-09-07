const str = { type: 'string', minLength: 1, maxLength: 200 };
const text = { type: 'string', maxLength: 10000 };
const strings = { type: 'array', maxItems: 100, items: str };
const num = { type: 'number', minimum: 0 };
const point = { type: 'object', additionalProperties: false, required: ['lat', 'lon'], properties: {
  lat: { type: 'number', minimum: -90, maximum: 90 }, lon: { type: 'number', minimum: -180, maximum: 180 }, altitude: { type: 'number' },
} };
const enumeration = (...values: string[]) => ({ type: 'string', enum: values });
const incidentStatus = enumeration('new', 'acknowledged', 'active', 'monitoring', 'resolved', 'closed');
const task = { name: str, type: enumeration('search-area','inspection','survey','observation','delivery','mapping','emergency-response','infrastructure-inspection'),
  description: text, priority: enumeration('low','normal','high','urgent'), status: enumeration('draft','planned','assigned','active','paused','completed','cancelled'),
  assignedAssetId: str, assignedTeamId: str, location: point, routeId: str, startTime: num, deadline: num, notes: text, attachmentIds: strings };
const feature = { operationId: str, type: str, geometryType: enumeration('Point','LineString','Polygon','MultiPoint','MultiLineString','MultiPolygon'),
  coordinates: { type: 'array', maxItems: 10000 }, properties: { type: 'object', maxProperties: 50 } };
const body = (properties: object, required: string[] = []) => ({ type: 'object', additionalProperties: false, properties, required, minProperties: 1 });
export const bodySchemas: Record<string, object> = {
  'POST /api/auth/login': body({ username: str, password: { type: 'string', minLength: 1, maxLength: 1024 } }, ['username','password']),
  'POST /api/incidents': body({ title: str, type: str, severity: enumeration('info','minor','major','critical'), location: point, description: text }, ['title','type','severity']),
  'PATCH /api/incidents/:id': body({ status: incidentStatus, note: text }),
  'POST /api/tasks': body(task, ['name','type']),
  'PATCH /api/tasks/:id': body(task),
  'POST /api/features': body(feature, ['operationId','type','geometryType','coordinates']),
  'PATCH /api/features/:id': body({ type: str, geometryType: feature.geometryType, coordinates: feature.coordinates, properties: feature.properties, expectedVersion: { type: 'integer', minimum: 1 } }, ['expectedVersion']),
  'POST /api/alerts/:id/ack': { ...body({ notes: text }), minProperties: 0 },
};

export function validGeometry(kind: string, coordinates: unknown): boolean {
  const point = (p: unknown): boolean => Array.isArray(p) && (p.length === 2 || p.length === 3) &&
    p.every(x => typeof x === 'number' && Number.isFinite(x)) && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90;
  const line = (p: unknown): boolean => Array.isArray(p) && p.length >= 2 && p.every(point);
  const ring = (p: unknown): boolean => line(p) && (p as number[][]).length >= 4 &&
    JSON.stringify((p as number[][])[0]) === JSON.stringify((p as number[][]).at(-1));
  const polygon = (p: unknown): boolean => Array.isArray(p) && p.length > 0 && p.every(ring);
  const multi = (p: unknown, test: (v: unknown) => boolean) => Array.isArray(p) && p.length > 0 && p.every(test);
  switch (kind) {
    case 'Point': return point(coordinates);
    case 'LineString': return line(coordinates);
    case 'Polygon': return polygon(coordinates);
    case 'MultiPoint': return multi(coordinates, point);
    case 'MultiLineString': return multi(coordinates, line);
    case 'MultiPolygon': return multi(coordinates, polygon);
    default: return false;
  }
}
