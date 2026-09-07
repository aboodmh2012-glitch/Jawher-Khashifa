// Operational ontology (Database V2 / §4). Explicit real-world relationships,
// not disconnected tables. Two hierarchies are kept SEPARATE on purpose:
//
//   Permanent org:  Organization → Region → OperationsCenter → Unit → Team
//   Assets/devices: Asset (home-owned by a Unit) — Device MOUNTED_ON Asset
//                   (via AssetDevice, over time) — Agent REPRESENTS Asset
//
// Home ownership (Asset BELONGS_TO Unit) is distinct from temporary operational
// assignment (Asset ASSIGNED_TO Operation) — never overload the two.

export interface Region {
  id: string;
  organizationId: string;
  name: string;
  createdAt: number;
}

export interface OperationsCenter {
  id: string;
  organizationId: string;
  regionId?: string;
  name: string;
  createdAt: number;
}

export interface Unit {
  id: string;
  organizationId: string;
  operationsCenterId?: string;
  name: string;
  createdAt: number;
}

/** Explicit membership join (User MEMBER_OF Team), append-only-friendly. */
export interface TeamMembership {
  id: string;
  teamId: string;
  userId: string;
  role?: string;
  joinedAt: number;
  leftAt?: number;
}

/** Hardware. Separate from Asset — a Device may move between Assets over time. */
export interface Device {
  id: string;
  organizationId: string;
  manufacturer?: string;
  model?: string;
  serial?: string;
  protocol?: string;          // MAVLINK | COT | RTSP | ...
  adapter?: string;           // adapter kind that speaks to it
  firmwareVersion?: string;
  softwareVersion?: string;
  status?: 'online' | 'offline' | 'degraded' | 'unknown';
  lastSeenAt?: number;
  capabilities?: string[];
}

/** The Asset↔Device relationship over time (Device MOUNTED_ON Asset).
 *  An Asset may have many Devices; a Device may move between Assets. */
export interface AssetDevice {
  id: string;
  assetId: string;
  deviceId: string;
  role?: string;              // 'autopilot' | 'camera-eo' | 'gps' | ...
  isPrimary: boolean;
  installedAt: number;
  removedAt?: number;         // set when the device leaves the asset
}

/** Software representative of an Asset at the edge (Agent REPRESENTS Asset). */
export interface Agent {
  id: string;
  assetId: string;
  organizationId: string;
  operationId?: string;
  deviceIds: string[];
  capabilities: string[];
  connectionStatus: 'online' | 'offline' | 'degraded' | 'unknown';
  permissions?: string[];
  lastSeenAt?: number;
}
