// Skynode X / PX4 → normalized telemetry (§3).
//
// `SkynodeRaw` approximates the fields an Auterion Skynode / PX4 vehicle exposes
// (via MAVLink / Auterion API). The core never sees this shape — only the
// NormalizedTelemetry that `normalizeSkynode` produces. Swap this file's mapping
// when wiring the real Auterion SDK; nothing downstream changes.

import type {
  NormalizedTelemetry, FlightMode, GpsFixType, HealthState,
  SensorState, CameraState,
} from '@fusion/shared-types';

export interface SkynodeRaw {
  device_id: string;
  vehicle_id: string;
  timestamp: number;          // epoch ms
  latitude: number;
  longitude: number;
  altitude: number;           // m
  heading: number;            // deg
  ground_speed: number;       // m/s
  vertical_speed: number;     // m/s
  flight_mode: string;        // PX4 mode string
  gps_fix: number;            // 0..6 MAVLink GPS_FIX_TYPE
  gps_satellites: number;
  battery_voltage: number;    // V
  battery_remaining: number;  // 0..100
  link_quality: number;       // 0..100
  vehicle_health: string;     // "ok" | "warning" | "critical"
  mission_active: boolean;
  mission_seq?: number;
  mission_count?: number;
  sensor_status: string;      // "ok" | "degraded" | "failed"
  camera_status: string;      // "streaming" | "idle" | "recording" | "offline"
}

const FLIGHT_MODE: Record<string, FlightMode> = {
  MANUAL: 'manual', STABILIZED: 'stabilized', ALTCTL: 'altitude', POSCTL: 'position',
  AUTO_LOITER: 'hold', AUTO_MISSION: 'mission', AUTO_RTL: 'rtl',
  AUTO_TAKEOFF: 'takeoff', AUTO_LAND: 'land', OFFBOARD: 'offboard',
};

const GPS_FIX: GpsFixType[] = ['no-fix', 'no-fix', '2d', '3d', 'dgps', 'rtk-float', 'rtk-fixed'];

const HEALTH: Record<string, HealthState> = {
  ok: 'nominal', nominal: 'nominal', warning: 'warning', critical: 'critical',
};

const SENSOR: Record<string, SensorState> = {
  ok: 'nominal', nominal: 'nominal', degraded: 'degraded', failed: 'failed',
};

const CAMERA: Record<string, CameraState> = {
  streaming: 'streaming', idle: 'idle', recording: 'recording', offline: 'offline',
};

export function normalizeSkynode(r: SkynodeRaw): NormalizedTelemetry {
  return {
    deviceId: r.device_id,
    assetId: r.vehicle_id,
    timestamp: r.timestamp,
    position: { lat: r.latitude, lon: r.longitude, altitude: r.altitude },
    heading: r.heading,
    groundSpeed: r.ground_speed,
    verticalSpeed: r.vertical_speed,
    flightMode: FLIGHT_MODE[r.flight_mode] ?? 'unknown',
    gps: { fix: GPS_FIX[r.gps_fix] ?? 'no-fix', satellites: r.gps_satellites },
    battery: { voltage: r.battery_voltage, percentage: r.battery_remaining },
    linkQuality: r.link_quality,
    health: { state: HEALTH[r.vehicle_health] ?? 'unknown' },
    mission: { active: r.mission_active, currentWaypoint: r.mission_seq, totalWaypoints: r.mission_count },
    sensors: { state: SENSOR[r.sensor_status] ?? 'unknown' },
    camera: { state: CAMERA[r.camera_status] ?? 'unknown' },
    raw: { ...r },
  };
}
