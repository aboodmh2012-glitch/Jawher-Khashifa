// Minimal inline stroke icons (no icon-font dependency).
import type { AssetType } from '@fusion/shared-types';

const S = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

export const Icon = {
  overview: () => <svg viewBox="0 0 24 24" {...S}><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></svg>,
  map: () => <svg viewBox="0 0 24 24" {...S}><path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Z" /><path d="M9 4v14M15 6v14" /></svg>,
  assets: () => <svg viewBox="0 0 24 24" {...S}><path d="M12 3l9 5-9 5-9-5 9-5Z" /><path d="M3 12l9 5 9-5M3 16l9 5 9-5" /></svg>,
  incidents: () => <svg viewBox="0 0 24 24" {...S}><path d="M12 3 2 20h20L12 3Z" /><path d="M12 10v5M12 18h.01" /></svg>,
  tasks: () => <svg viewBox="0 0 24 24" {...S}><rect x="4" y="4" width="16" height="16" rx="2" /><path d="m8 12 3 3 5-6" /></svg>,
  video: () => <svg viewBox="0 0 24 24" {...S}><rect x="3" y="6" width="12" height="12" rx="2" /><path d="m15 10 6-3v10l-6-3" /></svg>,
  telemetry: () => <svg viewBox="0 0 24 24" {...S}><path d="M3 3v18h18" /><path d="m7 15 3-4 3 3 4-6" /></svg>,
  comms: () => <svg viewBox="0 0 24 24" {...S}><path d="M4 5h16v11H8l-4 4V5Z" /></svg>,
  history: () => <svg viewBox="0 0 24 24" {...S}><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5M12 8v4l3 2" /></svg>,
  admin: () => <svg viewBox="0 0 24 24" {...S}><circle cx="12" cy="8" r="3" /><path d="M5 20a7 7 0 0 1 14 0" /></svg>,
};

export function AssetGlyph({ type, color = 'currentColor', size = 24 }: { type: AssetType; color?: string; size?: number }) {
  const p = { fill: 'none', stroke: color, strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  const inner = () => {
    switch (type) {
      case 'uav': return <path d="M12 12v5M4 6l6 6M20 6l-6 6M4 6h3M20 6h-3M10 12h4" {...p} />;
      case 'ground-vehicle': return <><rect x="4" y="10" width="16" height="6" rx="1" {...p} /><circle cx="8" cy="18" r="1.6" {...p} /><circle cx="16" cy="18" r="1.6" {...p} /></>;
      case 'vessel': return <path d="M4 14h16l-2 4H6l-2-4ZM12 4v10M12 6l5 2" {...p} />;
      case 'sensor': return <><circle cx="12" cy="12" r="2" {...p} /><path d="M12 5v2M12 17v2M5 12h2M17 12h2" {...p} /></>;
      case 'camera': return <><rect x="4" y="7" width="11" height="10" rx="1.5" {...p} /><path d="m15 11 5-2v6l-5-2" {...p} /></>;
      case 'team': return <><circle cx="9" cy="9" r="2.4" {...p} /><path d="M4 18a5 5 0 0 1 10 0" {...p} /></>;
      default: return <circle cx="12" cy="12" r="6" {...p} />;
    }
  };
  return <svg viewBox="0 0 24 24" width={size} height={size}>{inner()}</svg>;
}
