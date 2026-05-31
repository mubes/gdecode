// ---------------------------------------------------------------------------
// gdecode — subtractive carve core (PURE; no worker, no DOM, no three).
//
// 3-axis single-Z height-map ("dexel") material-removal sim.
//
// We maintain a regular grid H(x,y) over the stock XY footprint, initialised to
// the stock top Z. For every spindle-on cutting move (linear cut or arc) we
// sweep the tool profile along the segment and lower H to the tool's cutting
// surface wherever the tool passes:  H = min(H, surfaceZ).  Rapids and
// spindle-off moves remove nothing. The result is a height field describing the
// top surface of the machined part — correct for true 3-axis work (no
// undercuts, by construction).
//
// Performance notes:
//   * One Float32Array for H; no per-cell allocation in the hot loop.
//   * Arcs are tessellated into short line segments up front.
//   * Each segment is stamped by walking it in small steps and, at each step,
//     splatting the tool's circular footprint into the grid using a tight
//     bounding box + radial profile lookup. Step length and the per-segment
//     sample count are both bounded by the grid cell size so coverage is gap-
//     free without over-sampling.
//   * Only integer cell math + a sqrt per touched cell in the hot path.
//
// Coordinate convention: H is row-major, H[y * nx + x]. World position of cell
// (ix, iy) center is origin + ( (ix+0.5)*dx, (iy+0.5)*dy ). The carve lowers
// the surface; cut depth at a cell is the tool tip Z plus the profile offset.
// ---------------------------------------------------------------------------

import type { HeightFieldPayload, Move, StockDef, ToolDef } from '../types.ts';
import { toolProfile } from './tools.ts';
import { arcSweep } from '../parse/arcs.ts';

export interface CarveProgress {
  (fraction: number): void;
}

/**
 * Sample an arc move into {x,y,z} waypoints (inclusive ends), roughly one per
 * cell of arc length. The direction/full-circle math is shared with the
 * polyline tessellator via `arcSweep`; here we only choose the sample density.
 */
function sampleArc(m: Move, cellSize: number): Array<[number, number, number]> {
  const c = m.center;
  if (!c) return [m.start, m.end];

  const { radius: r, a0, sweep } = arcSweep(m.start, m.end, c, m.type === 'arcCW');
  if (!(r > 1e-9)) return [m.start, m.end];

  const [cx, cy] = c;
  const sz = m.start[2];
  const ez = m.end[2];

  // One sample roughly per cell of arc length, min a few.
  const arcLen = Math.abs(sweep) * r;
  const n = Math.max(2, Math.ceil(arcLen / Math.max(cellSize, 1e-6)) + 1);

  const pts: Array<[number, number, number]> = new Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const a = a0 + sweep * t;
    pts[i] = [cx + r * Math.cos(a), cy + r * Math.sin(a), sz + (ez - sz) * t];
  }
  return pts;
}

/**
 * Carve a height field from the given moves.
 *
 * @param moves    normalized IR moves.
 * @param stock    stock block (origin = min corner incl. bottom Z).
 * @param tool     active tool definition.
 * @param gridRes  target grid resolution along the LONGER XY axis (cells).
 * @param opIndex  scrub: carve only moves [0..opIndex]; -1 = all moves.
 * @param onProgress optional 0..1 progress callback.
 */
export function carveHeightField(
  moves: Move[],
  stock: StockDef,
  tool: ToolDef,
  gridRes: number,
  opIndex: number,
  onProgress?: CarveProgress,
): HeightFieldPayload {
  const [ox, oy, oz] = stock.origin;
  const sizeX = stock.sizeX;
  const sizeY = stock.sizeY;
  const stockBottomZ = oz;
  const stockTopZ = oz + stock.sizeZ;

  // Grid resolution: the requested res maps to the longer axis; the shorter
  // axis gets a proportional count so cells stay ~square.
  const res = Math.max(2, Math.floor(gridRes) || 2);
  const longer = Math.max(sizeX, sizeY) || 1;
  const cellSize = longer / res;
  const nx = Math.max(2, Math.round(sizeX / cellSize) || 2);
  const ny = Math.max(2, Math.round(sizeY / cellSize) || 2);
  const dx = sizeX / nx;
  const dy = sizeY / ny;

  // H initialised to the stock top surface.
  const heights = new Float32Array(nx * ny);
  heights.fill(stockTopZ);

  const profile = toolProfile(tool);
  const R = profile.radius;

  // Determine the inclusive last move index to carve.
  const lastIdx =
    opIndex < 0 ? moves.length - 1 : Math.min(opIndex, moves.length - 1);

  // Stamp the tool's circular footprint centered at world (px,py) cutting to
  // tip Z = tipZ. Lowers H to surfaceZ = tipZ + bottomOffset(r) inside radius.
  const stamp = (px: number, py: number, tipZ: number) => {
    if (tipZ >= stockTopZ) return; // never above the surface — nothing to do
    // NB: the tip is NOT clamped to the stock bottom. A cut deeper than the
    // block drives H below stockBottomZ; the mesh builder treats those cells as
    // cut THROUGH (an open hole) rather than a zero-thickness floor.

    // Footprint bbox in cell indices.
    const minCx = Math.floor((px - R - ox) / dx);
    const maxCx = Math.ceil((px + R - ox) / dx);
    const minCy = Math.floor((py - R - oy) / dy);
    const maxCy = Math.ceil((py + R - oy) / dy);

    const lo_x = minCx < 0 ? 0 : minCx;
    const hi_x = maxCx >= nx ? nx - 1 : maxCx;
    const lo_y = minCy < 0 ? 0 : minCy;
    const hi_y = maxCy >= ny ? ny - 1 : maxCy;
    if (lo_x > hi_x || lo_y > hi_y) return;

    const R2 = R * R;
    for (let iy = lo_y; iy <= hi_y; iy++) {
      const wy = oy + (iy + 0.5) * dy;
      const ddy = wy - py;
      const ddy2 = ddy * ddy;
      const rowBase = iy * nx;
      for (let ix = lo_x; ix <= hi_x; ix++) {
        const wx = ox + (ix + 0.5) * dx;
        const ddx = wx - px;
        const r2 = ddx * ddx + ddy2;
        if (r2 > R2) continue;
        const off = profile.bottomOffset(Math.sqrt(r2));
        if (off === Infinity) continue;
        const surfaceZ = tipZ + off;
        const idx = rowBase + ix;
        if (surfaceZ < heights[idx]) heights[idx] = surfaceZ;
      }
    }
  };

  // Walk a straight segment, stamping at sub-cell intervals so the swept
  // footprint is gap-free (overlapping disks along the path).
  const sweepSegment = (
    sx: number,
    sy: number,
    sz: number,
    ex: number,
    ey: number,
    ez: number,
  ) => {
    const segLen = Math.hypot(ex - sx, ey - sy);
    // Step <= ~half a cell so disks overlap; at least the endpoints.
    const step = Math.max(Math.min(dx, dy) * 0.5, 1e-6);
    const steps = Math.max(1, Math.ceil(segLen / step));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      stamp(sx + (ex - sx) * t, sy + (ey - sy) * t, sz + (ez - sz) * t);
    }
  };

  const total = lastIdx + 1;
  // Throttle progress reporting to ~100 updates.
  const reportEvery = Math.max(1, Math.floor(total / 100));

  for (let i = 0; i <= lastIdx; i++) {
    const m = moves[i];
    // Only cutting moves with the spindle on remove material.
    const isCut = m.type === 'cut' || m.type === 'arcCW' || m.type === 'arcCCW';
    const spindleOn = m.spindle === undefined || m.spindle > 0;
    if (isCut && spindleOn) {
      if (m.type === 'cut') {
        const [sx, sy, sz] = m.start;
        const [ex, ey, ez] = m.end;
        sweepSegment(sx, sy, sz, ex, ey, ez);
      } else {
        const pts = sampleArc(m, Math.min(dx, dy));
        for (let p = 1; p < pts.length; p++) {
          const a = pts[p - 1];
          const b = pts[p];
          sweepSegment(a[0], a[1], a[2], b[0], b[1], b[2]);
        }
      }
    }

    if (onProgress && (i % reportEvery === 0 || i === lastIdx)) {
      onProgress(total > 0 ? (i + 1) / total : 1);
    }
  }

  if (onProgress) onProgress(1);

  return {
    heights,
    nx,
    ny,
    origin: [ox, oy, stockBottomZ],
    sizeX,
    sizeY,
    stockTopZ,
    stockBottomZ,
  };
}
