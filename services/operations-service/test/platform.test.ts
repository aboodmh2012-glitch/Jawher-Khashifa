// Tests for the platform baseline packages added on the branch (provider-sdk,
// plugin-sdk, edge-runtime). These carried real logic but no tests; cover the
// invariants here using the existing node:test + tsx harness.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ProviderRegistry, providerSupports } from '@fusion/provider-sdk';
import { AppRegistry } from '@fusion/plugin-sdk';
import { EdgeRuntime, MemoryEdgeJournal, type EdgeEvent, type SyncTransport } from '@fusion/edge-runtime';
import type { PlatformProvider, PlatformApp, PlatformContext } from '@fusion/platform-contracts';

const ctx: PlatformContext = { organizationId: 'org-demo' };

function provider(id: string, caps: PlatformProvider['manifest']['capabilities']): PlatformProvider {
  return { manifest: { id, name: id, version: '1.0.0', capabilities: caps } };
}

test('ProviderRegistry: dedup, capability filter, default health', async () => {
  const reg = new ProviderRegistry();
  reg.register(provider('telem', ['telemetry']));
  reg.register(provider('vid', ['video', 'ai']));
  assert.throws(() => reg.register(provider('telem', ['telemetry'])), /already registered/);
  assert.equal(reg.list('video').length, 1);
  assert.equal(reg.list().length, 2);
  assert.equal(providerSupports(reg.get('vid')!, 'ai'), true);
  const health = await reg.health();
  assert.equal(health.length, 2);
  assert.ok(health.every((h) => h.state === 'ready'));
});

test('AppRegistry: missing-capability check + idempotent activation', async () => {
  const reg = new AppRegistry();
  let activations = 0;
  const app: PlatformApp = { manifest: { id: 'map', name: 'Map', version: '1.0.0', requiredCapabilities: ['maps', 'telemetry'] }, activate: () => { activations += 1; } };
  reg.register(app);
  assert.deepEqual(reg.validateCapabilities('map', new Set(['maps'])), ['missing capability: telemetry']);
  assert.deepEqual(reg.validateCapabilities('map', new Set(['maps', 'telemetry'])), []);
  await reg.activate('map', ctx);
  await reg.activate('map', ctx);           // idempotent — activate runs once
  assert.equal(activations, 1);
  assert.equal(reg.isActive('map'), true);
  await reg.deactivate('map');
  assert.equal(reg.isActive('map'), false);
});

function transport(connected: boolean): SyncTransport & { pushed: EdgeEvent[]; setAck: (n: number) => void } {
  let ack = 0;
  const pushed: EdgeEvent[] = [];
  return {
    pushed,
    setAck: (n) => { ack = n; },
    connected: () => connected,
    async push(events) { pushed.push(...events); return { acceptedThrough: { s1: ack || events[events.length - 1].sequence } }; },
  };
}

const ev = (seq: number): EdgeEvent => ({ id: `e${seq}`, source: 's1', sequence: seq, occurredAt: seq, receivedAt: seq, payload: { seq } });

test('EdgeRuntime: journal-first survives offline, then store-and-forward advances cursor', async () => {
  const journal = new MemoryEdgeJournal();
  const t = transport(false);                 // offline
  const rt = new EdgeRuntime('node-1', journal, t);

  await rt.ingest(ev(1));                      // journaled even though upstream is offline
  await rt.ingest(ev(2));
  let st = await rt.status();
  assert.equal(st.state, 'degraded');
  assert.equal(st.queueDepth, 2);
  assert.equal(await rt.sync('s1'), 0);       // offline → nothing pushed

  const online = transport(true);
  const rt2 = new EdgeRuntime('node-1', journal, online);
  const n = await rt2.sync('s1');             // now flush
  assert.equal(n, 2);
  assert.equal(online.pushed.length, 2);
  const st2 = await rt2.status();
  assert.equal(st2.cursors[0]?.sequence, 2);  // cursor advanced to acceptedThrough
  assert.equal(await rt2.sync('s1'), 0);      // nothing left after cursor
});

test('MemoryEdgeJournal: de-duplicates by (source, sequence) and reads after cursor', async () => {
  const j = new MemoryEdgeJournal();
  await j.append(ev(1));
  await j.append(ev(1));                       // duplicate ignored
  await j.append(ev(2));
  assert.equal(await j.pendingCount(), 2);
  const after = await j.readAfter('s1', 1, 10);
  assert.deepEqual(after.map((e) => e.sequence), [2]);
});
