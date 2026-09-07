import { useEffect, useState } from 'react';
import type { OperationalBrief } from '@fusion/shared-types';
import { api } from '../api.js';
import { live } from '../live-store.js';

export function Insights() {
  const [brief, setBrief] = useState<OperationalBrief | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let disposed = false;
    const refresh = async () => {
      try { const next = await api.insights(); if (!disposed) { setBrief(next); setError(''); } }
      catch { if (!disposed) setError('Refresh failed. Previously loaded information may be stale.'); }
    };
    void refresh(); const timer = setInterval(() => void refresh(), 10000);
    return () => { disposed = true; clearInterval(timer); };
  }, []);
  return <div className="float listview">
    <div className="panel-head"><h3>Operations brief</h3></div>
    <div className="body">
      <p style={{ padding: '0 16px', color: 'var(--muted)' }}>Review connectivity, incident priorities and overdue work. Each finding links to its source record.</p>
      {error && <p role="alert" style={{ padding: 16 }}>{error}</p>}
      {!brief && !error && <div className="empty">Loading brief…</div>}
      {brief && <p style={{ padding: '0 16px' }}>Updated {new Date(brief.generatedAt).toLocaleTimeString()} · {brief.totalFindings} findings</p>}
      {brief?.totalFindings === 0 && <div className="empty">No findings from the current checks.</div>}
      {brief?.insights.map(item => <div className="lrow" key={item.id}>
        <span className={`pill ${item.severity}`}>{item.severity === 'critical' ? '!' : 'i'}</span>
        <div><div className="title">{item.title}</div><div className="sub">{item.recommendation}</div>
          <div className="sub">{item.evidence.resourceType} · {item.evidence.resourceId}</div></div>
        {item.evidence.resourceType === 'asset' && <button className="btn" onClick={() => live.select(item.evidence.resourceId)}>Locate</button>}
      </div>)}
    </div>
  </div>;
}
