// ---------------------------------------------------------------------------
// Side-effect module: accelerate raycasting with three-mesh-bvh.
//
// The carved subtractive workpiece is a dense mesh (up to ~1024² cells → a few
// million triangles). Brute-force raycasting it on every pointer move (for the
// measure tool's snap cursor) iterates every triangle and is unusably slow. We
// patch THREE so any geometry carrying a `boundsTree` is raycast through its BVH
// instead — O(log n) rather than O(n). `acceleratedRaycast` transparently falls
// back to the default for meshes WITHOUT a boundsTree, so this is safe globally
// (R3F pointer events, OrbitControls, the gizmo, etc. are unaffected).
//
// Import this module once for its side effects, then call
// `geometry.computeBoundsTree()` on the meshes you want accelerated.
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';

// three-mesh-bvh augments the THREE prototypes; the types aren't on the stock
// THREE declarations, hence the casts.
const bg = THREE.BufferGeometry.prototype as unknown as {
  computeBoundsTree: typeof computeBoundsTree;
  disposeBoundsTree: typeof disposeBoundsTree;
};
bg.computeBoundsTree = computeBoundsTree;
bg.disposeBoundsTree = disposeBoundsTree;
(THREE.Mesh.prototype as unknown as { raycast: typeof acceleratedRaycast }).raycast =
  acceleratedRaycast;

/** Build a BVH over a geometry (no-op-safe — call after constructing it). */
export function buildBoundsTree(geom: THREE.BufferGeometry): void {
  (geom as unknown as { computeBoundsTree: () => void }).computeBoundsTree();
}

/** Release a geometry's BVH before disposing it. */
export function disposeBoundsTreeOf(geom: THREE.BufferGeometry): void {
  (geom as unknown as { disposeBoundsTree?: () => void }).disposeBoundsTree?.();
}
