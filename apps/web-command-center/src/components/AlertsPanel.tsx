import type { Alert } from '@fusion/shared-types';
import { live } from '../live-store.js';
import { api } from '../api.js';
import { hhmmss } from '../util.js';

export function AlertsPanel({ canAct }: { canAct: boolean }) {
  const alerts = [...live.alerts.values()].filter((a) => a.status !== 'resolved').sort((a, b) => b.createdAt - a.createdAt);

  async function ack(a: Alert) {
    try { await api.ackAlert(a.id); } catch { /* surfaced via connection state */ }
  }

  return (
    <div className="float rightpanel">
      <div className="panel-head">
        <h3>Active Alerts</h3>
        <span className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>{alerts.length}</span>
      </div>
      <div className="body" style={{ padding: 0 }}>
        {alerts.length === 0 && <div className="empty">No active alerts. All monitored assets nominal.</div>}
        {alerts.map((a) => (
          <div key={a.id} className="alert-row">
            <span className={`sev sev-${a.severity}`} />
            <div>
              <div className="msg">{a.message}</div>
              <div className="meta">{a.kind} · {a.sourceName ?? a.source} · {hhmmss(a.createdAt)}{a.status === 'acknowledged' ? ' · ack' : ''}</div>
            </div>
            {canAct && a.status === 'open' ? <button className="ackbtn" onClick={() => ack(a)}>ACK</button> : <span />}
          </div>
        ))}
      </div>
    </div>
  );
}
