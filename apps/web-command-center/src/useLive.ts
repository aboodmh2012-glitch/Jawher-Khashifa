import { useSyncExternalStore } from 'react';
import { live } from './live-store.js';

/** Re-render on any (throttled) live-store change. Read live.* directly after. */
export function useLive(): number {
  return useSyncExternalStore(live.subscribe, live.getVersion, live.getVersion);
}
