export type Capability =
  | 'telemetry'
  | 'video'
  | 'maps'
  | 'messaging'
  | 'identity'
  | 'storage'
  | 'analytics'
  | 'ai'
  | 'weather'
  | 'notifications';

export interface PlatformContext {
  organizationId: string;
  operationId?: string;
  actorId?: string;
  correlationId?: string;
}

export interface OperationRef {
  id: string;
  organizationId: string;
  name: string;
  status: 'planned' | 'active' | 'paused' | 'closed' | 'archived';
}

export interface FeatureRef {
  id: string;
  organizationId: string;
  operationId: string;
  kind: string;
  revision: number;
}

export interface ProviderManifest {
  id: string;
  name: string;
  version: string;
  capabilities: Capability[];
  edgeCompatible?: boolean;
}

export interface ProviderHealth {
  providerId: string;
  state: 'starting' | 'ready' | 'degraded' | 'offline';
  checkedAt: number;
  details?: Record<string, unknown>;
}

export interface PlatformProvider {
  manifest: ProviderManifest;
  start?(ctx: PlatformContext): Promise<void> | void;
  stop?(): Promise<void> | void;
  health?(): Promise<ProviderHealth> | ProviderHealth;
}

export interface AppManifest {
  id: string;
  name: string;
  version: string;
  requiredCapabilities?: Capability[];
  permissions?: string[];
}

export interface PlatformApp {
  manifest: AppManifest;
  activate(ctx: PlatformContext): Promise<void> | void;
  deactivate?(): Promise<void> | void;
}

export interface EdgeCursor {
  source: string;
  sequence: number;
  updatedAt: number;
}

export interface EdgeRuntimeStatus {
  nodeId: string;
  state: 'starting' | 'online' | 'degraded' | 'offline';
  connected: boolean;
  queueDepth: number;
  lastSyncAt?: number;
  cursors: EdgeCursor[];
}

/**
 * Narrow AI capabilities for operational support only. Implementations must not
 * perform weapon control, targeting, engagement sequencing, or autonomous attack.
 */
export type OperationalAiCapability =
  | 'incident.summary'
  | 'alert.explain'
  | 'timeline.summary'
  | 'data-quality.explain'
  | 'telemetry.anomaly'
  | 'operator.recommendation';
