import { useState } from 'react';
import type { User } from '@fusion/shared-types';
import { live } from '../live-store.js';
import { useLive } from '../useLive.js';
import { Icon } from './icons.js';
import { TopBar } from './TopBar.js';
import { MapView } from './MapView.js';
import { Kpis } from './Kpis.js';
import { AssetPanel } from './AssetPanel.js';
import { AlertsPanel } from './AlertsPanel.js';
import { Timeline } from './Timeline.js';
import { AssetsList, IncidentsList, TasksList } from './ListViews.js';

export type View = 'overview' | 'map' | 'assets' | 'incidents' | 'tasks' | 'video' | 'telemetry' | 'comms' | 'history' | 'admin';

const NAV: Array<{ id: View; label: string; icon: keyof typeof Icon }> = [
  { id: 'overview', label: 'Overview', icon: 'overview' },
  { id: 'map', label: 'Map', icon: 'map' },
  { id: 'assets', label: 'Assets', icon: 'assets' },
  { id: 'incidents', label: 'Incidents', icon: 'incidents' },
  { id: 'tasks', label: 'Tasks', icon: 'tasks' },
  { id: 'video', label: 'Video', icon: 'video' },
  { id: 'telemetry', label: 'Telemetry', icon: 'telemetry' },
  { id: 'comms', label: 'Comms', icon: 'comms' },
  { id: 'history', label: 'History', icon: 'history' },
  { id: 'admin', label: 'Admin', icon: 'admin' },
];

export function Shell({ user, onLogout }: { user: User; onLogout: () => void }) {
  const [view, setView] = useState<View>('overview');
  useLive();
  const selected = live.selectedId ? live.assets.get(live.selectedId) : undefined;
  const openAlerts = [...live.alerts.values()].filter((a) => a.status === 'open').length;

  const isOps = view === 'overview' || view === 'map';

  return (
    <div className="shell">
      <TopBar user={user} connected={live.connected} alerts={openAlerts} onLogout={onLogout} />
      <nav className="sidebar">
        {NAV.map((n) => {
          const Ico = Icon[n.icon];
          const badge = n.id === 'incidents' ? [...live.incidents.values()].filter((i) => i.status !== 'closed' && i.status !== 'resolved').length
            : n.id === 'overview' ? openAlerts : 0;
          return (
            <button key={n.id} className={`navbtn ${view === n.id ? 'active' : ''}`} title={n.label} onClick={() => setView(n.id)}>
              <Ico />
              {badge > 0 && <span className="badge">{badge}</span>}
            </button>
          );
        })}
      </nav>

      <div className="workspace">
        <MapView />

        {isOps && <Kpis />}
        {view === 'assets' && <AssetsList />}
        {view === 'incidents' && <IncidentsList />}
        {view === 'tasks' && <TasksList />}

        {(isOps || view === 'assets' || view === 'telemetry') && (
          selected ? <AssetPanel asset={selected} canAct={user.role !== 'viewer'} />
            : isOps ? <AlertsPanel canAct={user.role !== 'viewer'} /> : null
        )}

        {(isOps || view === 'assets') && <Timeline />}

        {(view === 'video' || view === 'comms' || view === 'history' || view === 'admin' || view === 'telemetry') && !selected && (
          <StubView view={view} />
        )}
      </div>
    </div>
  );
}

function StubView({ view }: { view: View }) {
  const copy: Record<string, { t: string; d: string }> = {
    video: { t: 'Video & Sensor Center', d: 'RTSP / WebRTC / HLS multi-camera grid synchronized with telemetry and map position. Adapter scaffold ready (Phase 5).' },
    comms: { t: 'Operations Communications', d: 'Ops rooms, incident rooms, team channels and location sharing. Matrix integration seam is in place (Phase 6).' },
    history: { t: 'History & Replay', d: 'Replay position, telemetry, alerts and events on a synchronized timeline (Phase 5). Live telemetry is already buffered per asset.' },
    admin: { t: 'Administration', d: 'Users, organizations, devices, roles (RBAC) and audit log. Backend audit + roles are active; management UI lands in Phase 7.' },
    telemetry: { t: 'Telemetry Center', d: 'Select an asset on the map to view live and historical charts. Full mission-timeline workspace arrives in Phase 5.' },
  };
  const c = copy[view];
  return <div className="stub"><div className="float card" style={{ padding: 30 }}><h2>{c.t}</h2><p>{c.d}</p></div></div>;
}
