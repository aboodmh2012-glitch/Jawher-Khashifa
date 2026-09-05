// The generic normalized telemetry model (§3).
//
// Every adapter (Skynode/PX4, MAVLink, generic) MUST translate its source into
// this shape. The core platform is written against THIS model only — never
// against a specific autopilot or manufacturer. Adding hardware later means
// writing an adapter, not touching the core.

import type {
  FlightMode,
  GpsFixType,
  HealthState,
  CameraState,
  SensorState,
} from './enums.js';

export interface GeoPoint {
  lat: number;
  lon: number;
  /** metres above ellipsoid / MSL as reported by the source. */
  altitude?: number;
}

export interface NormalizedTelemetry {
  deviceId: string;
  assetId: string;
  /** epoch milliseconds (UTC). */
  timestamp: number;

  position: GeoPoint;
  /** degrees, 0..360, true north. */
  heading?: number;
  /** m/s over ground. */
  groundSpeed?: number;
  /** m/s, positive up. */
  verticalSpeed?: number;

  flightMode?: FlightMode;
  gps?: {
    fix: GpsFixType;
    satellites?: number;
    hdop?: number;
  };

  battery?: {
    /** volts. */
    voltage?: number;
    /** 0..100. */
    percentage?: number;
    /** amps, optional. */
    current?: number;
  };

  /** 0..100 radio/datalink quality. */
  linkQuality?: number;

  health?: {
    state: HealthState;
    /** free-form component -> state, e.g. { imu: 'nominal', mag: 'warning' }. */
    components?: Record<string, HealthState>;
  };

  mission?: {
    active: boolean;
    id?: string;
    currentWaypoint?: number;
    totalWaypoints?: number;
  };

  sensors?: {
    state: SensorState;
    detail?: Record<string, SensorState>;
  };

  camera?: {
    state: CameraState;
    activeStreamId?: string;
  };

  /** carrier for source-specific fields we don't normalize (kept for audit). */
  raw?: Record<string, unknown>;
}
