// Resilience utilities (§D4): timeouts, retry-with-backoff, circuit breaker.
// Dependency-free; used to keep one failing dependency/adapter from cascading.

export class TimeoutError extends Error {
  constructor(label: string, ms: number) { super(`${label} timed out after ${ms}ms`); this.name = 'TimeoutError'; }
}

/** Reject if `p` does not settle within `ms`. */
export function withTimeout<T>(p: Promise<T>, ms: number, label = 'operation'): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new TimeoutError(label, ms)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

export interface RetryOptions {
  retries?: number;      // additional attempts after the first
  baseMs?: number;       // backoff base
  maxMs?: number;        // backoff cap
  onRetry?: (attempt: number, err: unknown) => void;
}

/** Retry `fn` with exponential backoff. Never loops forever (bounded by retries). */
export async function retry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const retries = opts.retries ?? 3;
  const base = opts.baseMs ?? 100;
  const max = opts.maxMs ?? 5000;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try { return await fn(); }
    catch (e) {
      lastErr = e;
      if (attempt === retries) break;
      opts.onRetry?.(attempt + 1, e);
      const delay = Math.min(max, base * 2 ** attempt);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

export type CircuitState = 'closed' | 'open' | 'half-open';

/** Trips open after `threshold` consecutive failures; retries after `cooldownMs`. */
export class CircuitBreaker {
  private failures = 0;
  private openedAt = 0;
  state: CircuitState = 'closed';
  constructor(private threshold = 5, private cooldownMs = 10_000) {}

  async exec<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      if (Date.now() - this.openedAt < this.cooldownMs) throw new Error('circuit open');
      this.state = 'half-open';
    }
    try {
      const v = await fn();
      this.failures = 0;
      this.state = 'closed';
      return v;
    } catch (e) {
      this.failures += 1;
      if (this.failures >= this.threshold) { this.state = 'open'; this.openedAt = Date.now(); }
      throw e;
    }
  }
}
