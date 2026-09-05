import { useState } from 'react';
import type { Asset } from '@fusion/shared-types';
import { live } from '../live-store.js';
import { AssetGlyph } from './icons.js';
import { Sparkline } from './Sparkline.js';
import { assetColor, fmt, ago } from '../util.js';

type Tab = 'telemetry' | 'history' | 'events' | 'media' | 'tasks' | 'maintenance';
const TABS: Tab[] = ['telemetry', 'history', 'events', 'media', 'tasks', 'maintenance'];

export function AssetPanel({ asset, canAct }: { asset: Asset; canAct: boolean }) {
  const [tab, setTab] = useState<Tab>('telemetry');
  const t = asset.latest;
  const buf = live.telem.get(asset.id) ?? [];
  const color = assetColor(asset.type);

  return (
    <div className="float rightpanel">
      <div className="panel-head">
        <h3>Selected Asset</h3>
        <button className="x" onClick={() => live.select(null)}>×</button>
      </div>
      <div className="body">
        <div className="asset-title">
          <AssetGlyph type={asset.type} color={color} size={26} />
          <span className="name">{asset.name}</span>
        </div>
        <div className="asset-sub">{asset.id} · {asset.type} · {asset.deviceId ?? 'no-device'}</div>
        <div className="chips">
          <span className={`chip ${asset.link}`}>{asset.link}</span>
          <span className={`chip ${asset.health === 'nominal' ? 'live' : asset.health === 'warning' ? 'delayed' : asset.health === 'critical' ? 'offline' : 'unknown'}`}>health: {asset.health}</span>
          {t?.flightMode && <span className="chip">{t.flightMode}</span>}
          {asset.activeTaskId && <span className="chip">tasked</span>}
        </div>

        <div className="tabs">
          {TABS.map((x) => <button key={x} className={`tab ${tab === x ? 'active' : ''}`} onClick={() => setTab(x)}>{x[0].toUpperCase() + x.slice(1)}</button>)}
        </div>
        <div style={{ paddingTop: 12 }}>
          {tab === 'telemetry' && <Telemetry asset={asset} />}
          {tab === 'history' && <History buf={buf} color={color} />}
          {tab === 'events' && <Events assetId={asset.id} />}
          {tab === 'media' && <Media asset={asset} />}
          {tab === 'tasks' && <Tasks assetId={asset.id} />}
          {tab === 'maintenance' && <Maintenance asset={asset} />}
        </div>
      </div>
    </div>
  );
}

function Readout({ l, v, sub }: { l: string; v: string; sub?: string }) {
  return <div className="readout"><div className="l">{l}</div><div className="v">{v}{sub && <small> {sub}</small>}</div></div>;
}

function Telemetry({ asset }: { asset: Asset }) {
  const t = asset.latest;
  const buf = live.telem.get(asset.id) ?? [];
  const battery = t?.battery?.percentage;
  const batteryColor = battery == null ? '#6c8199' : battery < 20 ? '#ff5d57' : battery < 40 ? '#e8a640' : '#4fbf83';
  return (
    <>
      <div className="readouts">
        <Readout l="Altitude" v={fmt(t?.position.altitude, 0)} sub="m" />
        <Readout l="Ground speed" v={fmt(t?.groundSpeed, 1)} sub="m/s" />
        <Readout l="Heading" v={fmt(asset.heading, 0)} sub="°" />
        <Readout l="Vert speed" v={fmt(t?.verticalSpeed, 1)} sub="m/s" />
        <Readout l="Battery" v={fmt(battery, 0)} sub="%" />
        <Readout l="Link" v={fmt(t?.linkQuality, 0)} sub="%" />
        <Readout l="GPS" v={t?.gps ? `${t.gps.fix}` : '—'} sub={t?.gps?.satellites != null ? `${t.gps.satellites} sats` : ''} />
        <Readout l="Last telem" v={ago(asset.lastSeen)} />
      </div>
      <div className="chart-block">
        <div className="lbl"><span>Battery</span><b>{fmt(battery, 0, '%')}</b></div>
        <div className="gauge"><i style={{ width: `${battery ?? 0}%`, background: batteryColor }} /></div>
      </div>
      <div className="chart-block">
        <div className="lbl"><span>Altitude</span><b>{fmt(t?.position.altitude, 0, ' m')}</b></div>
        <Sparkline data={buf.map((p) => p.altitude ?? 0)} color="#37c6cb" />
      </div>
      <div className="chart-block">
        <div className="lbl"><span>Ground speed</span><b>{fmt(t?.groundSpeed, 1, ' m/s')}</b></div>
        <Sparkline data={buf.map((p) => p.speed ?? 0)} color="#7c9cff" />
      </div>
      {t?.mission?.active && (
        <div className="chart-block">
          <div className="lbl"><span>Mission</span><b>WP {t.mission.currentWaypoint ?? 0}/{t.mission.totalWaypoints ?? 0}</b></div>
        </div>
      )}
    </>
  );
}

function History({ buf, color }: { buf: { battery?: number; altitude?: number; speed?: number }[]; color: string }) {
  if (buf.length < 2) return <div className="empty">Buffering telemetry… history & replay is a Phase-5 workspace.</div>;
  return (
    <>
      <div className="chart-block"><div className="lbl"><span>Battery (buffered)</span></div><Sparkline data={buf.map((p) => p.battery ?? 0)} color={color} min={0} max={100} /></div>
      <div className="chart-block"><div className="lbl"><span>Altitude (buffered)</span></div><Sparkline data={buf.map((p) => p.altitude ?? 0)} color="#37c6cb" /></div>
      <div className="empty">Full replay (position + events on a synchronized timeline) arrives in Phase 5.</div>
    </>
  );
}

function Events({ assetId }: { assetId: string }) {
  const evs = live.events.filter((e) => e.source === assetId).slice(0, 20);
  if (!evs.length) return <div className="empty">No events for this asset yet.</div>;
  return <>{evs.map((e) => <div key={e.id} className="ev" style={{ gridTemplateColumns: '62px 1fr' }}><span className="t">{new Date(e.at).toISOString().slice(11, 19)}</span><span className="msg">{e.message}</span></div>)}</>;
}

function Media({ asset }: { asset: Asset }) {
  const streaming = asset.latest?.camera?.state === 'streaming' || asset.latest?.camera?.state === 'recording';
  return (
    <div>
      <div style={{ aspectRatio: '16/9', background: '#05090f', border: '1px solid var(--line)', borderRadius: 8, display: 'grid', placeItems: 'center', color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: 12 }}>
        {streaming ? `▶ ${asset.latest?.camera?.activeStreamId ?? 'primary'} · WebRTC` : 'No active stream'}
      </div>
      <div className="empty">RTSP / WebRTC / HLS player + multi-camera grid land in Phase 5 (video adapter scaffold ready).</div>
    </div>
  );
}

function Tasks({ assetId }: { assetId: string }) {
  void assetId;
  return <div className="empty">Task assignment for this asset appears here (see the Tasks view).</div>;
}

function Maintenance({ asset }: { asset: Asset }) {
  const comps = asset.latest?.health?.components;
  return (
    <div>
      <div className="readouts">
        <Readout l="Overall" v={asset.health} />
        <Readout l="Sensors" v={asset.latest?.sensors?.state ?? '—'} />
        <Readout l="Camera" v={asset.latest?.camera?.state ?? '—'} />
        <Readout l="Device" v={asset.deviceId ?? '—'} />
      </div>
      {comps && Object.entries(comps).map(([k, v]) => <div key={k} className="ev" style={{ gridTemplateColumns: '1fr auto' }}><span>{k}</span><span className={`pill ${v === 'nominal' ? 'active' : 'critical'}`}>{v}</span></div>)}
    </div>
  );
}
