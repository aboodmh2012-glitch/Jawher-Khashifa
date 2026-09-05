// Dependency-free SVG line chart for live/historical telemetry (§6).

export function Sparkline({ data, color = '#37c6cb', height = 44, min, max }: {
  data: number[]; color?: string; height?: number; min?: number; max?: number;
}) {
  const w = 280;
  const pts = data.filter((v) => v != null && !Number.isNaN(v));
  if (pts.length < 2) return <svg viewBox={`0 0 ${w} ${height}`} width="100%" height={height} preserveAspectRatio="none" />;
  const lo = min ?? Math.min(...pts);
  const hi = max ?? Math.max(...pts);
  const span = hi - lo || 1;
  const x = (i: number) => (i / (pts.length - 1)) * w;
  const y = (v: number) => height - 3 - ((v - lo) / span) * (height - 6);
  const line = pts.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const area = `${line} L${w},${height} L0,${height} Z`;
  const gid = `g-${color.replace('#', '')}`;
  return (
    <svg viewBox={`0 0 ${w} ${height}`} width="100%" height={height} preserveAspectRatio="none">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gid})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
      <circle cx={x(pts.length - 1)} cy={y(pts[pts.length - 1])} r="2.4" fill={color} />
    </svg>
  );
}
