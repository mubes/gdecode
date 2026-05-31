// ---------------------------------------------------------------------------
// gdecode — GPU carve (FUTURE / STUB).
//
// PLAN Phase 3 calls for eventually moving the carve hot path to a GPU
// min-blend pass: render each tool sweep (an oriented capsule / disk footprint)
// into a float framebuffer with a MIN blend equation, keeping the lowest cutting
// surface per texel. The resulting float texture IS the height field and can be
// sampled directly by the display mesh's vertex shader — no readback needed for
// rendering, only for measurement/export.
//
// Sketch of the intended implementation (NOT done here):
//   1. Allocate an FBO with an R32F (or RG32F) color attachment, nx × ny.
//   2. Clear to stockTopZ.
//   3. Set blendEquation = MIN, blendFunc = (ONE, ONE) [WebGL2: gl.MIN].
//   4. For each cut/arc segment, draw a screen-space quad covering the swept
//      footprint; the fragment shader computes radial distance to the segment,
//      discards outside the tool radius, and outputs surfaceZ = tipZ +
//      bottomOffset(r) using the tool profile encoded as uniforms.
//   5. Optionally read back into a Float32Array for the HeightFieldPayload.
//
// Until that exists, the CPU path in `carve.ts` (run in `heightmap.worker.ts`)
// is AUTHORITATIVE: it is deterministic and correct, and is what the renderer
// consumes. This module only documents the seam.
// ---------------------------------------------------------------------------

import type { HeightFieldPayload, Move, StockDef, ToolDef } from '../types.ts';

export interface GpuCarveOptions {
  moves: Move[];
  stock: StockDef;
  tool: ToolDef;
  gridRes: number;
  opIndex: number;
}

/**
 * Future GPU min-blend carve. NOT YET IMPLEMENTED — the CPU path
 * (`carveHeightField` in carve.ts) is the authoritative implementation.
 *
 * @throws always, until implemented.
 */
export function carveHeightFieldGpu(
  _gl: WebGL2RenderingContext,
  _opts: GpuCarveOptions,
): HeightFieldPayload {
  throw new Error(
    'carveHeightFieldGpu: not yet implemented — use the CPU carve ' +
      '(carve.ts / heightmap.worker.ts), which is authoritative.',
  );
}

/** Whether a GPU carve path is available. Always false for now. */
export const GPU_CARVE_AVAILABLE = false as const;
