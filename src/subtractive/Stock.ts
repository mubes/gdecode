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

/**
 * Compute a default stock block from the toolpath bounding box.
 *
 * - XY: bbox expanded by `margin` on every side.
 * - Z : top = bbox.max.z (material surface), bottom = bbox.min.z (deepest cut).
 *       If that span is ~zero, the block is `DEFAULT_THICKNESS` thick measured
 *       DOWN from the top (the toolpath sits on the stock surface).
 *
 * `origin` is the min corner (x, y, stockBottomZ) — matching `HeightFieldPayload`.
 */
export function computeDefaultStock(bbox: Box3, margin = DEFAULT_MARGIN): StockDef {
  const [minX, minY, minZ] = bbox.min;
  const [maxX, maxY, maxZ] = bbox.max;

  const m = Math.max(0, margin);

  const sizeX = Math.max(maxX - minX, 0) + 2 * m;
  const sizeY = Math.max(maxY - minY, 0) + 2 * m;

  const topZ = maxZ;
  let bottomZ = minZ;
  // Degenerate / inverted Z range → give the block a real thickness below top.
  if (!(topZ - bottomZ > 1e-6)) {
    bottomZ = topZ - DEFAULT_THICKNESS;
  }
  const sizeZ = topZ - bottomZ;

  return {
    origin: [minX - m, minY - m, bottomZ],
    sizeX,
    sizeY,
    sizeZ,
  };
}
