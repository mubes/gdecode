// ---------------------------------------------------------------------------
// gdecode — subtractive (CNC) model renderer.
//
// R3F component, meant to be a CHILD of the Viewer's <Canvas>. It:
//   * resolves the stock (computeDefaultStock from doc.bbox if none set; writes
//     it back to the store),
//   * spawns the height-map carve worker whenever the relevant inputs change
//     (doc / stock / tool / gridRes / opIndex), reporting progress + 'carving'
//     status through the store,
//   * turns the returned HeightFieldPayload into a SOLID-looking mesh: a top
//     surface displaced by H, four skirt walls down to the stock bottom, and a
//     bottom face — so the part reads as a real machined block when orbited,
//   * disposes old geometry + terminates stale workers on reload.
//
// Returns null when there is no doc, the mode isn't subtractive, or no carve
// result is available yet.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useRef, useState } from 'react';
import { useThree, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { useStore, activeDoc } from '../store.ts';
import { computeDefaultStock, DEFAULT_MIN } from './Stock.ts';
import { wrap, proxy } from '../workers/comlink.ts';
import type { Remote } from '../workers/comlink.ts';
import type { HeightmapWorkerApi } from './heightmap.worker.ts';
import type { HeightFieldPayload, StockDef } from '../types.ts';

// --- mesh construction -------------------------------------------------------

/** Cap the DISPLAY mesh resolution (the carve grid can be finer). A 2048² grid
 *  meshed 1:1 is ~17M triangles / ~600MB — it OOMs the GPU/JS heap. We sample
 *  the height field down to at most this many cells per axis for the mesh; the
 *  carve itself stays full resolution. */
const MAX_MESH_DIM = 1024;

/**
 * Build a solid, indexed BufferGeometry from a carved height field: a displaced
 * top surface, a matching bottom face, and skirt walls. Vertices are shared
 * (indexed) so the mesh stays light even at high grid resolutions.
 *
 * A cell whose cut went BELOW the stock bottom is "through": its top and bottom
 * quads are omitted so the workpiece is open there (a real cut-through). The
 * sloped top of bordering cells forms the walls of the opening. A pocket that
 * merely reaches the bottom keeps a (thin) floor — it is not a hole.
 */
function buildSolidGeometry(hf: HeightFieldPayload): THREE.BufferGeometry {
  const { heights, nx, ny, origin, sizeX, sizeY, stockBottomZ } = hf;
  const [ox, oy] = origin;
  const dx = sizeX / nx;
  const dy = sizeY / ny;
  const bz = stockBottomZ;
  const EPS = 1e-3;

  // Decimate the mesh grid (not the carve) to keep memory bounded.
  const stride = Math.max(1, Math.ceil(Math.max(nx, ny) / MAX_MESH_DIM));
  const sampleAxis = (n: number): number[] => {
    const a: number[] = [];
    for (let i = 0; i < n; i += stride) a.push(i);
    if (a[a.length - 1] !== n - 1) a.push(n - 1);
    return a;
  };
  const gx = sampleAxis(nx);
  const gy = sampleAxis(ny);
  const mx = gx.length;
  const my = gy.length;

  const wx = (gi: number) => ox + (gx[gi] + 0.5) * dx;
  const wy = (gj: number) => oy + (gy[gj] + 0.5) * dy;
  const H = (gi: number, gj: number) => heights[gy[gj] * nx + gx[gi]];
  // A cut that drove the surface below the stock bottom = open material.
  const through = (gi: number, gj: number) => H(gi, gj) < bz - EPS;
  const throughQuad = (gi: number, gj: number) =>
    through(gi, gj) && through(gi + 1, gj) && through(gi, gj + 1) && through(gi + 1, gj + 1);

  // Count solid quads (top + bottom each skip the fully-through ones).
  let solidQuads = 0;
  for (let gj = 0; gj < my - 1; gj++) {
    for (let gi = 0; gi < mx - 1; gi++) {
      if (!throughQuad(gi, gj)) solidQuads++;
    }
  }

  const skirtTris = 2 * (mx - 1) * 2 + 2 * (my - 1) * 2; // 4 outer edges
  const triCount = solidQuads * 2 /* top */ + solidQuads * 2 /* bottom */ + skirtTris;

  // Vertices: a top block [0, mx*my) then a bottom block, both row-major.
  const vCount = mx * my * 2;
  const positions = new Float32Array(vCount * 3);
  let p = 0;
  for (let gj = 0; gj < my; gj++) {
    for (let gi = 0; gi < mx; gi++) {
      const h = H(gi, gj);
      positions[p++] = wx(gi);
      positions[p++] = wy(gj);
      positions[p++] = h > bz ? h : bz; // clamp display floor to the bottom
    }
  }
  for (let gj = 0; gj < my; gj++) {
    for (let gi = 0; gi < mx; gi++) {
      positions[p++] = wx(gi);
      positions[p++] = wy(gj);
      positions[p++] = bz;
    }
  }

  const index = new Uint32Array(triCount * 3);
  let q = 0;
  const topV = (gi: number, gj: number) => gj * mx + gi;
  const botV = (gi: number, gj: number) => mx * my + gj * mx + gi;
  const pushTri = (a: number, b: number, c: number) => {
    index[q++] = a;
    index[q++] = b;
    index[q++] = c;
  };

  // Top surface (normals up). a=(gi,gj) b=(gi+1,gj) c=(gi+1,gj+1) d=(gi,gj+1).
  for (let gj = 0; gj < my - 1; gj++) {
    for (let gi = 0; gi < mx - 1; gi++) {
      if (throughQuad(gi, gj)) continue;
      const a = topV(gi, gj), b = topV(gi + 1, gj), c = topV(gi + 1, gj + 1), d = topV(gi, gj + 1);
      pushTri(a, b, c);
      pushTri(a, c, d);
    }
  }
  // Bottom face (normals down → reversed winding).
  for (let gj = 0; gj < my - 1; gj++) {
    for (let gi = 0; gi < mx - 1; gi++) {
      if (throughQuad(gi, gj)) continue;
      const a = botV(gi, gj), b = botV(gi + 1, gj), c = botV(gi + 1, gj + 1), d = botV(gi, gj + 1);
      pushTri(a, c, b);
      pushTri(a, d, c);
    }
  }
  // Skirt: outward-facing walls from each top edge vertex down to the bottom.
  const wall = (aGi: number, aGj: number, bGi: number, bGj: number) => {
    const aT = topV(aGi, aGj), bT = topV(bGi, bGj), aB = botV(aGi, aGj), bB = botV(bGi, bGj);
    pushTri(aT, bT, bB);
    pushTri(aT, bB, aB);
  };
  for (let gi = 0; gi < mx - 1; gi++) wall(gi + 1, 0, gi, 0); // -Y
  for (let gi = 0; gi < mx - 1; gi++) wall(gi, my - 1, gi + 1, my - 1); // +Y
  for (let gj = 0; gj < my - 1; gj++) wall(0, gj, 0, gj + 1); // -X
  for (let gj = 0; gj < my - 1; gj++) wall(mx - 1, gj + 1, mx - 1, gj); // +X

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geom.setIndex(new THREE.BufferAttribute(index, 1));
  geom.computeVertexNormals();
  geom.computeBoundingBox();
  geom.computeBoundingSphere();
  return geom;
}

// --- stock editor (draggable bounds) ----------------------------------------

/** The six faces of the stock box, each draggable along one axis. */
const FACES: { axis: 0 | 1 | 2; side: 'min' | 'max'; color: string }[] = [
  { axis: 0, side: 'min', color: '#ff6b6b' },
  { axis: 0, side: 'max', color: '#ff6b6b' },
  { axis: 1, side: 'min', color: '#39d98a' },
  { axis: 1, side: 'max', color: '#39d98a' },
  { axis: 2, side: 'min', color: '#4fa3ff' },
  { axis: 2, side: 'max', color: '#4fa3ff' },
];

const AXIS_DIR = [
  new THREE.Vector3(1, 0, 0),
  new THREE.Vector3(0, 1, 0),
  new THREE.Vector3(0, 0, 1),
];

// Arrow handles are built along local +Y and rotated so +Y points OUTWARD from
// the face they sit on (the expansion direction). Dragging inward to shrink is
// left to the user — only the outward (expansion) arrow is drawn.
const Y_AXIS = new THREE.Vector3(0, 1, 0);

/** Minimum stock extent (mm) along any axis — handles can't cross past this. */
const MIN_EXTENT = 0.5;

/** World min/max corners of a stock box. */
function stockBounds(s: StockDef): { min: THREE.Vector3; max: THREE.Vector3 } {
  return {
    min: new THREE.Vector3(s.origin[0], s.origin[1], s.origin[2]),
    max: new THREE.Vector3(s.origin[0] + s.sizeX, s.origin[1] + s.sizeY, s.origin[2] + s.sizeZ),
  };
}

/** Apply a dragged face coordinate to the stock, keeping a minimum extent. */
function resizeStock(s: StockDef, axis: 0 | 1 | 2, side: 'min' | 'max', coord: number): StockDef {
  const origin: [number, number, number] = [...s.origin];
  const size = [s.sizeX, s.sizeY, s.sizeZ];
  const lo = origin[axis];
  const hi = origin[axis] + size[axis];
  if (side === 'min') {
    const newLo = Math.min(coord, hi - MIN_EXTENT);
    origin[axis] = newLo;
    size[axis] = hi - newLo;
  } else {
    const newHi = Math.max(coord, lo + MIN_EXTENT);
    size[axis] = newHi - lo;
  }
  return { origin, sizeX: size[0], sizeY: size[1], sizeZ: size[2] };
}

/** Shift-drag moves a face at this fraction of the pointer delta (fine adjust). */
const SHIFT_SCALE = 0.15;

/**
 * Renders the stock as a wireframe box with a draggable handle on each of its
 * six faces. Dragging a handle slides that face along its axis; the box, arrows
 * and info readout update live, but the (expensive) carve is deferred until the
 * drag ends (store.stockDragging). Orbit controls pause while dragging, and
 * holding Shift moves the face in much finer increments.
 */
function StockEditor({ stock, color }: { stock: StockDef; color: string }) {
  const { camera, gl, raycaster, controls } = useThree();
  const editStock = useStore((s) => s.editStock);
  const setStockDragging = useStore((s) => s.setStockDragging);

  // The face is moved by accumulating per-frame pointer deltas (each optionally
  // Shift-scaled). Incremental — so there is no jump when grabbing the arrow
  // head, and toggling Shift mid-drag only changes the rate going forward.
  const drag = useRef<{
    axis: 0 | 1 | 2;
    side: 'min' | 'max';
    lastRaw: number; // previous pointer axis coord
    faceCoord: number; // current accumulated face coord
  } | null>(null);

  const { min, max } = useMemo(() => stockBounds(stock), [stock]);
  const center = useMemo(
    () => new THREE.Vector3().addVectors(min, max).multiplyScalar(0.5),
    [min, max],
  );
  const size = useMemo(() => new THREE.Vector3().subVectors(max, min), [min, max]);

  // The box3 helper draws the wireframe outline.
  const box3 = useMemo(() => new THREE.Box3(min.clone(), max.clone()), [min, max]);

  // Arrow length scales with the stock so handles stay grabbable but unobtrusive.
  const arrowSize = useMemo(() => {
    const maxDim = Math.max(size.x, size.y, size.z, 1);
    return Math.min(Math.max(maxDim * 0.15, 4), 30);
  }, [size]);

  // World-space center of a given face (drag handle position).
  const faceCenter = (axis: 0 | 1 | 2, side: 'min' | 'max'): THREE.Vector3 => {
    const p = center.clone();
    p.setComponent(axis, side === 'min' ? min.getComponent(axis) : max.getComponent(axis));
    return p;
  };

  // Window-level drag: project the pointer onto a plane containing the drag
  // axis and facing the camera, then read the axis coordinate.
  useEffect(() => {
    const dom = gl.domElement;
    const ndc = new THREE.Vector2();
    const hit = new THREE.Vector3();
    const plane = new THREE.Plane();
    const n = new THREE.Vector3();

    const onMove = (e: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      const s = useStore.getState().stock;
      if (!s) return;

      const r = dom.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);

      // Plane normal = view direction projected perpendicular to the drag axis,
      // so the plane contains the axis and most faces the camera.
      const a = AXIS_DIR[d.axis];
      const v = raycaster.ray.direction;
      n.copy(v).addScaledVector(a, -a.dot(v));
      if (n.lengthSq() < 1e-6) return;
      n.normalize();

      // A point on the current face (cross-axis components are stable).
      const b = stockBounds(s);
      const onAxis = (b.min.getComponent(d.axis) + b.max.getComponent(d.axis)) * 0.5;
      const pt = new THREE.Vector3().addVectors(b.min, b.max).multiplyScalar(0.5);
      pt.setComponent(d.axis, onAxis);
      plane.setFromNormalAndCoplanarPoint(n, pt);

      if (!raycaster.ray.intersectPlane(plane, hit)) return;
      const raw = hit.getComponent(d.axis);
      const factor = e.shiftKey ? SHIFT_SCALE : 1;
      d.faceCoord += (raw - d.lastRaw) * factor; // accumulate scaled increment
      d.lastRaw = raw;
      editStock(resizeStock(s, d.axis, d.side, d.faceCoord));
    };

    const endDrag = () => {
      if (!drag.current) return;
      drag.current = null;
      if (controls) (controls as { enabled?: boolean }).enabled = true;
      setStockDragging(false); // drag finished → allow the carve to run once
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', endDrag);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', endDrag);
      endDrag(); // safety: never leave stockDragging stuck on unmount mid-drag
    };
  }, [camera, gl, raycaster, controls, editStock, setStockDragging]);

  const onGrab = (axis: 0 | 1 | 2, side: 'min' | 'max') => (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    const b = stockBounds(useStore.getState().stock ?? stock);
    drag.current = {
      axis,
      side,
      lastRaw: e.point.getComponent(axis),
      faceCoord: side === 'min' ? b.min.getComponent(axis) : b.max.getComponent(axis),
    };
    setStockDragging(true);
    if (controls) (controls as { enabled?: boolean }).enabled = false;
  };

  return (
    <group>
      <box3Helper args={[box3, new THREE.Color(color)]} />
      {FACES.map(({ axis, side, color: hc }) => (
        <FaceArrow
          key={`${axis}-${side}`}
          position={faceCenter(axis, side)}
          dir={AXIS_DIR[axis].clone().multiplyScalar(side === 'max' ? 1 : -1)}
          size={arrowSize}
          color={hc}
          onPointerDown={onGrab(axis, side)}
        />
      ))}
    </group>
  );
}

/**
 * A single arrow handle whose tail sits at the face centre and points OUTWARD
 * (the expansion direction). Built along local +Y (shaft + cone), then rotated
 * so +Y maps onto `dir`. Dragging it either way resizes the face; only the
 * outward (expansion) arrow is shown — the inward one is left to inference.
 */
function FaceArrow({
  position,
  dir,
  size,
  color,
  onPointerDown,
}: {
  position: THREE.Vector3;
  dir: THREE.Vector3;
  size: number;
  color: string;
  onPointerDown: (e: ThreeEvent<PointerEvent>) => void;
}) {
  const quat = new THREE.Quaternion().setFromUnitVectors(Y_AXIS, dir);
  const coneH = size * 0.4;
  const coneR = size * 0.16;
  const shaftR = size * 0.05;
  // Half-length stalk (less visual reach than the cone).
  const shaftLen = Math.max(size - coneH, size * 0.3) * 0.5;

  return (
    <group position={position} quaternion={quat} onPointerDown={onPointerDown}>
      <mesh position={[0, shaftLen / 2, 0]}>
        <cylinderGeometry args={[shaftR, shaftR, shaftLen, 12]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.35} />
      </mesh>
      <mesh position={[0, shaftLen + coneH / 2, 0]}>
        <coneGeometry args={[coneR, coneH, 16]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.35} />
      </mesh>
    </group>
  );
}

// --- component ---------------------------------------------------------------

export function SubtractiveModel() {
  const doc = useStore(activeDoc);
  const storeStock = useStore((s) => s.stock);
  const gridRes = useStore((s) => s.gridRes);
  const tool = useStore((s) => s.tool);
  const opIndex = useStore((s) => s.opIndex);
  const effectiveMode = useStore((s) => s.effectiveMode);
  const stockColor = useStore((s) => s.stockColor);
  const showStockEditor = useStore((s) => s.showStockEditor);
  const stockDragging = useStore((s) => s.stockDragging);
  const setStock = useStore((s) => s.setStock);
  const setProgress = useStore((s) => s.setProgress);
  const setStatus = useStore((s) => s.setStatus);

  const mode = effectiveMode();
  const active = !!doc && mode === 'subtractive';

  // Resolve stock: default = the work file's extremities, floored to the
  // 100×100×10 default block (DEFAULT_MIN). Written back to the store via an
  // effect (not during render). A user-set stock persists (see store.addModel).
  const stock: StockDef | null = useMemo(() => {
    if (!active || !doc) return null;
    return storeStock ?? computeDefaultStock(doc.bbox, undefined, DEFAULT_MIN);
  }, [active, doc, storeStock]);

  useEffect(() => {
    if (active && doc && !storeStock && stock) {
      setStock(stock);
    }
  }, [active, doc, storeStock, stock, setStock]);

  const [geometry, setGeometry] = useState<THREE.BufferGeometry | null>(null);
  const geomRef = useRef<THREE.BufferGeometry | null>(null);
  // Signature of the carve that produced the current geometry. Lets us skip a
  // redundant re-carve when re-entering subtractive mode unchanged, so the
  // workpiece is preserved (not recomputed) across mode switches.
  const carvedSig = useRef<string | null>(null);
  const carvedDoc = useRef<typeof doc>(null);

  // Carve whenever the carve INPUTS change. Leaving subtractive mode does NOT
  // dispose the geometry — it is kept so switching back shows it instantly.
  useEffect(() => {
    // Keep any existing workpiece; also defer the carve while a face is being
    // dragged (it runs once on release, not every frame).
    if (!active || !doc || !stock || stockDragging) return;

    // Already carved with these exact inputs? Reuse the cached geometry.
    const sig = JSON.stringify({ stock, tool, gridRes, opIndex });
    if (carvedDoc.current === doc && carvedSig.current === sig && geomRef.current) {
      return;
    }

    let cancelled = false;
    const worker = new Worker(new URL('./heightmap.worker.ts', import.meta.url), {
      type: 'module',
    });
    const api = wrap<HeightmapWorkerApi>(worker) as Remote<HeightmapWorkerApi>;

    setStatus('carving');
    setProgress(0);

    const onProgress = proxy((f: number) => {
      if (!cancelled) setProgress(f);
    });

    api
      .carve(doc.moves, stock, tool, gridRes, opIndex, onProgress)
      .then((hf: HeightFieldPayload) => {
        if (cancelled) return;
        const geom = buildSolidGeometry(hf);
        // Dispose the previous geometry before swapping in the new one.
        if (geomRef.current) geomRef.current.dispose();
        geomRef.current = geom;
        carvedDoc.current = doc;
        carvedSig.current = sig;
        setGeometry(geom);
        setProgress(1);
        setStatus('ready');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        // eslint-disable-next-line no-console
        console.error('[gdecode] carve failed:', err);
        setStatus('ready');
      });

    return () => {
      cancelled = true;
      worker.terminate();
    };
  }, [active, doc, stock, tool, gridRes, opIndex, stockDragging, setProgress, setStatus]);

  // Dispose geometry on unmount.
  useEffect(() => {
    return () => {
      if (geomRef.current) {
        geomRef.current.dispose();
        geomRef.current = null;
      }
    };
  }, []);

  // Hidden (but geometry retained) when not in subtractive mode.
  if (!active) return null;

  return (
    <>
      {geometry && (
        <mesh geometry={geometry} castShadow receiveShadow>
          <meshStandardMaterial
            color={stockColor}
            metalness={0.35}
            roughness={0.55}
            side={THREE.DoubleSide}
          />
        </mesh>
      )}
      {stock && showStockEditor && <StockEditor stock={stock} color={stockColor} />}
    </>
  );
}
