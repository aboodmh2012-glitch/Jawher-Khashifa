import { live } from '../live-store.js';
import { hhmmss } from '../util.js';

export function Timeline() {
  const events = live.events.slice(0, 60);
  return (
    <div className="float timeline">
      <div className="panel-head">
        <h3>Event Timeline</h3>
        <span className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>live</span>
      </div>
      <div className="body">
        {events.length === 0 && <div className="empty">Awaiting events…</div>}
        {events.map((e) => (
          <div key={e.id} className={`ev ${e.severity ? `sev-${e.severity}` : ''}`}>
            <span className="t">{hhmmss(e.at)}</span>
            <span className="topic">{e.topic}</span>
            <span className="msg">{e.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
