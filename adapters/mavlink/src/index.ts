// @fusion/adapter-mavlink — generic MAVLink adapter interface (§3).
//
// Skynode is one MAVLink-speaking source; many others exist (ArduPilot, PX4 over
// MAVLink, ground stations). This module defines the seam so ANY MAVLink source
// can be integrated later without touching the core. It intentionally ships the
// normalization contract + a mapper, not a live serial/UDP link — wiring a real
// MAVLink transport (e.g. node-mavlink) is a Phase-2+ task.

import type { NormalizedTelemetry, FlightMode, GpsFixType } from '@fusion/shared-types';
import { BaseAdapter, type AdapterContext } from '@fusion/adapter-sdk';

/** Minimal fused view of the MAVLink messages we care about. */
export interface MavlinkFrame {
  systemId: number;
  componentId: number;
  timeBootMs: number;
  globalPosition?: { lat: number; lon: number; alt: number; hdg: number; vx: number; vy: number; vz: number };
  gpsRaw?: { fixType: number; satellitesVisible: number };
  sysStatus?: { batteryRemaining: number; voltageBattery: number };
  heartbeat?: { customMode: number; baseMode: number; systemStatus: number };
  radioStatus?: { rssi: number };
}

const GPS_FIX: GpsFixType[] = ['no-fix', 'no-fix', '2d', '3d', 'dgps', 'rtk-float', 'rtk-fixed'];

/** Map a fused MAVLink frame into the platform's normalized telemetry model. */
export function normalizeMavlink(f: MavlinkFrame, assetId: string, deviceId: string): NormalizedTelemetry {
  const gp = f.globalPosition;
  const speed = gp ? Math.hypot(gp.vx, gp.vy) : undefined;
  return {
    deviceId,
    assetId,
    timestamp: Date.now(),
    position: gp ? { lat: gp.lat / 1e7, lon: gp.lon / 1e7, altitude: gp.alt / 1000 } : { lat: 0, lon: 0 },
    heading: gp ? gp.hdg / 100 : undefined,
    groundSpeed: speed,
    verticalSpeed: gp ? -gp.vz : undefined,
    flightMode: decodeMode(f.heartbeat?.customMode),
    gps: f.gpsRaw ? { fix: GPS_FIX[f.gpsRaw.fixType] ?? 'no-fix', satellites: f.gpsRaw.satellitesVisible } : undefined,
    battery: f.sysStatus ? { percentage: f.sysStatus.batteryRemaining, voltage: f.sysStatus.voltageBattery / 1000 } : undefined,
    linkQuality: f.radioStatus ? Math.min(100, Math.round((f.radioStatus.rssi / 255) * 100)) : undefined,
    health: { state: 'unknown' },
  };
}

function decodeMode(_customMode?: number): FlightMode {
  // Real decoding is autopilot-specific; left as 'unknown' until a transport is wired.
  return 'unknown';
}

/** Skeleton adapter — implement onStart with a real MAVLink transport later. */
export class MavlinkAdapter extends BaseAdapter {
  readonly name = 'MAVLink Adapter';
  readonly kind = 'mavlink';
  protected onStart(ctx: AdapterContext): void {
    ctx.log('MavlinkAdapter is a scaffold — connect a MAVLink transport (serial/UDP) and call ctx.onTelemetry(normalizeMavlink(frame, ...)).');
  }
}
