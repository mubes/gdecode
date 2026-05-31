// ---------------------------------------------------------------------------
// gdecode — height-map carve worker.
//
// Runs the CPU carve off the main thread and returns the resulting height
// field. The `heights` Float32Array is handed back with comlink `transfer()`
// so its backing ArrayBuffer moves without a copy.
//
// The carve runs in CHUNKS of moves, AWAITING the (comlink-proxied) progress
// callback between chunks. Awaiting suspends the worker, which flushes the
// progress message to the main thread and lets it repaint — otherwise a single
// synchronous carve would queue every progress message and only deliver them in
// a burst at the end, leaving the progress bar stuck at 0%.
// ---------------------------------------------------------------------------

import { expose, transfer } from '../workers/comlink.ts';
import { setupCarve, lastCarveIndex } from './carve.ts';
import type { HeightFieldPayload, Move, StockDef, ToolDef } from '../types.ts';

/** Roughly how many progress updates to emit across a carve. */
const PROGRESS_STEPS = 40;

const api = {
  async carve(
    moves: Move[],
    stock: StockDef,
    tool: ToolDef,
    gridRes: number,
    opIndex: number,
    onProgress?: (fraction: number) => void,
  ): Promise<HeightFieldPayload> {
    const session = setupCarve(stock, tool, gridRes);
    const lastIdx = lastCarveIndex(moves, opIndex);
    const total = lastIdx + 1;
    const chunk = Math.max(1, Math.ceil(total / PROGRESS_STEPS));

    for (let i = 0; i <= lastIdx; i++) {
      session.carveMove(moves[i]);
      if (i % chunk === 0 || i === lastIdx) {
        // Await the proxy: round-trips the message so the bar updates + repaints.
        if (onProgress) await onProgress(total > 0 ? (i + 1) / total : 1);
      }
    }
    if (onProgress) await onProgress(1);

    const result = session.finalize();
    // Transfer the heights buffer back to the caller without copying.
    return transfer(result, [result.heights.buffer]);
  },
};

export type HeightmapWorkerApi = typeof api;

expose(api);
