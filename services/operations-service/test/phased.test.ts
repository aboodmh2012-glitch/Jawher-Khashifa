import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MetricsRegistry, withTimeout, retry, CircuitBreaker, TimeoutError } from '@fusion/observability';
import { createBus } from '../src/bus.js';
import { envelope } from '@fusion/event-contracts';
import type { OpsEvent } from '@fusion/shared-types';

test('metrics registry renders Prometheus text', () => {
  const reg = new MetricsRegistry();
  reg.counter('widgets_total', 'widgets').inc(2, { kind: 'a' });
  reg.gauge('temp', 'temp').set(21);
  reg.histogram('lat_ms', 'latency', [10, 100]).observe(5);
  const text = reg.render();
  assert.match(text, /widgets_total\{kind="a"\} 2/);
  assert.match(text, /temp 21/);
  assert.match(text, /lat_ms_count 1/);
  assert.match(text, /# TYPE lat_ms histogram/);
});

test('withTimeout rejects a slow promise', async () => {
  await assert.rejects(withTimeout(new Promise(() => {}), 20, 'slow'), (e) => e instanceof TimeoutError);
  assert.equal(await withTimeout(Promise.resolve(7), 50), 7);
});

test('retry succeeds after transient failures, bounded', async () => {
  let attempts = 0;
  const v = await retry(async () => { attempts += 1; if (attempts < 3) throw new Error('flap'); return 'ok'; }, { retries: 5, baseMs: 1 });
  assert.equal(v, 'ok');
  assert.equal(attempts, 3);
  await assert.rejects(retry(async () => { throw new Error('always'); }, { retries: 2, baseMs: 1 }));
});

test('circuit breaker opens after threshold failures', async () => {
  const cb = new CircuitBreaker(2, 10_000);
  const boom = () => Promise.reject(new Error('x'));
  await assert.rejects(cb.exec(boom));
  await assert.rejects(cb.exec(boom));
  assert.equal(cb.state, 'open');
  await assert.rejects(cb.exec(() => Promise.resolve('never')), /circuit open/);
});

test('memory bus is idempotent (dedup by eventId)', () => {
  const bus = createBus('memory');
  const got: unknown[] = [];
  bus.subscribe((m) => got.push(m));
  const ev = envelope('event', { id: 'e1', orgId: 'o', at: Date.now(), topic: 't', message: 'm' } as OpsEvent);
  bus.publish(ev);
  bus.publish(ev);          // same eventId → dropped
  assert.equal(got.length, 1);
});
