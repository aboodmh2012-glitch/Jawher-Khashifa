// Wires adapters into the platform: builds the AdapterContext that turns adapter
// callbacks into store mutations + bus messages + alert evaluation, and starts
// the demo adapters (§26). Adding a real adapter later = instantiate it here (or
// load from config) and call start(ctx) — nothing else changes.

import { envelope } from '@fusion/event-contracts';
import type { Adapter, AdapterContext } from '@fusion/adapter-sdk';
import { SimFleetAdapter } from '@fusion/adapter-sdk';
import { SkynodeSimAdapter } from '@fusion/adapter-skynode';
import type { Store } from './store.js';
import type { Bus } from './bus.js';
import type { AlertEngine } from './alerts.js';
import { config } from './config.js';

export function buildContext(store: Store, bus: Bus, alerts: AlertEngine): AdapterContext {
  return {
    onRaw(protocol, messageType, payload) {
      const p = payload as { id?: string; vehicle_id?: string; device_id?: string };
      const raw = store.addRawEvent(protocol, messageType, payload, {
        assetId: p?.vehicle_id ?? p?.id, deviceId: p?.device_id,
      });
      return raw.correlationId;
    },
    onTelemetry(t) {
      const asset = store.applyTelemetry(t);
      if (!asset) return;
      bus.publish(envelope('asset.position', {
        assetId: asset.id, lat: t.position.lat, lon: t.position.lon,
        altitude: t.position.altitude, heading: t.heading, groundSpeed: t.groundSpeed,
      }));
      bus.publish(envelope('asset.telemetry', t));
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
