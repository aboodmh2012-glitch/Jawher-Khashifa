// OpenTelemetry-shaped tracing abstraction (§D3). No-op by default so the app
// can be instrumented now; a real OTel SDK is wired in later without touching
// call sites. Correlates traceId / correlationId / eventId across the pipeline.

export interface Span {
  setAttribute(key: string, value: string | number | boolean): void;
  end(): void;
}

export interface Tracer {
  startSpan(name: string, attributes?: Record<string, string | number | boolean>): Span;
}

class NoopSpan implements Span {
  setAttribute(): void { /* no-op */ }
  end(): void { /* no-op */ }
}

class NoopTracer implements Tracer {
  startSpan(): Span { return new NoopSpan(); }
}

/** Default tracer. Swap with an OTel-backed Tracer in production. */
export const tracer: Tracer = new NoopTracer();

/** Generate a trace id (works in Node and browsers). */
export function newTraceId(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  return (g.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`).replace(/-/g, '');
}
