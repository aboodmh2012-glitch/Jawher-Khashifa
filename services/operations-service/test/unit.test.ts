import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signToken, verifyToken } from '../src/auth.js';
import { normalizeSkynode, type SkynodeRaw } from '@fusion/adapter-skynode';
import { assetToCoT, cotToTelemetry } from '@fusion/adapter-tak';
import type { User, Asset } from '@fusion/shared-types';

test('auth token signs and verifies, rejects tampering', () => {
  const user: User = { id: 'u1', orgId: 'org-demo', username: 'operator', displayName: 'Op', role: 'operator' };
  const { token } = signToken(user);
  const payload = verifyToken(token);
  assert.equal(payload?.sub, 'operator');
  assert.equal(payload?.role, 'operator');
  assert.equal(verifyToken(token + 'x'), null);
  assert.equal(verifyToken(undefined), null);
});

test('skynode raw normalizes to the platform telemetry model', () => {
  const raw: SkynodeRaw = {
    device_id: 'SKY-1', vehicle_id: 'UAV-01', timestamp: Date.now(),
    latitude: 24.47, longitude: 54.37, altitude: 120, heading: 90,
    ground_speed: 14, vertical_speed: 0.5, flight_mode: 'AUTO_MISSION',
    gps_fix: 3, gps_satellites: 14, battery_voltage: 24, battery_remaining: 78,
    link_quality: 92, vehicle_health: 'ok', mission_active: true,
    sensor_status: 'ok', camera_status: 'streaming',
  };
  const t = normalizeSkynode(raw);
  assert.equal(t.assetId, 'UAV-01');
  assert.equal(t.flightMode, 'mission');
  assert.equal(t.gps?.fix, '3d');
  assert.equal(t.battery?.percentage, 78);
  assert.equal(t.health?.state, 'nominal');
});

test('asset <-> CoT roundtrips position and callsign', () => {
  const asset: Asset = {
    id: 'UAV-01', orgId: 'org-demo', name: 'Falcon 1', type: 'uav',
    link: 'live', health: 'nominal', position: { lat: 24.47, lon: 54.37, altitude: 100 }, heading: 90,
  };
  const xml = assetToCoT(asset);
  assert.ok(xml && xml.includes('uid="UAV-01"'));
  const t = cotToTelemetry(xml!);
  assert.equal(t?.assetId, 'UAV-01');
  assert.ok(Math.abs((t?.position.lat ?? 0) - 24.47) < 1e-4);
});
