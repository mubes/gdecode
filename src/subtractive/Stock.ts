// ---------------------------------------------------------------------------
// gdecode — default stock derivation.
//
// The stock is the raw block of material the tool carves into. By default we
// size it to the toolpath's XY bounding box plus a margin on all sides, and in
// Z we span from the highest point the toolpath reaches (the stock TOP) down to
// the lowest point it cuts (the stock BOTTOM). A degenerate Z range (e.g. a
// flat 2.5D job at a single depth) falls back to a sensible default thickness.
//
// Pure: depends only on a `Box3` (and an optional margin) → `StockDef`.
// ---------------------------------------------------------------------------

import type { Box3, StockDef } from '../types.ts';

/** Fallback stock thickness (mm) when the toolpath has no usable Z range. */
const DEFAULT_THICKNESS = 10;
/** Default XY margin (mm) added around the toolpath bbox. */
const DEFAULT_MARGIN = 2;

/** Minimum per-axis stock extent. The default block is 100 × 100 × 10 mm: a
 *  small part loads inside this block, a larger part grows the block to fit. */
export interface StockMin {
  x: number;
  y: number;
  z: number;
}
export const DEFAULT_MIN: StockMin = { x: 100, y: 100, z: 10 };

/**
 * Compute a default stock block from the toolpath bounding box.
 *
 * - XY: bbox expanded by `margin` on every side, then grown (symmetrically) to
 *       at least `min.x` / `min.y`.
 * - Z : top = bbox.max.z (material surface), bottom = bbox.min.z (deepest cut).
 *       A ~zero span falls back to `DEFAULT_THICKNESS`; the block is then grown
 *       DOWNWARD to at least `min.z` so the top stays at the material surface.
 *
 * With the default `min` of {0,0,0} this is a tight fit to the toolpath; the app
 * passes `DEFAULT_MIN` so the block never starts smaller than 100 × 100 × 10.
 *
 * `origin` is the min corner (x, y, stockBottomZ) — matching `HeightFieldPayload`.
 */
export function computeDefaultStock(
  bbox: Box3,
  margin = DEFAULT_MARGIN,
  min: StockMin = { x: 0, y: 0, z: 0 },
): StockDef {
  const [minX, minY, minZ] = bbox.min;
  const [maxX, maxY, maxZ] = bbox.max;

  const m = Math.max(0, margin);

  let sizeX = Math.max(maxX - minX, 0) + 2 * m;
  let sizeY = Math.max(maxY - minY, 0) + 2 * m;
  let originX = minX - m;
  let originY = minY - m;

  // Grow XY symmetrically to the minimum so the part stays centred in the block.
  if (sizeX < min.x) {
    originX -= (min.x - sizeX) / 2;
    sizeX = min.x;
  }
  if (sizeY < min.y) {
    originY -= (min.y - sizeY) / 2;
    sizeY = min.y;
  }

  const topZ = maxZ;
  let bottomZ = minZ;
  // Degenerate / inverted Z range → give the block a real thickness below top.
  if (!(topZ - bottomZ > 1e-6)) {
    bottomZ = topZ - DEFAULT_THICKNESS;
  }
  // Grow downward to the minimum thickness (keep the top at the surface).
  if (topZ - bottomZ < min.z) {
    bottomZ = topZ - min.z;
  }
  const sizeZ = topZ - bottomZ;

  return {
    origin: [originX, originY, bottomZ],
    sizeX,
    sizeY,
    sizeZ,
  };
}
