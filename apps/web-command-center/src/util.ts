import type { AssetType } from '@fusion/shared-types';

export const ASSET_COLOR: Record<AssetType, string> = {
  uav: '#37c6cb',
  'ground-vehicle': '#7c9cff',
  vessel: '#4fbf83',
  team: '#e8a640',
  sensor: '#b98cff',
  camera: '#4fbf83',
  infrastructure: '#8aa0b8',
  marker: '#9db0c6',
};

export function assetColor(t: AssetType): string { return ASSET_COLOR[t] ?? '#9db0c6'; }

export function hhmmss(ts: number): string {
  return new Date(ts).toISOString().slice(11, 19) + 'Z';
}

export function ago(ts?: number): string {
  if (!ts) return '—';
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

export function fmt(n: number | undefined, digits = 0, unit = ''): string {
  if (n == null || Number.isNaN(n)) return '—';
  return `${n.toFixed(digits)}${unit}`;
}
