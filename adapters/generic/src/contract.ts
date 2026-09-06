// @fusion/adapter-sdk — the documented contract every integration implements (§23).
//
// The platform core never talks to hardware. It talks to Adapters. An adapter's
// only job: pull/receive from its source and push NORMALIZED telemetry + asset
// lifecycle events into the platform through the AdapterContext. This is what
// keeps the core decoupled from any single autopilot or manufacturer.

import type { Asset, AssetType, NormalizedTelemetry, TelemetryProvenance } from '@fusion/shared-types';

/** Reference to a journaled raw event, returned by `onRaw` so the adapter can
 *  attach provenance to the telemetry it derives. */
export type RawEventRef = TelemetryProvenance;

/** What the platform hands every adapter so it can report upstream. */
export interface AdapterContext {
  /** Record the original, unparsed source message in the raw journal (replayability).
   *  Returns a provenance ref the adapter passes to `onTelemetry`, so derived data
   *  is always traceable back to its raw source. */
  onRaw(protocol: string, messageType: string, payload: unknown, ref?: { assetId?: string; deviceId?: string }): RawEventRef;
  /** Report a normalized telemetry sample. Pass the raw ref so the platform can
   *  stamp provenance; adapter-sourced telemetry should always carry it. */
  onTelemetry(sample: NormalizedTelemetry, provenance?: RawEventRef): void;
  /** Announce/refresh an asset the adapter manages. */
  onAssetUp(asset: AssetSeed): void;
  /** Mark an asset as gone (link lost / device removed). */
  onAssetDown(assetId: string): void;
  /** Emit a human-readable operational event onto the timeline. */
  onEvent(topic: string, message: string, source?: string): void;
  /** Structured logging for the adapter. */
  log(message: string): void;
}

export interface AssetSeed {
  id: string;
  name: string;
  type: AssetType;
  deviceId?: string;
  orgId?: string;
  tags?: string[];
  initial?: Partial<Pick<Asset, 'position' | 'heading' | 'health'>>;
}

/** The contract. Every adapter (Skynode, MAVLink, TAK, Video, Generic) implements it. */
export interface Adapter {
  readonly name: string;
  /** kebab identifier, e.g. "skynode", "mavlink", "tak". */
  readonly kind: string;
  start(ctx: AdapterContext): Promise<void> | void;
  stop(): Promise<void> | void;
}

/** Adapters are created from typed config by a factory. */
export type AdapterFactory<Config = Record<string, unknown>> = (config: Config) => Adapter;

/** Small helper base to reduce boilerplate in concrete adapters. */
export abstract class BaseAdapter implements Adapter {
  abstract readonly name: string;
  abstract readonly kind: string;
  protected ctx: AdapterContext | null = null;
  start(ctx: AdapterContext): void | Promise<void> {
    this.ctx = ctx;
    return this.onStart(ctx);
  }
  stop(): void | Promise<void> {
    return this.onStop();
  }
  protected abstract onStart(ctx: AdapterContext): void | Promise<void>;
  protected onStop(): void | Promise<void> {}
}
