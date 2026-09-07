// In-memory domain store for the MVP. Every method is synchronous and pure w.r.t.
// I/O so it can later be swapped for PostgreSQL/PostGIS + TimescaleDB (§16)
// behind the same shape. Telemetry is kept in a bounded ring buffer per asset to
// power history & replay (§22) without a database in demo mode.

import { randomUUID } from 'node:crypto';
import type {
  Asset, Alert, Incident, OperationalTask, OpsEvent, Geofence, RouteEntity,
  AuditLog, User, Organization, TelemetrySample, NormalizedTelemetry, LinkState,
  RawEvent, Operation, Feature, Group, TelemetryChannel,
} from '@fusion/shared-types';

const RAW_CAP = 2000; // bounded raw-event journal (in-memory demo; partitioned table in prod)

const TELEMETRY_CAP = 600; // ~10 min at 1 Hz per asset

export class Store {
  orgs = new Map<string, Organization>();
  users = new Map<string, User>();
  assets = new Map<string, Asset>();
  incidents = new Map<string, Incident>();
  tasks = new Map<string, OperationalTask>();
  alerts = new Map<string, Alert>();
  events: OpsEvent[] = [];
  geofences = new Map<string, Geofence>();
  routes = new Map<string, RouteEntity>();
  operations = new Map<string, Operation>();
  features = new Map<string, Feature>();
  groups = new Map<string, Group>();
  channels: TelemetryChannel[] = [];
  rawEvents: RawEvent[] = [];
  audit: AuditLog[] = [];
  private telemetry = new Map<string, TelemetrySample[]>();

  constructor(readonly orgId: string) {}

  private persistRecord?: (kind: 'raw' | 'audit', value: unknown) => void;
  setJournal(writer: (kind: 'raw' | 'audit', value: unknown) => void) { this.persistRecord = writer; }

  exportState() {
    return { version: 1, orgId: this.orgId,
      maps: { orgs: [...this.orgs], users: [...this.users], assets: [...this.assets], incidents: [...this.incidents],
        tasks: [...this.tasks], alerts: [...this.alerts], geofences: [...this.geofences], routes: [...this.routes],
        operations: [...this.operations], features: [...this.features], groups: [...this.groups], telemetry: [...this.telemetry] },
      events: this.events, channels: this.channels, rawEvents: this.rawEvents, audit: this.audit };
  }
  restoreState(state: ReturnType<Store['exportState']>) {
    if (state.version !== 1 || state.orgId !== this.orgId) throw new Error('Incompatible state version or organization');
    this.orgs = new Map(state.maps.orgs); this.users = new Map(state.maps.users); this.assets = new Map(state.maps.assets);
    this.incidents = new Map(state.maps.incidents); this.tasks = new Map(state.maps.tasks); this.alerts = new Map(state.maps.alerts);
    this.geofences = new Map(state.maps.geofences); this.routes = new Map(state.maps.routes); this.operations = new Map(state.maps.operations);
    this.features = new Map(state.maps.features); this.groups = new Map(state.maps.groups); this.telemetry = new Map(state.maps.telemetry);
    this.events = state.events; this.channels = state.channels; this.rawEvents = state.rawEvents; this.audit = state.audit;
    this.refreshLinkStates();
  }

  // ---- assets ----
  upsertAssetSeed(seed: { id: string; name: string; type: Asset['type']; deviceId?: string; orgId?: string; tags?: string[] }): Asset {
    const existing = this.assets.get(seed.id);
    if (existing) return existing;
    const asset: Asset = {
      id: seed.id, orgId: seed.orgId ?? this.orgId, name: seed.name, type: seed.type,
      link: 'unknown', health: 'unknown', deviceId: seed.deviceId, tags: seed.tags,
    };
    this.assets.set(asset.id, asset);
    return asset;
  }

  applyTelemetry(t: NormalizedTelemetry): Asset | null {
    const asset = this.assets.get(t.assetId);
    if (!asset) return null;
    if (!Number.isFinite(t.timestamp) || t.timestamp < 0 || t.timestamp > Date.now() + 60_000 ||
        !Number.isFinite(t.position?.lat) || Math.abs(t.position.lat) > 90 ||
        !Number.isFinite(t.position?.lon) || Math.abs(t.position.lon) > 180) return null;
    const buf = this.telemetry.get(t.assetId) ?? [];
    if (buf.some(s => s.timestamp === t.timestamp && s.deviceId === t.deviceId)) return null;
    buf.push({ id: randomUUID(), ...structuredClone(t) });
    buf.sort((a, b) => a.timestamp - b.timestamp);
    if (buf.length > TELEMETRY_CAP) buf.shift();
    this.telemetry.set(t.assetId, buf);
    if (asset.latest && t.timestamp <= asset.latest.timestamp) return null;
    asset.position = { ...t.position };
    asset.heading = t.heading ?? asset.heading;
    asset.lastSeen = Date.now(); // receive time determines link freshness; source time orders samples
    asset.link = 'live';
    asset.health = t.health?.state ?? asset.health;
    asset.latest = structuredClone(t);
    return asset;
  }

  telemetryHistory(assetId: string, from?: number, to?: number): TelemetrySample[] {
    const buf = this.telemetry.get(assetId) ?? [];
    return buf.filter((s) => (from !== undefined ? s.timestamp >= from : true) && (to !== undefined ? s.timestamp <= to : true));
  }

  /** Age out link state for assets we haven't heard from (§21). */
  refreshLinkStates(now = Date.now()): Asset[] {
    const changed: Asset[] = [];
    for (const a of this.assets.values()) {
      if (a.lastSeen == null) continue;
      const age = now - a.lastSeen;
      const next: LinkState = age < 5000 ? 'live' : age < 20000 ? 'delayed' : 'offline';
      if (next !== a.link) { a.link = next; changed.push(a); }
    }
    return changed;
  }

  // ---- alerts / events ----
  addAlert(a: Omit<Alert, 'id' | 'orgId' | 'createdAt' | 'status'> & Partial<Pick<Alert, 'status'>>): Alert {
    const alert: Alert = { id: randomUUID(), orgId: this.orgId, createdAt: Date.now(), status: a.status ?? 'open', ...a };
    this.alerts.set(alert.id, alert);
    return alert;
  }
  ackAlert(id: string, by: string, notes?: string): Alert | null {
    const a = this.alerts.get(id);
    if (!a) return null;
    a.status = 'acknowledged'; a.acknowledgedBy = by; a.acknowledgedAt = Date.now();
    if (notes) a.resolutionNotes = notes;
    return a;
  }
  addEvent(topic: string, message: string, source?: string, severity?: Alert['severity']): OpsEvent {
    const ev: OpsEvent = { id: randomUUID(), orgId: this.orgId, at: Date.now(), topic, message, source, severity };
    this.events.unshift(ev);
    if (this.events.length > 500) this.events.pop();
    return ev;
  }

  // ---- incidents / tasks ----
  addIncident(i: Partial<Incident> & Pick<Incident, 'title' | 'type' | 'severity'>): Incident {
    const now = Date.now();
    const inc: Incident = {
      id: i.id ?? randomUUID(), orgId: this.orgId, title: i.title, type: i.type,
      severity: i.severity, status: i.status ?? 'new', location: i.location, description: i.description,
      createdAt: now, updatedAt: now, assignedTeamId: i.assignedTeamId,
      assignedAssetIds: i.assignedAssetIds ?? [], timeline: i.timeline ?? [{ at: now, kind: 'created', message: 'Incident created' }],
      attachmentIds: i.attachmentIds ?? [],
    };
    this.incidents.set(inc.id, inc);
    return inc;
  }
  updateIncident(id: string, patch: Partial<Incident>, note?: string): Incident | null {
    const inc = this.incidents.get(id);
    if (!inc) return null;
    Object.assign(inc, patch);
    inc.updatedAt = Date.now();
    if (note) inc.timeline.push({ at: inc.updatedAt, kind: 'update', message: note });
    return inc;
  }
  addTask(t: Partial<OperationalTask> & Pick<OperationalTask, 'name' | 'type'>): OperationalTask {
    const task: OperationalTask = {
      id: t.id ?? randomUUID(), orgId: this.orgId, name: t.name, type: t.type,
      description: t.description, priority: t.priority ?? 'normal', status: t.status ?? 'draft',
      assignedAssetId: t.assignedAssetId, assignedTeamId: t.assignedTeamId, location: t.location,
      routeId: t.routeId, startTime: t.startTime, deadline: t.deadline, notes: t.notes,
      attachmentIds: t.attachmentIds ?? [],
    };
    this.tasks.set(task.id, task);
    return task;
  }
  updateTask(id: string, patch: Partial<OperationalTask>): OperationalTask | null {
    const task = this.tasks.get(id);
    if (!task) return null;
    Object.assign(task, patch);
    return task;
  }

  addAudit(entry: Omit<AuditLog, 'id' | 'orgId' | 'at'>): AuditLog {
    const log: AuditLog = { id: randomUUID(), orgId: this.orgId, at: Date.now(), ...entry };
    const immutable = structuredClone(log);
    this.persistRecord?.('audit', immutable);
    this.audit.unshift(immutable);
    if (this.audit.length > 1000) this.audit.pop();
    return log;
  }

  // ---- raw-event journal (replayability) ----
  addRawEvent(protocol: string, messageType: string, payload: unknown, ref?: { deviceId?: string; assetId?: string }): RawEvent {
    const raw: RawEvent = {
      id: randomUUID(), orgId: this.orgId, protocol, messageType, payload,
      payloadFormat: typeof payload === 'string' ? 'text' : 'json',
      receivedAt: Date.now(), parserVersion: '0.1.0', correlationId: randomUUID(),
      deviceId: ref?.deviceId, assetId: ref?.assetId,
    };
    raw.payload = structuredClone(payload);
    this.persistRecord?.('raw', raw);
    this.rawEvents.push(raw);
    if (this.rawEvents.length > RAW_CAP) this.rawEvents.shift();
    return raw;
  }

  // ---- operations / features / groups ----
  addOperation(o: Partial<Operation> & Pick<Operation, 'name'>): Operation {
    const op: Operation = {
      id: o.id ?? randomUUID(), organizationId: this.orgId, name: o.name,
      description: o.description, status: o.status ?? 'active', priority: o.priority,
      startsAt: o.startsAt, endsAt: o.endsAt, geometry: o.geometry, createdBy: o.createdBy,
      createdAt: Date.now(),
    };
    this.operations.set(op.id, op);
    return op;
  }
  addFeature(f: Partial<Feature> & Pick<Feature, 'operationId' | 'type' | 'geometryType' | 'coordinates'>): Feature {
    const now = Date.now();
    const feat: Feature = {
      id: f.id ?? randomUUID(), operationId: f.operationId, orgId: this.orgId,
      type: f.type, geometryType: f.geometryType, coordinates: f.coordinates,
      properties: f.properties ?? {}, source: f.source ?? 'user', createdBy: f.createdBy,
      version: 1, createdAt: now, updatedAt: now,
    };
    this.features.set(feat.id, feat);
    return feat;
  }
  updateFeature(id: string, patch: Partial<Feature>): Feature | null {
    const feat = this.features.get(id);
    if (!feat) return null;
    Object.assign(feat, patch, { version: feat.version + 1, updatedAt: Date.now() });
    return feat;
  }
  deleteFeature(id: string): boolean { return this.features.delete(id); }

  snapshot() {
    return {
      assets: [...this.assets.values()],
      alerts: [...this.alerts.values()].filter((a) => a.status !== 'resolved').slice(0, 100),
      incidents: [...this.incidents.values()],
      tasks: [...this.tasks.values()],
      events: this.events.slice(0, 60),
      features: [...this.features.values()],
    };
  }
}
