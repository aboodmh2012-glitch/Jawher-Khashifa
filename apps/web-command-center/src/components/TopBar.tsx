import type { User } from '@fusion/shared-types';

const ROLE_LABEL: Record<string, string> = {
  'platform-admin': 'Platform Admin', 'org-admin': 'Org Admin', 'ops-supervisor': 'Ops Supervisor',
  operator: 'Operator', analyst: 'Analyst', 'field-user': 'Field User', viewer: 'Viewer',
};

export function TopBar({ user, connected, alerts, onLogout }: { user: User; connected: boolean; alerts: number; onLogout: () => void }) {
  return (
    <header className="topbar">
      <div className="brand"><span className="logo">◈</span> Fusion <b>Ops</b></div>
      <input className="searchbox" placeholder="Search assets, incidents, tasks…" />
      <div className="spacer" />
      <div className="stat"><span className={`dot ${connected ? '' : 'off'}`} />{connected ? 'LINK LIVE' : 'RECONNECTING'}</div>
      <div className="stat">ALERTS <b style={{ color: alerts ? 'var(--critical)' : 'var(--good)' }}>{alerts}</b></div>
      <div className="stat">OPS <b style={{ color: 'var(--accent)' }}>ACTIVE</b></div>
      <div className="usermenu">
        <div className="avatar">{user.displayName.split(' ').map((s) => s[0]).join('').slice(0, 2)}</div>
        <div>
          <div style={{ fontWeight: 600 }}>{user.displayName}</div>
          <div className="mono" style={{ fontSize: 10, color: 'var(--muted)' }}>{ROLE_LABEL[user.role]}</div>
        </div>
        <button className="chip" onClick={onLogout} style={{ marginLeft: 4 }}>Sign out</button>
      </div>
    </header>
  );
}
