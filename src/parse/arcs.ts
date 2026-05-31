// ---------------------------------------------------------------------------
// Arc tessellation. G2/G3 arcs in the IR keep their center; geometry builders
// call tessellateArc() to turn them into polylines. Pure, no deps — usable in
// both workers and unit tests.
// ---------------------------------------------------------------------------

import type { Vec3 } from '../types';

const TAU = Math.PI * 2;

/** The in-plane (XY) geometry of an arc: radius, start angle, and signed sweep
 *  (negative CW, positive CCW; ±2π for a full circle). */
export interface ArcSweep {
  radius: number;
  a0: number;
  sweep: number;
}

/**
 * Resolve the direction-normalized sweep of a G2/G3 arc in the XY plane. This
 * is the single place that encodes the CW-decreasing / CCW-increasing angle
 * convention and the coincident-endpoints ⇒ full-circle rule; both the polyline
 * tessellator (geometry build) and the carve sampler consume it, so the two
 * can never drift apart. Returns radius 0 for a degenerate (zero-radius) arc.
 */
export function arcSweep(start: Vec3, end: Vec3, center: Vec3, cw: boolean): ArcSweep {
  const r0x = start[0] - center[0];
  const r0y = start[1] - center[1];
  const radius = Math.hypot(r0x, r0y);
  if (radius === 0) return { radius: 0, a0: 0, sweep: 0 };

  const a0 = Math.atan2(r0y, r0x);
  const a1 = Math.atan2(end[1] - center[1], end[0] - center[0]);

  // Detect a full circle: start and end coincide (within tolerance).
  const isFullCircle = Math.abs(end[0] - start[0]) < 1e-9 && Math.abs(end[1] - start[1]) < 1e-9;

  // Sweep direction. atan2 increases CCW; G2 is CW (decreasing angle).
  let sweep = a1 - a0;
  if (cw) {
    // Clockwise: angle must decrease. Normalize sweep into (-2π, 0].
    while (sweep > 0) sweep -= TAU;
    if (isFullCircle || sweep === 0) sweep = -TAU;
  } else {
    // Counter-clockwise: angle must increase. Normalize sweep into [0, 2π).
    while (sweep < 0) sweep += TAU;
    if (isFullCircle || sweep === 0) sweep = TAU;
  }
  return { radius, a0, sweep };
}

/**
 * Tessellate a circular (optionally helical) arc in the XY plane into a
 * polyline of points from `start` to `end` about `center`.
 *
 * @param start   Arc start point (absolute, mm).
 * @param end     Arc end point (absolute, mm).
 * @param center  Arc center (absolute, mm). Z is taken from start/end (helix).
 * @param cw      true for G2 (clockwise, viewed from +Z), false for G3 (CCW).
 * @param segmentsOrTolerance
 *   - integer >= 2  → use exactly that many segments.
 *   - 0 < value < 1 → treat as chord tolerance (mm); segment count is derived
 *                     from the radius so the max chord deviation ≈ tolerance.
 *   - omitted       → default chord tolerance of 0.05 mm.
 *
 * The returned array includes both endpoints, so it has (segments + 1) points.
 * A full circle (start ≈ end) sweeps a complete 2π revolution.
 */
export function tessellateArc(
  start: Vec3,
  end: Vec3,
  center: Vec3,
  cw: boolean,
  segmentsOrTolerance?: number,
): Vec3[] {
  const [sx, sy, sz] = start;
  const [ex, ey, ez] = end;
  const [cx, cy] = center;

  const { radius, a0, sweep } = arcSweep(start, end, center, cw);

  // Degenerate radius: just return the straight segment.
  if (radius === 0) {
    return [start.slice() as Vec3, end.slice() as Vec3];
  }

  const arcLengthAngle = Math.abs(sweep);

  let segments: number;
  const t = segmentsOrTolerance;
  if (t === undefined) {
    segments = segmentsFromTolerance(radius, arcLengthAngle, 0.05);
  } else if (t >= 1) {
    segments = Math.max(2, Math.round(t));
  } else if (t > 0) {
    segments = segmentsFromTolerance(radius, arcLengthAngle, t);
  } else {
    segments = segmentsFromTolerance(radius, arcLengthAngle, 0.05);
  }

  const pts: Vec3[] = [];
  for (let i = 0; i <= segments; i++) {
    const f = i / segments;
    const ang = a0 + sweep * f;
    const x = cx + radius * Math.cos(ang);
    const y = cy + radius * Math.sin(ang);
    const z = sz + (ez - sz) * f; // linear helical interpolation of Z
    pts.push([x, y, z]);
  }

  // Pin the exact endpoints to avoid floating drift accumulating downstream.
  pts[0] = [sx, sy, sz];
  pts[pts.length - 1] = [ex, ey, ez];
  return pts;
}

/** Segment count so the chord-to-arc deviation stays under `tol` mm. */
function segmentsFromTolerance(radius: number, sweepAngle: number, tol: number): number {
  // Max deviation of a chord spanning angle θ from a circle of radius r is
  // r * (1 - cos(θ/2)). Solve for θ given tol, then divide the sweep by it.
  const clamped = Math.min(tol, radius); // tol can't exceed radius
  const maxAnglePerSeg = 2 * Math.acos(1 - clamped / radius);
  if (!isFinite(maxAnglePerSeg) || maxAnglePerSeg <= 0) {
    return Math.max(2, Math.ceil(sweepAngle / 0.2));
  }
  return Math.max(2, Math.ceil(sweepAngle / maxAnglePerSeg));
}
