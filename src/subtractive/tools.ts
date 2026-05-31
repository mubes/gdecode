// ---------------------------------------------------------------------------
// gdecode — subtractive tool profiles.
//
// A cutting tool is described (in the IR / store) by a `ToolDef`: a kind
// (flat / ball / vbit), a cutting `diameter`, and — for V-bits — an included
// `vAngle`. The carve core needs to know, for a given radial distance `r` from
// the tool's central axis, how far ABOVE the tool tip the cutting surface sits.
//
// We call that the *bottom offset*: the height of the lowest point of the tool
// at radial distance r, measured relative to the tool tip (the lowest point of
// the whole tool, which is on the axis for ball/vbit, and the whole flat face
// for an endmill).
//
//   tipZ = the Z the tool tip reaches for a move (the cut depth).
//   surfaceZ(r) = tipZ + bottomOffset(r)
//
// During carving we set H(x,y) = min(H, surfaceZ(r)) over the swept footprint,
// where r is the in-plane distance from (x,y) to the tool axis. Points outside
// the tool radius get +Infinity (they remove nothing).
//
// Profiles (tipZ-relative, all >= 0 inside the radius):
//   flat: 0 for r <= R, else +Inf            (a cylindrical end mill)
//   ball: R - sqrt(R^2 - r^2) for r <= R     (hemispherical tip of radius R)
//   vbit: r / tan(angle/2) for r <= R        (cone; angle = full included angle)
//
// Pure + unit-testable: no DOM, no three, no store.
// ---------------------------------------------------------------------------

import type { ToolDef } from '../types.ts';

export interface ToolProfile {
  /** Cutting radius (mm). */
  radius: number;
  /**
   * Height of the tool's cutting surface above the tip at radial distance `r`.
   * Returns +Infinity for r > radius (outside the tool — removes nothing).
   * Always >= 0 inside the radius (the tip is the lowest point).
   */
  bottomOffset: (r: number) => number;
}

/** Build a pure tool profile from a `ToolDef`. */
export function toolProfile(tool: ToolDef): ToolProfile {
  const radius = Math.max(0, tool.diameter / 2);

  switch (tool.kind) {
    case 'flat':
      return {
        radius,
        bottomOffset: (r) => (r <= radius ? 0 : Infinity),
      };

    case 'ball':
      return {
        radius,
        bottomOffset: (r) => {
          if (r > radius) return Infinity;
          // R - sqrt(R^2 - r^2); clamp the radicand against fp noise at r≈R.
          const d2 = radius * radius - r * r;
          return radius - Math.sqrt(d2 > 0 ? d2 : 0);
        },
      };

    case 'vbit': {
      // Included angle (full) in degrees; default to a common 90° V-bit.
      const angleDeg = tool.vAngle && tool.vAngle > 0 ? tool.vAngle : 90;
      const halfRad = (angleDeg * Math.PI) / 180 / 2;
      // tan(half-angle); slope of the cone wall. half=90° (180° included) -> flat.
      const t = Math.tan(halfRad);
      // Guard degenerate angles. t<=0 would be a zero-width spike.
      const invTan = t > 1e-9 ? 1 / t : 0;
      return {
        radius,
        // r / tan(half) = r * (1/tan(half)). Outside radius removes nothing.
        bottomOffset: (r) => (r <= radius ? r * invTan : Infinity),
      };
    }

    default: {
      // Exhaustiveness guard; behaves like a flat endmill if a new kind appears.
      const _exhaustive: never = tool.kind;
      void _exhaustive;
      return { radius, bottomOffset: (r) => (r <= radius ? 0 : Infinity) };
    }
  }
}
