// ---------------------------------------------------------------------------
// Shared pointer/orbit-control helpers used by the drag-and-pick interactions
// (model repositioning, stock-face handles, the measure tool). Keeps the NDC
// math and the orbit-pause toggle in one place rather than re-deriving them in
// every component.
// ---------------------------------------------------------------------------

import type { Vector2 } from 'three';

/** Pause/resume orbit controls (or anything exposing `.enabled`) during a drag.
 *  `controls` is loosely typed because R3F surfaces it as `unknown`. */
export function setOrbitEnabled(controls: unknown, enabled: boolean): void {
  if (controls) (controls as { enabled?: boolean }).enabled = enabled;
}

/** Write the pointer's normalized device coords (−1..1, y-up) for `dom` into
 *  `out`, and return it. */
export function pointerNDC(
  clientX: number,
  clientY: number,
  dom: HTMLElement,
  out: Vector2,
): Vector2 {
  const r = dom.getBoundingClientRect();
  out.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
  return out;
}
