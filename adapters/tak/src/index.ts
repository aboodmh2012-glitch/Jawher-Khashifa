export { assetToCoT, cotToTelemetry } from './cot.js';

import { BaseAdapter, type AdapterContext } from '@fusion/adapter-sdk';
import { cotToTelemetry } from './cot.js';

export interface TakAdapterConfig {
  /** ssl://host:8089 (TAK Server streaming) — wired in Phase 6. */
  url?: string;
  certPath?: string;
  keyPath?: string;
}

/**
 * TAK interoperability adapter. Inbound CoT → normalized telemetry; outbound is
 * handled by the service calling assetToCoT() and writing to the TAK connection.
 * The live TLS transport is a Phase-6 task; this scaffold documents the seam and
 * provides a ready `ingest()` for CoT strings from any source.
 */
export class TakAdapter extends BaseAdapter {
  readonly name = 'TAK Interop Adapter';
  readonly kind = 'tak';
  private ctxRef: AdapterContext | null = null;

  constructor(private cfg: TakAdapterConfig = {}) { super(); }

  protected onStart(ctx: AdapterContext): void {
    this.ctxRef = ctx;
    ctx.log(this.cfg.url
      ? `TAK adapter ready (target ${this.cfg.url}) — connect node-tak for live TLS streaming.`
      : 'TAK adapter ready in ingest-only mode. Feed CoT via ingest(xml).');
  }

  /** Push a raw CoT <event> string into the platform as normalized telemetry. */
  ingest(cotXml: string): void {
    const t = cotToTelemetry(cotXml);
    if (t && this.ctxRef) {
      this.ctxRef.onAssetUp({ id: t.assetId, name: String(t.raw?.callsign ?? t.assetId), type: 'marker' });
      this.ctxRef.onTelemetry(t);
    }
  }
}
