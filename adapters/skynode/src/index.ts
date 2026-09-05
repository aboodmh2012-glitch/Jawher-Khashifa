export { normalizeSkynode, type SkynodeRaw } from './normalize.js';
export { SkynodeSimAdapter, type SkynodeSimConfig } from './sim.js';

import { SkynodeSimAdapter, type SkynodeSimConfig } from './sim.js';
import type { AdapterFactory } from '@fusion/adapter-sdk';

/** Factory used by the operations-service to instantiate the adapter from config. */
export const createSkynodeSimAdapter: AdapterFactory<SkynodeSimConfig> = (cfg) =>
  new SkynodeSimAdapter(cfg);
