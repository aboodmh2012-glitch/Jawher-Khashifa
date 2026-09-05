// @fusion/adapter-video — video/sensor stream descriptors (§9).
//
// The platform treats video sources abstractly: a stream is a protocol + URL +
// the asset it belongs to. The browser player picks a transport it supports
// (WebRTC preferred for low latency, HLS for compatibility, RTSP proxied). No
// media bytes flow through the core — only descriptors and availability events.

import { BaseAdapter, type AdapterContext } from '@fusion/adapter-sdk';

export type VideoProtocol = 'rtsp' | 'webrtc' | 'hls';

export interface VideoStreamDescriptor {
  id: string;
  assetId: string;
  label: string;
  protocol: VideoProtocol;
  url: string;
  active: boolean;
  recording?: boolean;
}

export interface VideoAdapterConfig {
  streams?: VideoStreamDescriptor[];
}

export class VideoAdapter extends BaseAdapter {
  readonly name = 'Video Adapter';
  readonly kind = 'video';
  private streams: VideoStreamDescriptor[] = [];

  constructor(private cfg: VideoAdapterConfig = {}) { super(); }

  protected onStart(ctx: AdapterContext): void {
    this.streams = this.cfg.streams ?? [];
    for (const s of this.streams) {
      ctx.onEvent('media.available', `Stream ${s.label} (${s.protocol}) available for ${s.assetId}`, s.assetId);
    }
    ctx.log(`Video adapter registered ${this.streams.length} stream descriptor(s).`);
  }

  list(): VideoStreamDescriptor[] { return this.streams; }
}
