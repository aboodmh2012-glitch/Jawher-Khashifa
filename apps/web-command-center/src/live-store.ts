// Live store — a vanilla (non-React) store fed by the WebSocket. High-frequency
// position updates mutate plain maps here; the map reads them imperatively each
// frame, while React panels subscribe through throttled notifications. This keeps
// ~10 Hz telemetry from thrashing React renders.

import { config } from './config.js';
import { getToken } from './api.js';
import type { Asset, Alert, Incident, OpsEvent, Geofence, RouteEntity, OperationalTask } from '@fusion/shared-types';
import type { ServerMessage } from '@fusion/event-contracts';

export interface TelemPoint { t: number; battery?: number; altitude?: number; speed?: number; }

class LiveStore {
  assets = new Map<string, Asset>();
  trails = new Map<string, [number, number][]>();
  telem = new Map<string, TelemPoint[]>();
  alerts = new Map<string, Alert>();
  incidents = new Map<string, Incident>();
  tasks = new Map<string, OperationalTask>();
  events: OpsEvent[] = [];
  geofences: Geofence[] = [];
  routes: RouteEntity[] = [];
  selectedId: string | null = null;
  connected = false;
  version = 0;

  private listeners = new Set<() => void>();
  private ws: WebSocket | null = null;
  private notifyScheduled = false;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getVersion = (): number => this.version;

  private notify() {
    if (this.notifyScheduled) return;
    this.notifyScheduled = true;
    setTimeout(() => {
      this.notifyScheduled = false;
      this.version++;
      for (const l of this.listeners) l();
    }, 180);
  }
  private notifyNow() { this.version++; for (const l of this.listeners) l(); }

  setStatic(geofences: Geofence[], routes: RouteEntity[]) {
    this.geofences = geofences; this.routes = routes; this.notifyNow();
  }
  setTasks(tasks: OperationalTask[]) {
    this.tasks = new Map(tasks.map((t) => [t.id, t])); this.notifyNow();
  }
  tasksList(): OperationalTask[] { return [...this.tasks.values()]; }
  select(id: string | null) { this.selectedId = id; this.notifyNow(); }

  connect() {
    if (this.ws) return;
    const url = `${config.wsUrl}?token=${encodeURIComponent(getToken() ?? '')}`;
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.onopen = () => { this.connected = true; this.notifyNow(); };
    ws.onclose = () => {
      this.connected = false; this.ws = null; this.notifyNow();
      setTimeout(() => this.connect(), 1500);
    };
    ws.onerror = () => ws.close();
    ws.onmessage = (e) => this.apply(JSON.parse(e.data) as ServerMessage | { topic: 'snapshot'; payload: SnapshotPayload });
  }

  private pushTrail(id: string, lon: number, lat: number) {
    const tr = this.trails.get(id) ?? [];
    tr.push([lon, lat]);
    if (tr.length > 40) tr.shift();
    this.trails.set(id, tr);
  }

  private apply(msg: ServerMessage | { topic: 'snapshot'; payload: SnapshotPayload }) {
    switch (msg.topic) {
      case 'snapshot': {
        const p = msg.payload;
        this.assets = new Map(p.assets.map((a) => [a.id, a]));
        this.alerts = new Map(p.alerts.filter((a) => a.status !== 'resolved').map((a) => [a.id, a]));
        this.incidents = new Map(p.incidents.map((i) => [i.id, i]));
        this.events = p.events;
        for (const a of p.assets) if (a.position) this.pushTrail(a.id, a.position.lon, a.position.lat);
        this.notifyNow();
        break;
      }
      case 'asset.position': {
        const a = this.assets.get(msg.payload.assetId);
        if (a) {
          a.position = { lat: msg.payload.lat, lon: msg.payload.lon, altitude: msg.payload.altitude };
          a.heading = msg.payload.heading ?? a.heading;
          a.link = 'live'; a.lastSeen = msg.ts;
          this.pushTrail(a.id, msg.payload.lon, msg.payload.lat);
        }
        this.notify();
        break;
      }
      case 'asset.telemetry': {
        const t = msg.payload;
        const a = this.assets.get(t.assetId);
        if (a) { a.latest = t; a.health = t.health?.state ?? a.health; }
        const buf = this.telem.get(t.assetId) ?? [];
        buf.push({ t: t.timestamp, battery: t.battery?.percentage, altitude: t.position.altitude, speed: t.groundSpeed });
        if (buf.length > 120) buf.shift();
        this.telem.set(t.assetId, buf);
        this.notify();
        break;
      }
      case 'asset.connected': {
        this.assets.set(msg.payload.asset.id, msg.payload.asset); this.notify(); break;
      }
      case 'asset.disconnected': {
        const a = this.assets.get(msg.payload.assetId); if (a) a.link = 'offline'; this.notify(); break;
      }
      case 'asset.health': {
        const a = this.assets.get(msg.payload.assetId); if (a) a.health = msg.payload.health; this.notify(); break;
      }
      case 'alert.created': { this.alerts.set(msg.payload.id, msg.payload); this.notifyNow(); break; }
      case 'alert.acknowledged': {
        if (msg.payload.status === 'resolved') this.alerts.delete(msg.payload.id);
        else this.alerts.set(msg.payload.id, msg.payload);
        this.notifyNow(); break;
      }
      case 'incident.created':
      case 'incident.updated': { this.incidents.set(msg.payload.id, msg.payload); this.notifyNow(); break; }
      case 'task.created':
      case 'task.updated': { this.tasks.set(msg.payload.id, msg.payload); this.notifyNow(); break; }
      case 'event': { this.events.unshift(msg.payload); if (this.events.length > 200) this.events.pop(); this.notify(); break; }
      default: break;
    }
  }
}

interface SnapshotPayload { assets: Asset[]; alerts: Alert[]; incidents: Incident[]; events: OpsEvent[]; }

export const live = new LiveStore();
