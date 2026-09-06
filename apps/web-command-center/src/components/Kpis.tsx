import { live } from '../live-store.js';

export function Kpis() {
  const assets = [...live.assets.values()];
  const online = assets.filter((a) => a.link === 'live').length;
  const incidents = [...live.incidents.values()].filter((i) => i.status !== 'closed' && i.status !== 'resolved').length;
  const alerts = [...live.alerts.values()].filter((a) => a.status === 'open');
  const critical = alerts.filter((a) => a.severity === 'critical' || a.severity === 'high').length;
  const tracks = [...live.tracks.values()].filter((t) => t.state !== 'archived');
  const confirmed = tracks.filter((t) => t.state === 'confirmed').length;

  return (
    <div className="kpis">
      <div className="kpi"><div className="n">{assets.length}</div><div className="l">Assets</div></div>
      <div className="kpi ok"><div className="n">{online}</div><div className="l">Online</div></div>
      <div className="kpi"><div className="n" style={{ color: 'var(--accent)' }}>{confirmed}/{tracks.length}</div><div className="l">Tracks</div></div>
      <div className="kpi warn"><div className="n">{incidents}</div><div className="l">Incidents</div></div>
      <div className="kpi crit"><div className="n">{critical}</div><div className="l">Crit alerts</div></div>
    </div>
  );
}
