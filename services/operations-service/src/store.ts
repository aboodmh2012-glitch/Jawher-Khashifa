// In-memory domain store for the MVP. Every method is synchronous and pure w.r.t.
// I/O so it can later be swapped for PostgreSQL/PostGIS + TimescaleDB (§16)
// behind the same shape. Telemetry is kept in a bounded ring buffer per asset to
// power history & replay (§22) without a database in demo mode.

import { randomUUID } from 'node:crypto';
import type {
  Asset, Alert, Incident, OperationalTask, OpsEvent, Geofence, RouteEntity,
  AuditLog, User, Organization, TelemetrySample, NormalizedTelemetry, LinkState,
} from '@fusion/shared-types';

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
  audit: AuditLog[] = [];
  private telemetry = new Map<string, TelemetrySample[]>();

  constructor(private orgId: string) {}

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
    asset.position = t.position;
    asset.heading = t.heading ?? asset.heading;
    asset.lastSeen = t.timestamp;
    asset.link = 'live';
    asset.health = t.health?.state ?? asset.health;
    asset.latest = t;
    const buf = this.telemetry.get(t.assetId) ?? [];
    buf.push({ id: randomUUID(), ...t });
    if (buf.length > TELEMETRY_CAP) buf.shift();
    this.telemetry.set(t.assetId, buf);
    return asset;
  }

  telemetryHistory(assetId: string, from?: number, to?: number): TelemetrySample[] {
    const buf = this.telemetry.get(assetId) ?? [];
    return buf.filter((s) => (from ? s.timestamp >= from : true) && (to ? s.timestamp <= to : true));
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
    this.audit.unshift(log);
    if (this.audit.length > 1000) this.audit.pop();
    return log;
  }

  snapshot() {
    return {
      assets: [...this.assets.values()],
      alerts: [...this.alerts.values()].filter((a) => a.status !== 'resolved').slice(0, 100),
      incidents: [...this.incidents.values()],
      events: this.events.slice(0, 60),
    };
  }
}
