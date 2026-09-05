// Skynode/PX4 UAV simulator (§26). Produces Skynode-shaped raw telemetry that is
// normalized through the SAME path a real vehicle would use — so the command
// center can be demonstrated end-to-end before any hardware is connected.

import { BaseAdapter, type AdapterContext } from '@fusion/adapter-sdk';
import { normalizeSkynode, type SkynodeRaw } from './normalize.js';

export interface SkynodeSimConfig {
  count?: number;
  center?: { lat: number; lon: number };
  radiusKm?: number;
  intervalMs?: number;
  orgId?: string;
}

interface SimVehicle {
  deviceId: string;
  vehicleId: string;
  name: string;
  lat: number;
  lon: number;
  altitude: number;
  heading: number;
  speed: number;      // m/s
  battery: number;    // %
  voltage: number;
  gpsSats: number;
  gpsFix: number;
  mode: string;
  missionSeq: number;
  missionCount: number;
}

const MODES = ['AUTO_MISSION', 'POSCTL', 'AUTO_LOITER', 'AUTO_RTL'];
const rnd = (a: number, b: number) => a + Math.random() * (b - a);

export class SkynodeSimAdapter extends BaseAdapter {
  readonly name = 'Skynode Simulator';
  readonly kind = 'skynode';
  private timer: ReturnType<typeof setInterval> | null = null;
  private vehicles: SimVehicle[] = [];

  constructor(private cfg: SkynodeSimConfig = {}) { super(); }

  protected onStart(ctx: AdapterContext): void {
    const count = this.cfg.count ?? 4;
    const center = this.cfg.center ?? { lat: 24.47, lon: 54.37 };
    const radiusKm = this.cfg.radiusKm ?? 12;
    const orgId = this.cfg.orgId;

    for (let i = 0; i < count; i++) {
      const angle = rnd(0, Math.PI * 2);
      const dist = rnd(0, radiusKm) / 111;
      const v: SimVehicle = {
        deviceId: `SKYNODE-${String(i + 1).padStart(3, '0')}`,
        vehicleId: `UAV-${String(i + 1).padStart(2, '0')}`,
        name: `Falcon ${i + 1}`,
        lat: center.lat + Math.sin(angle) * dist,
        lon: center.lon + Math.cos(angle) * dist,
        altitude: rnd(60, 320),
        heading: rnd(0, 360),
        speed: rnd(8, 22),
        battery: rnd(55, 100),
        voltage: rnd(22, 25),
        gpsSats: Math.floor(rnd(9, 20)),
        gpsFix: 3,
        mode: MODES[i % MODES.length],
        missionSeq: 1,
        missionCount: Math.floor(rnd(4, 12)),
      };
      this.vehicles.push(v);
      ctx.onAssetUp({ id: v.vehicleId, name: v.name, type: 'uav', deviceId: v.deviceId, orgId, tags: ['skynode', 'px4'] });
      ctx.onEvent('asset.connected', `${v.name} (${v.vehicleId}) linked via Skynode`, v.vehicleId);
    }

    this.timer = setInterval(() => this.tick(ctx), this.cfg.intervalMs ?? 1000);
  }

  protected onStop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private tick(ctx: AdapterContext): void {
    const dt = (this.cfg.intervalMs ?? 1000) / 1000;
    for (const v of this.vehicles) {
      // wander
      v.heading = (v.heading + rnd(-8, 8) + 360) % 360;
      const distDeg = (v.speed * dt) / 111000;
      v.lat += Math.cos((v.heading * Math.PI) / 180) * distDeg;
      v.lon += Math.sin((v.heading * Math.PI) / 180) * distDeg / Math.cos((v.lat * Math.PI) / 180);
      v.altitude += rnd(-2, 2);
      v.battery = Math.max(0, v.battery - dt * rnd(0.02, 0.08));
      v.voltage = 22 + (v.battery / 100) * 3;
      // occasional GPS wobble to exercise the alert engine
      if (Math.random() < 0.01) v.gpsSats = Math.floor(rnd(4, 8));
      else if (Math.random() < 0.05) v.gpsSats = Math.floor(rnd(9, 20));
      if (v.mode === 'AUTO_MISSION' && Math.random() < 0.03) {
        v.missionSeq = Math.min(v.missionCount, v.missionSeq + 1);
      }

      const raw: SkynodeRaw = {
        device_id: v.deviceId,
        vehicle_id: v.vehicleId,
        timestamp: Date.now(),
        latitude: v.lat,
        longitude: v.lon,
        altitude: v.altitude,
        heading: v.heading,
        ground_speed: v.speed,
        vertical_speed: rnd(-1.5, 1.5),
        flight_mode: v.mode,
        gps_fix: v.gpsSats >= 6 ? 3 : 1,
        gps_satellites: v.gpsSats,
        battery_voltage: v.voltage,
        battery_remaining: Math.round(v.battery),
        link_quality: Math.round(rnd(60, 100)),
        vehicle_health: v.battery < 20 ? 'warning' : 'ok',
        mission_active: v.mode === 'AUTO_MISSION',
        mission_seq: v.missionSeq,
        mission_count: v.missionCount,
        sensor_status: 'ok',
        camera_status: 'streaming',
      };
      ctx.onTelemetry(normalizeSkynode(raw));
    }
  }
}
