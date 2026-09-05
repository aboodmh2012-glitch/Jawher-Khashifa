# Adapter SDK

Every integration implements the same contract so the core stays decoupled from
hardware and vendors (§23).

## Contract (`@fusion/adapter-sdk`)

```ts
interface Adapter {
  readonly name: string;
  readonly kind: string;               // 'skynode' | 'mavlink' | 'tak' | 'video' | ...
  start(ctx: AdapterContext): void | Promise<void>;
  stop(): void | Promise<void>;
}

interface AdapterContext {
  onTelemetry(sample: NormalizedTelemetry): void;   // main data path
  onAssetUp(asset: AssetSeed): void;                 // announce an asset
  onAssetDown(assetId: string): void;                // link lost
  onEvent(topic: string, message: string, source?: string): void;
  log(message: string): void;
}
```

Extend `BaseAdapter` to reduce boilerplate. Register an adapter in
`services/operations-service/src/adapters.ts` (or load from config in Phase 7).

## Shipped adapters

| Package | kind | Purpose |
|---|---|---|
| `@fusion/adapter-skynode` | `skynode` | Auterion Skynode X / PX4 → normalized telemetry, **+ UAV simulator** |
| `@fusion/adapter-sdk` | `generic-fleet` | ground-vehicle / sensor / camera **simulator** |
| `@fusion/adapter-mavlink` | `mavlink` | generic MAVLink frame → normalized telemetry (transport TBD) |
| `@fusion/adapter-tak` | `tak` | internal Asset ↔ Cursor-on-Target (CoT) |
| `@fusion/adapter-video` | `video` | RTSP / WebRTC / HLS stream descriptors |

## Skynode / PX4

`normalizeSkynode(raw)` maps the Skynode/PX4 field set (device_id, vehicle_id,
lat/lon/alt, heading, ground/vertical speed, flight_mode, gps_fix + sats, battery
voltage/%, link_quality, vehicle_health, mission, sensor/camera status) into
`NormalizedTelemetry`. Swap this mapping for the real Auterion SDK; nothing
downstream changes. The included `SkynodeSimAdapter` produces the same shape so
the whole command center is demonstrable before hardware arrives.

## Writing a new adapter

```ts
import { BaseAdapter, type AdapterContext } from '@fusion/adapter-sdk';

export class MySourceAdapter extends BaseAdapter {
  readonly name = 'My Source';
  readonly kind = 'my-source';
  protected onStart(ctx: AdapterContext) {
    // connect to your source, then for each update:
    ctx.onAssetUp({ id: 'X-1', name: 'Unit 1', type: 'ground-vehicle' });
    ctx.onTelemetry(/* NormalizedTelemetry */);
  }
}
```

## TAK interoperability (§12)

`@fusion/adapter-tak` keeps the core TAK-agnostic. `assetToCoT(asset)` publishes
a platform asset as a CoT `<event>` (civilian affiliation only); `cotToTelemetry`
ingests ATAK/WinTAK/iTAK tracks. Wire a live TLS stream to a TAK Server /
OpenTAKServer / FreeTAKServer in Phase 6 (prefer the MIT `@tak-ps/node-cot` /
`@tak-ps/node-tak`).
