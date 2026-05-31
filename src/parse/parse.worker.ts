// ---------------------------------------------------------------------------
// Parse worker. Runs the pure parseGcode core off the main thread and exposes
// it over Comlink. The returned GcodeDoc is structured-cloned back to the main
// thread (its arrays are plain objects, not transferables, so no transfer list
// is needed here).
// ---------------------------------------------------------------------------

import { expose } from '../workers/comlink';
import { parseGcode } from './parseGcode';
import type { GcodeDoc } from '../types';

const api = {
  parse(text: string): GcodeDoc {
    return parseGcode(text);
  },
};

export type ParseWorkerApi = typeof api;

expose(api);
