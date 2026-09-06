// Dependency-free metrics registry with a Prometheus text renderer. Real
// OpenTelemetry/Prometheus exporters plug in later; the app depends on THIS
// interface so instrumentation code never changes.

type Labels = Record<string, string>;

function key(labels?: Labels): string {
  if (!labels) return '';
  return Object.keys(labels).sort().map((k) => `${k}=${labels[k]}`).join(',');
}
function renderLabels(labels: string): string {
  if (!labels) return '';
  const pairs = labels.split(',').map((p) => {
    const [k, v] = p.split('=');
    return `${k}="${(v ?? '').replace(/"/g, '\\"')}"`;
  });
  return `{${pairs.join(',')}}`;
}

class Counter {
  private values = new Map<string, number>();
  constructor(readonly name: string, readonly help: string) {}
  inc(n = 1, labels?: Labels): void {
    const k = key(labels);
    this.values.set(k, (this.values.get(k) ?? 0) + n);
  }
  render(): string {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} counter`];
    if (this.values.size === 0) lines.push(`${this.name} 0`);
    for (const [k, v] of this.values) lines.push(`${this.name}${renderLabels(k)} ${v}`);
    return lines.join('\n');
  }
}

class Gauge {
  private values = new Map<string, number>();
  constructor(readonly name: string, readonly help: string) {}
  set(v: number, labels?: Labels): void { this.values.set(key(labels), v); }
  inc(n = 1, labels?: Labels): void { const k = key(labels); this.values.set(k, (this.values.get(k) ?? 0) + n); }
  dec(n = 1, labels?: Labels): void { this.inc(-n, labels); }
  render(): string {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} gauge`];
    if (this.values.size === 0) lines.push(`${this.name} 0`);
    for (const [k, v] of this.values) lines.push(`${this.name}${renderLabels(k)} ${v}`);
    return lines.join('\n');
  }
}

class Histogram {
  private buckets: number[];
  private counts = new Map<string, number[]>();
  private sums = new Map<string, number>();
  private totals = new Map<string, number>();
  constructor(readonly name: string, readonly help: string, buckets?: number[]) {
    this.buckets = (buckets ?? [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500]).slice().sort((a, b) => a - b);
  }
  observe(value: number, labels?: Labels): void {
    const k = key(labels);
    const arr = this.counts.get(k) ?? this.buckets.map(() => 0);
    for (let i = 0; i < this.buckets.length; i++) if (value <= this.buckets[i]) arr[i] += 1;
    this.counts.set(k, arr);
    this.sums.set(k, (this.sums.get(k) ?? 0) + value);
    this.totals.set(k, (this.totals.get(k) ?? 0) + 1);
  }
  render(): string {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} histogram`];
    for (const [k, arr] of this.counts) {
      const base = renderLabels(k).replace(/}$/, '');
      for (let i = 0; i < this.buckets.length; i++) {
        const lbl = base ? `${base},le="${this.buckets[i]}"}` : `{le="${this.buckets[i]}"}`;
        lines.push(`${this.name}_bucket${lbl} ${arr[i]}`);
      }
      const infLbl = base ? `${base},le="+Inf"}` : `{le="+Inf"}`;
      lines.push(`${this.name}_bucket${infLbl} ${this.totals.get(k) ?? 0}`);
      lines.push(`${this.name}_sum${renderLabels(k)} ${this.sums.get(k) ?? 0}`);
      lines.push(`${this.name}_count${renderLabels(k)} ${this.totals.get(k) ?? 0}`);
    }
    return lines.join('\n');
  }
}

export class MetricsRegistry {
  private counters = new Map<string, Counter>();
  private gauges = new Map<string, Gauge>();
  private histograms = new Map<string, Histogram>();

  counter(name: string, help = ''): Counter {
    let c = this.counters.get(name);
    if (!c) { c = new Counter(name, help); this.counters.set(name, c); }
    return c;
  }
  gauge(name: string, help = ''): Gauge {
    let g = this.gauges.get(name);
    if (!g) { g = new Gauge(name, help); this.gauges.set(name, g); }
    return g;
  }
  histogram(name: string, help = '', buckets?: number[]): Histogram {
    let h = this.histograms.get(name);
    if (!h) { h = new Histogram(name, help, buckets); this.histograms.set(name, h); }
    return h;
  }
  /** Prometheus text exposition format. */
  render(): string {
    const blocks: string[] = [];
    for (const c of this.counters.values()) blocks.push(c.render());
    for (const g of this.gauges.values()) blocks.push(g.render());
    for (const h of this.histograms.values()) blocks.push(h.render());
    return blocks.join('\n') + '\n';
  }
}

export type { Counter, Gauge, Histogram };

/** Process-wide default registry. */
export const metrics = new MetricsRegistry();
