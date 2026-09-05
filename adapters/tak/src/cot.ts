// Internal objects ↔ Cursor-on-Target (CoT), §12.
//
// The core stays TAK-agnostic. This module is the ONLY place that knows CoT: it
// translates a platform Asset into a CoT <event> (to publish up to a TAK Server
// / OpenTAKServer / FreeTAKServer) and parses inbound CoT back into normalized
// telemetry (to ingest ATAK/WinTAK/iTAK tracks). In production, prefer the
// MIT-licensed @tak-ps/node-cot for full XML/Protobuf + Data Package support.

import type { Asset, AssetType, NormalizedTelemetry } from '@fusion/shared-types';

// Map platform asset types to a CoT type. Civilian affiliation ("n" neutral /
// "f" friendly) only — this platform never emits hostile/weapon symbology (§28).
const COT_TYPE: Record<AssetType, string> = {
  uav: 'a-f-A-M-F-Q',
  'ground-vehicle': 'a-f-G-E-V',
  vessel: 'a-f-S-X',
  team: 'a-f-G-U-C',
  sensor: 'a-f-G-U-S',
  camera: 'a-f-G-U-S',
  infrastructure: 'a-n-G-I',
  marker: 'a-n-G',
};

export function assetToCoT(asset: Asset): string | null {
  const p = asset.position;
  if (!p) return null;
  const now = new Date();
  const stale = new Date(now.getTime() + 60_000);
  const type = COT_TYPE[asset.type] ?? 'a-n-G';
  return (
    `<event version="2.0" uid="${asset.id}" type="${type}" how="m-g" ` +
    `time="${now.toISOString()}" start="${now.toISOString()}" stale="${stale.toISOString()}">` +
    `<point lat="${p.lat.toFixed(6)}" lon="${p.lon.toFixed(6)}" hae="${p.altitude ?? 0}" ce="9.9" le="9.9"/>` +
    `<detail><contact callsign="${escapeXml(asset.name)}"/>` +
    `<track course="${(asset.heading ?? 0).toFixed(1)}" speed="${(asset.latest?.groundSpeed ?? 0).toFixed(1)}"/>` +
    `<__fusion assetType="${asset.type}" health="${asset.health}"/></detail></event>`
  );
}

const attr = (xml: string, tag: string, name: string): string | undefined => {
  const m = xml.match(new RegExp(`<${tag}\\b[^>]*\\b${name}="([^"]*)"`, 'i'));
  return m ? m[1] : undefined;
};

export function cotToTelemetry(xml: string): NormalizedTelemetry | null {
  const uid = attr(xml, 'event', 'uid');
  const lat = parseFloat(attr(xml, 'point', 'lat') ?? '');
  const lon = parseFloat(attr(xml, 'point', 'lon') ?? '');
  if (!uid || Number.isNaN(lat) || Number.isNaN(lon)) return null;
  return {
    deviceId: uid,
    assetId: uid,
    timestamp: Date.now(),
    position: { lat, lon, altitude: parseFloat(attr(xml, 'point', 'hae') ?? '0') || 0 },
    heading: parseFloat(attr(xml, 'track', 'course') ?? '') || undefined,
    groundSpeed: parseFloat(attr(xml, 'track', 'speed') ?? '') || undefined,
    health: { state: 'unknown' },
    raw: { cotType: attr(xml, 'event', 'type'), callsign: attr(xml, 'contact', 'callsign') },
  };
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
