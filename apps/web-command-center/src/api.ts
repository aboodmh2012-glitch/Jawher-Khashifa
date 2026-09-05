// REST client. Carries the bearer token on every request and centralizes error
// handling so components stay declarative.

import { config } from './config.js';
import type {
  Asset, Incident, OperationalTask, Alert, OpsEvent, Geofence, RouteEntity, User, TelemetrySample,
} from '@fusion/shared-types';

let token: string | null = localStorage.getItem('fusion.token');

export function setToken(t: string | null) {
  token = t;
  if (t) localStorage.setItem('fusion.token', t);
  else localStorage.removeItem('fusion.token');
}
export function getToken() { return token; }

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(config.apiUrl + path, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error((detail as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.status === 204 ? (undefined as T) : (res.json() as Promise<T>);
}

export const api = {
  login: (username: string, password: string) =>
    req<{ token: string; user: User; expiresAt: number }>('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }),
  me: () => req<User>('/api/auth/me'),
  assets: () => req<Asset[]>('/api/assets'),
  telemetry: (assetId: string, from?: number, to?: number) =>
    req<TelemetrySample[]>(`/api/telemetry/${assetId}${from ? `?from=${from}${to ? `&to=${to}` : ''}` : ''}`),
  incidents: () => req<Incident[]>('/api/incidents'),
  createIncident: (b: Partial<Incident>) => req<Incident>('/api/incidents', { method: 'POST', body: JSON.stringify(b) }),
  updateIncident: (id: string, b: { status?: Incident['status']; note?: string }) =>
    req<Incident>(`/api/incidents/${id}`, { method: 'PATCH', body: JSON.stringify(b) }),
  tasks: () => req<OperationalTask[]>('/api/tasks'),
  alerts: () => req<Alert[]>('/api/alerts'),
  ackAlert: (id: string, notes?: string) => req<Alert>(`/api/alerts/${id}/ack`, { method: 'POST', body: JSON.stringify({ notes }) }),
  events: () => req<OpsEvent[]>('/api/events'),
  geofences: () => req<Geofence[]>('/api/map/geofences'),
  routes: () => req<RouteEntity[]>('/api/map/routes'),
  integrations: () => req<Array<{ kind: string; name: string; status: string }>>('/api/integrations'),
};
