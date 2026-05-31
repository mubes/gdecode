// ---------------------------------------------------------------------------
// gdecode — height-map carve worker.
//
// Runs the (pure) CPU carve off the main thread and returns the resulting
// height field. The `heights` Float32Array is handed back with comlink
// `transfer()` so its backing ArrayBuffer moves without a copy. The optional
// progress callback arrives as a comlink `proxy()` from the main thread.
// ---------------------------------------------------------------------------

import { expose, transfer } from '../workers/comlink.ts';
import { carveHeightField } from './carve.ts';
import type { HeightFieldPayload, Move, StockDef, ToolDef } from '../types.ts';

const api = {
  carve(
    moves: Move[],
    stock: StockDef,
    tool: ToolDef,
    gridRes: number,
    opIndex: number,
    onProgress?: (fraction: number) => void,
  ): HeightFieldPayload {
    const result = carveHeightField(
      moves,
      stock,
      tool,
      gridRes,
      opIndex,
      onProgress ? (f) => onProgress(f) : undefined,
    );
    // Transfer the heights buffer back to the caller without copying.
    return transfer(result, [result.heights.buffer]);
  },
};

export type HeightmapWorkerApi = typeof api;

expose(api);
