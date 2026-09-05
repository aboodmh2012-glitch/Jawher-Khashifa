// Shared enums / string-literal unions for the Fusion Operations Platform.

export type AssetType =
  | 'uav'
  | 'ground-vehicle'
  | 'vessel'
  | 'team'
  | 'sensor'
  | 'camera'
  | 'infrastructure'
  | 'marker';

/** Connection / freshness state — the UI must clearly distinguish these (§21). */
export type LinkState = 'live' | 'delayed' | 'offline' | 'unknown';

export type FlightMode =
  | 'manual'
  | 'stabilized'
  | 'altitude'
  | 'position'
  | 'hold'
  | 'mission'
  | 'rtl'
  | 'takeoff'
  | 'land'
  | 'offboard'
  | 'unknown';

export type GpsFixType = 'no-fix' | '2d' | '3d' | 'dgps' | 'rtk-float' | 'rtk-fixed';

export type HealthState = 'nominal' | 'warning' | 'critical' | 'unknown';

export type IncidentStatus =
  | 'new'
  | 'acknowledged'
  | 'active'
  | 'monitoring'
  | 'resolved'
  | 'closed';

export type IncidentSeverity = 'info' | 'minor' | 'major' | 'critical';

export type TaskStatus =
  | 'draft'
  | 'planned'
  | 'assigned'
  | 'active'
  | 'paused'
  | 'completed'
  | 'cancelled';

export type TaskType =
  | 'search-area'
  | 'inspection'
  | 'survey'
  | 'observation'
  | 'delivery'
  | 'mapping'
  | 'emergency-response'
  | 'infrastructure-inspection';

export type TaskPriority = 'low' | 'normal' | 'high' | 'urgent';

export type AlertSeverity = 'info' | 'warning' | 'high' | 'critical';

export type AlertStatus = 'open' | 'acknowledged' | 'resolved';

export type AlertKind =
  | 'battery-low'
  | 'gps-degraded'
  | 'comms-lost'
  | 'vehicle-offline'
  | 'sensor-failure'
  | 'temperature-high'
  | 'storage-low'
  | 'geofence-warning'
  | 'mission-timeout'
  | 'device-health';

export type Role =
  | 'platform-admin'
  | 'org-admin'
  | 'ops-supervisor'
  | 'operator'
  | 'analyst'
  | 'field-user'
  | 'viewer';

export type CameraState = 'streaming' | 'idle' | 'recording' | 'offline' | 'unknown';
export type SensorState = 'nominal' | 'degraded' | 'failed' | 'unknown';
