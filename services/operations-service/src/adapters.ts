// Wires adapters into the platform: builds the AdapterContext that turns adapter
// callbacks into store mutations + bus messages + alert evaluation, and starts
// the demo adapters (§26). Adding a real adapter later = instantiate it here (or
// load from config) and call start(ctx) — nothing else changes.

import { envelope, newId, type EventMeta } from '@fusion/event-contracts';
import { validate } from '@fusion/validation';
import type { Adapter, AdapterContext } from '@fusion/adapter-sdk';
import { SimFleetAdapter } from '@fusion/adapter-sdk';
import { SkynodeSimAdapter } from '@fusion/adapter-skynode';
import type { Store } from './store.js';
import type { Bus } from './bus.js';
import type { AlertEngine } from './alerts.js';
import { config } from './config.js';

export function buildContext(store: Store, bus: Bus, alerts: AlertEngine): AdapterContext {
  return {
    onRaw(protocol, messageType, payload, ref) {
      // RAW IS ALWAYS JOURNALED BEFORE ANY DERIVED DATA IS PUBLISHED.
      const raw = store.addRawEvent(protocol, messageType, payload, ref);
      return {
        rawEventId: raw.id, correlationId: raw.correlationId,
        sourceProtocol: protocol, sourceMessageType: messageType,
        receivedAt: raw.receivedAt, parserVersion: raw.parserVersion,
      };
    },
    onTelemetry(t, provenance) {
      if (provenance) t.provenance = provenance;
      // Runtime validation at the domain boundary. Invalid → quarantine, never crash.
      const res = validate('telemetry.v1', t);
      if (!res.valid) {
        store.addQuarantine({
          id: newId(), schemaId: res.schemaId, schemaVersion: res.schemaVersion, errors: res.errors,
          source: provenance?.sourceProtocol ?? 'unknown', rawEventId: provenance?.rawEventId,
          correlationId: provenance?.correlationId, payload: t, at: Date.now(),
        });
        const ev = store.addEvent('telemetry.quarantined',
          `Quarantined telemetry from ${provenance?.sourceProtocol ?? 'unknown'}: ${res.errors[0]?.message ?? 'invalid'}`,
          t.assetId, 'warning');
        bus.publish(envelope('event', ev));
        return;
      }
      const asset = store.applyTelemetry(t);
      if (!asset) return;
      const meta: EventMeta = {
        source: provenance?.sourceProtocol ?? 'core',
        correlationId: provenance?.correlationId,
        causationId: provenance?.rawEventId,
        assetId: asset.id,
        organizationId: asset.orgId,
      };
      bus.publish(envelope('asset.position', {
        assetId: asset.id, lat: t.position.lat, lon: t.position.lon,
        altitude: t.position.altitude, heading: t.heading, groundSpeed: t.groundSpeed,
      }, meta));
      bus.publish(envelope('asset.telemetry', t, meta));
      alerts.evaluate(asset);
    },
    onAssetUp(seed) {
      const asset = store.upsertAssetSeed(seed);
      bus.publish(envelope('asset.connected', { asset }));
    },
    onAssetDown(assetId) {
      const asset = store.assets.get(assetId);
      if (asset) { asset.link = 'offline'; }
      bus.publish(envelope('asset.disconnected', { assetId }));
    },
    onEvent(topic, message, source) {
      const ev = store.addEvent(topic, message, source);
      bus.publish(envelope('event', ev));
    },
    log(message) { console.log(`[adapter] ${message}`); },
  };
}

export function startAdapters(store: Store, bus: Bus, alerts: AlertEngine): () => void {
  const ctx = buildContext(store, bus, alerts);
  const adapters: Adapter[] = [];

  if (config.sim.enabled) {
    adapters.push(new SkynodeSimAdapter({
      count: config.sim.uavCount, center: config.sim.center, orgId: config.defaultOrgId, intervalMs: 1000,
    }));
    adapters.push(new SimFleetAdapter({
      center: config.sim.center, orgId: config.defaultOrgId, vehicles: 2, sensors: 2, cameras: 1,
    }));
  }

  for (const a of adapters) { void a.start(ctx); console.log(`[adapters] started: ${a.name}`); }
  return () => { for (const a of adapters) void a.stop(); };
}
