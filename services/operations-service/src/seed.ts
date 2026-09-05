// Demo seed data (§26): org, users with roles, geofences (incl. a no-fly zone to
// exercise the alert engine), incidents on the map, tasks, and a route.

import type { Store } from './store.js';
import { config } from './config.js';

export function seedDemo(store: Store): void {
  const orgId = config.defaultOrgId;
  const c = config.sim.center;
  store.orgs.set(orgId, { id: orgId, name: 'Demo Operations Center', createdAt: Date.now() });

  const users: Array<[string, string, import('@fusion/shared-types').Role]> = [
    ['supervisor', 'Ops Supervisor', 'ops-supervisor'],
    ['operator', 'Field Operator', 'operator'],
    ['analyst', 'Intel Analyst', 'analyst'],
    ['admin', 'Platform Admin', 'platform-admin'],
  ];
  for (const [username, displayName, role] of users) {
    store.users.set(username, { id: username, orgId, username, displayName, role });
  }

  // no-fly zone near the center (a small square) — assets entering trigger alerts
  const d = 0.03;
  store.geofences.set('gf-nofly', {
    id: 'gf-nofly', orgId, name: 'Airport Approach', kind: 'no-fly',
    color: '#ff5d57',
    polygon: [[[c.lon - d, c.lat - d], [c.lon + d, c.lat - d], [c.lon + d, c.lat + d], [c.lon - d, c.lat + d], [c.lon - d, c.lat - d]]],
  });
  store.geofences.set('gf-aoi', {
    id: 'gf-aoi', orgId, name: 'Search Area Alpha', kind: 'area-of-interest',
    color: '#37c6cb',
    polygon: [[[c.lon + 0.05, c.lat + 0.04], [c.lon + 0.12, c.lat + 0.04], [c.lon + 0.12, c.lat + 0.1], [c.lon + 0.05, c.lat + 0.1], [c.lon + 0.05, c.lat + 0.04]]],
  });

  store.routes.set('rt-1', {
    id: 'rt-1', orgId, name: 'Inspection Route 1',
    waypoints: [[c.lon - 0.06, c.lat - 0.05], [c.lon - 0.02, c.lat - 0.02], [c.lon + 0.03, c.lat + 0.01], [c.lon + 0.07, c.lat + 0.05]],
  });

  store.addIncident({
    title: 'Structure fire — warehouse district', type: 'fire', severity: 'major', status: 'active',
    location: { lat: c.lat + 0.02, lon: c.lon - 0.02 },
    description: 'Reported smoke from a storage facility. UAV overwatch requested.',
    assignedAssetIds: ['UAV-01'],
  });
  store.addIncident({
    title: 'Missing hiker — north ridge', type: 'sar', severity: 'critical', status: 'monitoring',
    location: { lat: c.lat + 0.06, lon: c.lon + 0.07 },
    description: 'Search and rescue in progress in Search Area Alpha.',
  });
  store.addIncident({
    title: 'Bridge inspection anomaly', type: 'inspection', severity: 'minor', status: 'acknowledged',
    location: { lat: c.lat - 0.04, lon: c.lon + 0.03 },
    description: 'Automated inspection flagged a crack for review.',
  });

  // Operation (top-level container) + a couple of map features (canonical only)
  const op = store.addOperation({ id: 'op-demo', name: 'Operation Northwatch', description: 'Standing civilian ops picture for the demo AO.', status: 'active', priority: 'high', geometry: store.geofences.get('gf-aoi')?.polygon });
  store.addFeature({ operationId: op.id, type: 'route', geometryType: 'LineString', coordinates: store.routes.get('rt-1')!.waypoints, properties: { name: 'Inspection Route 1' }, source: 'user' });
  store.addFeature({ operationId: op.id, type: 'marker', geometryType: 'Point', coordinates: [c.lon + 0.09, c.lat + 0.07], properties: { name: 'Rally Point', label: 'RP-1' }, source: 'user' });
  store.addFeature({ operationId: op.id, type: 'zone', geometryType: 'Polygon', coordinates: store.geofences.get('gf-aoi')!.polygon, properties: { name: 'Search Area Alpha' }, source: 'user' });

  // Declared telemetry channels (provider metadata, Open-MCT style)
  store.channels = [
    { id: 'power.battery', key: 'battery', name: 'Battery', unit: '%', dataType: 'number', min: 0, max: 100 },
    { id: 'navigation.altitude', key: 'altitude', name: 'Altitude', unit: 'm', dataType: 'number' },
    { id: 'navigation.speed', key: 'groundSpeed', name: 'Ground speed', unit: 'm/s', dataType: 'number' },
    { id: 'navigation.heading', key: 'heading', name: 'Heading', unit: '°', dataType: 'number', min: 0, max: 360 },
    { id: 'link.quality', key: 'linkQuality', name: 'Link quality', unit: '%', dataType: 'number', min: 0, max: 100 },
  ];

  store.addTask({ name: 'Overwatch — warehouse fire', type: 'observation', priority: 'urgent', status: 'active', assignedAssetId: 'UAV-01', location: { lat: c.lat + 0.02, lon: c.lon - 0.02 } });
  store.addTask({ name: 'Grid search — Area Alpha', type: 'search-area', priority: 'high', status: 'assigned', assignedAssetId: 'UAV-02', routeId: 'rt-1' });
  store.addTask({ name: 'Pipeline survey — sector 4', type: 'infrastructure-inspection', priority: 'normal', status: 'planned' });

  store.addEvent('system.startup', 'Operations service started', undefined, 'info');
}
