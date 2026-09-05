// Generic fleet simulator (§26): ground vehicles, sensors and cameras — the
// non-UAV assets — so the whole COP is populated in demo mode. Demonstrates
// several adapters feeding one core through the same contract.

import { BaseAdapter, type AdapterContext, type AssetSeed } from './contract.js';
import type { AssetType, NormalizedTelemetry, CameraState, SensorState } from '@fusion/shared-types';

export interface FleetSimConfig {
  center?: { lat: number; lon: number };
  intervalMs?: number;
  orgId?: string;
  vehicles?: number;
  sensors?: number;
  cameras?: number;
}

interface SimNode {
  id: string; name: string; type: AssetType; deviceId: string;
  lat: number; lon: number; heading: number; speed: number; moving: boolean;
}

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

export class SimFleetAdapter extends BaseAdapter {
  readonly name = 'Generic Fleet Simulator';
  readonly kind = 'generic-fleet';
  private timer: ReturnType<typeof setInterval> | null = null;
  private nodes: SimNode[] = [];

  constructor(private cfg: FleetSimConfig = {}) { super(); }

  protected onStart(ctx: AdapterContext): void {
    const c = this.cfg.center ?? { lat: 24.47, lon: 54.37 };
    const mk = (type: AssetType, i: number, prefix: string, moving: boolean): SimNode => ({
      id: `${prefix}-${String(i + 1).padStart(2, '0')}`,
      name: `${prefix} ${i + 1}`,
      type, deviceId: `DEV-${prefix}-${i + 1}`,
      lat: c.lat + rnd(-0.08, 0.08), lon: c.lon + rnd(-0.08, 0.08),
      heading: rnd(0, 360), speed: moving ? rnd(4, 14) : 0, moving,
    });
    for (let i = 0; i < (this.cfg.vehicles ?? 2); i++) this.nodes.push(mk('ground-vehicle', i, 'GV', true));
    for (let i = 0; i < (this.cfg.sensors ?? 2); i++) this.nodes.push(mk('sensor', i, 'SNS', false));
    for (let i = 0; i < (this.cfg.cameras ?? 1); i++) this.nodes.push(mk('camera', i, 'CAM', false));

    for (const n of this.nodes) {
      const seed: AssetSeed = { id: n.id, name: n.name, type: n.type, deviceId: n.deviceId, orgId: this.cfg.orgId };
      ctx.onAssetUp(seed);
      ctx.onEvent('asset.connected', `${n.name} online`, n.id);
    }
    this.timer = setInterval(() => this.tick(ctx), this.cfg.intervalMs ?? 1500);
  }

  protected onStop(): void { if (this.timer) clearInterval(this.timer); this.timer = null; }

  private tick(ctx: AdapterContext): void {
    const dt = (this.cfg.intervalMs ?? 1500) / 1000;
    for (const n of this.nodes) {
      if (n.moving) {
        n.heading = (n.heading + rnd(-10, 10) + 360) % 360;
        const d = (n.speed * dt) / 111000;
        n.lat += Math.cos((n.heading * Math.PI) / 180) * d;
        n.lon += Math.sin((n.heading * Math.PI) / 180) * d / Math.cos((n.lat * Math.PI) / 180);
      }
      const t: NormalizedTelemetry = {
        deviceId: n.deviceId, assetId: n.id, timestamp: Date.now(),
        position: { lat: n.lat, lon: n.lon, altitude: 0 },
        heading: n.heading, groundSpeed: n.speed,
        linkQuality: Math.round(rnd(70, 100)),
        health: { state: 'nominal' },
      };
      if (n.type === 'sensor') t.sensors = { state: (Math.random() < 0.05 ? 'degraded' : 'nominal') as SensorState };
      if (n.type === 'camera') t.camera = { state: (Math.random() < 0.1 ? 'recording' : 'streaming') as CameraState, activeStreamId: `${n.id}-primary` };
      ctx.onTelemetry(t);
    }
  }
}
