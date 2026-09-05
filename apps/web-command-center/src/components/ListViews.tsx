import { live } from '../live-store.js';
import { AssetGlyph } from './icons.js';
import { assetColor, fmt, ago } from '../util.js';

export function AssetsList() {
  const assets = [...live.assets.values()].sort((a, b) => a.name.localeCompare(b.name));
  return (
    <div className="float listview">
      <div className="panel-head"><h3>Assets · {assets.length}</h3></div>
      <div className="body">
        {assets.map((a) => (
          <div key={a.id} className={`lrow ${live.selectedId === a.id ? 'sel' : ''}`} onClick={() => live.select(a.id)}>
            <span className="ico"><AssetGlyph type={a.type} color={assetColor(a.type)} size={22} /></span>
            <div>
              <div className="title">{a.name}</div>
              <div className="sub">{a.type} · {fmt(a.latest?.groundSpeed, 1, ' m/s')} · {ago(a.lastSeen)}</div>
            </div>
            <span className={`pill ${a.link === 'live' ? 'active' : a.link === 'offline' ? 'critical' : a.link === 'delayed' ? 'monitoring' : 'minor'}`}>{a.link}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function IncidentsList() {
  const incidents = [...live.incidents.values()].sort((a, b) => b.updatedAt - a.updatedAt);
  return (
    <div className="float listview">
      <div className="panel-head"><h3>Incidents · {incidents.length}</h3></div>
      <div className="body">
        {incidents.map((i) => (
          <div key={i.id} className="lrow" onClick={() => live.select(null)}>
            <span className={`pill ${i.severity}`} style={{ justifySelf: 'center' }}>{i.severity[0].toUpperCase()}</span>
            <div>
              <div className="title">{i.title}</div>
              <div className="sub">{i.type}{i.description ? ` · ${i.description}` : ''}</div>
            </div>
            <span className={`pill ${i.status}`}>{i.status}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function TasksList() {
  const tasks = live.tasksList();
  return (
    <div className="float listview">
      <div className="panel-head"><h3>Tasks</h3></div>
      <div className="body">
        {tasks.length === 0 && <div className="empty">Loading tasks…</div>}
        {tasks.map((t) => (
          <div key={t.id} className="lrow">
            <span className={`pill ${t.priority}`} style={{ justifySelf: 'center' }}>{t.priority[0].toUpperCase()}</span>
            <div>
              <div className="title">{t.name}</div>
              <div className="sub">{t.type}{t.assignedAssetId ? ` · ${t.assignedAssetId}` : ''}</div>
            </div>
            <span className={`pill ${t.status}`}>{t.status}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
