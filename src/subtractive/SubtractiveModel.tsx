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

/**
 * Build a solid BufferGeometry from a carved height field: a displaced top
 * surface (nx × ny grid of vertices) plus skirt walls and a bottom face.
 */
function buildSolidGeometry(hf: HeightFieldPayload): THREE.BufferGeometry {
  const { heights, nx, ny, origin, sizeX, sizeY, stockBottomZ } = hf;
  const [ox, oy] = origin;
  const dx = sizeX / nx;
  const dy = sizeY / ny;

  // Vertex world position for the CENTER of cell (ix,iy) on the top surface.
  // (Matches carve.ts cell-center sampling.)

  // --- TOP SURFACE: (nx-1)*(ny-1) quads -> 2 tris each ---
  const topQuadsX = nx - 1;
  const topQuadsY = ny - 1;
  const topTris = topQuadsX * topQuadsY * 2;

  // --- SKIRT: 4 edges. Each edge has (n-1) quads -> 2 tris. ---
  const skirtTris = 2 * (topQuadsX * 2) + 2 * (topQuadsY * 2);

  // --- BOTTOM: 2 tris. ---
  const bottomTris = 2;

  const totalTris = topTris + skirtTris + bottomTris;
  const positions = new Float32Array(totalTris * 3 * 3);

  let p = 0;
  const px = (ix: number) => ox + (ix + 0.5) * dx;
  const py = (iy: number) => oy + (iy + 0.5) * dy;
  const topZ = (ix: number, iy: number) => heights[iy * nx + ix];

  const pushV = (x: number, y: number, z: number) => {
    positions[p++] = x;
    positions[p++] = y;
    positions[p++] = z;
  };
  const tri = (
    ax: number, ay: number, az: number,
    bx: number, by: number, bz: number,
    cx: number, cy: number, cz: number,
  ) => {
    pushV(ax, ay, az);
    pushV(bx, by, bz);
    pushV(cx, cy, cz);
  };

  // Top surface (CCW seen from +Z so normals point up after computeVertexNormals).
  for (let iy = 0; iy < topQuadsY; iy++) {
    for (let ix = 0; ix < topQuadsX; ix++) {
      const x0 = px(ix), x1 = px(ix + 1);
      const y0 = py(iy), y1 = py(iy + 1);
      const z00 = topZ(ix, iy);
      const z10 = topZ(ix + 1, iy);
      const z01 = topZ(ix, iy + 1);
      const z11 = topZ(ix + 1, iy + 1);
      tri(x0, y0, z00, x1, y0, z10, x1, y1, z11);
      tri(x0, y0, z00, x1, y1, z11, x0, y1, z01);
    }
  }

  const bz = stockBottomZ;

  // Skirt edge helper: given two adjacent top vertices, drop a wall to bottom.
  const wall = (
    ax: number, ay: number, az: number,
    bx: number, by: number, bz2: number,
  ) => {
    // outward-facing quad (a_top, b_top, b_bot, a_bot)
    tri(ax, ay, az, bx, by, bz2, bx, by, bz);
    tri(ax, ay, az, bx, by, bz, ax, ay, bz);
  };

  // -Y edge (iy=0)
  for (let ix = 0; ix < topQuadsX; ix++) {
    wall(px(ix + 1), py(0), topZ(ix + 1, 0), px(ix), py(0), topZ(ix, 0));
  }
  // +Y edge (iy=ny-1)
  for (let ix = 0; ix < topQuadsX; ix++) {
    wall(px(ix), py(ny - 1), topZ(ix, ny - 1), px(ix + 1), py(ny - 1), topZ(ix + 1, ny - 1));
  }
  // -X edge (ix=0)
  for (let iy = 0; iy < topQuadsY; iy++) {
    wall(px(0), py(iy), topZ(0, iy), px(0), py(iy + 1), topZ(0, iy + 1));
  }
  // +X edge (ix=nx-1)
  for (let iy = 0; iy < topQuadsY; iy++) {
    wall(px(nx - 1), py(iy + 1), topZ(nx - 1, iy + 1), px(nx - 1), py(iy), topZ(nx - 1, iy));
  }

  // Bottom face (CCW seen from -Z -> normals point down).
  {
    const x0 = px(0), x1 = px(nx - 1);
    const y0 = py(0), y1 = py(ny - 1);
    tri(x0, y0, bz, x1, y1, bz, x1, y0, bz);
    tri(x0, y0, bz, x0, y1, bz, x1, y1, bz);
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
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

// Orientation for the arrow handles: built along local +Y, rotated so +Y maps
// onto each drag axis. (Y→Y is identity.)
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const AXIS_QUAT = AXIS_DIR.map((d) => new THREE.Quaternion().setFromUnitVectors(Y_AXIS, d));

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

/**
 * Renders the stock as a wireframe box with a draggable handle on each of its
 * six faces. Dragging a handle slides that face along its axis (updating the
 * store's stock live); orbit controls pause while dragging. On release the
 * leva stock sliders are nudged to re-seed (bumpStockEdit) so panel + viewport
 * stay consistent.
 */
function StockEditor({ stock, color }: { stock: StockDef; color: string }) {
  const { camera, gl, raycaster, controls } = useThree();
  const editStock = useStore((s) => s.editStock);
  const bumpStockEdit = useStore((s) => s.bumpStockEdit);

  const drag = useRef<{ axis: 0 | 1 | 2; side: 'min' | 'max' } | null>(null);

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
      editStock(resizeStock(s, d.axis, d.side, hit.getComponent(d.axis)));
    };

    const onUp = () => {
      if (!drag.current) return;
      drag.current = null;
      if (controls) (controls as { enabled?: boolean }).enabled = true;
      bumpStockEdit(); // re-seed the leva sliders once, after the drag
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [camera, gl, raycaster, controls, editStock, bumpStockEdit]);

  const onGrab = (axis: 0 | 1 | 2, side: 'min' | 'max') => (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    drag.current = { axis, side };
    if (controls) (controls as { enabled?: boolean }).enabled = false;
  };

  return (
    <group>
      <box3Helper args={[box3, new THREE.Color(color)]} />
      {FACES.map(({ axis, side, color: hc }) => (
        <FaceArrow
          key={`${axis}-${side}`}
          position={faceCenter(axis, side)}
          axis={axis}
          size={arrowSize}
          color={hc}
          onPointerDown={onGrab(axis, side)}
        />
      ))}
    </group>
  );
}

/**
 * A double-ended arrow handle, centred on a stock face and pointing along that
 * face's drag axis (so it reads as "slide this face in or out"). Built along
 * local +Y from a thin shaft and two end cones, then rotated onto the axis. The
 * tips sit exactly at ±size/2 from the face centre, aligned with the axis.
 */
function FaceArrow({
  position,
  axis,
  size,
  color,
  onPointerDown,
}: {
  position: THREE.Vector3;
  axis: 0 | 1 | 2;
  size: number;
  color: string;
  onPointerDown: (e: ThreeEvent<PointerEvent>) => void;
}) {
  const coneH = size * 0.3;
  const coneR = size * 0.13;
  const shaftR = size * 0.04;
  const shaftLen = Math.max(size - 2 * coneH, size * 0.1);
  const tip = shaftLen / 2 + coneH / 2; // centre offset of each cone

  return (
    <group position={position} quaternion={AXIS_QUAT[axis]} onPointerDown={onPointerDown}>
      <mesh>
        <cylinderGeometry args={[shaftR, shaftR, shaftLen, 12]} />
        <meshStandardMaterial color={color} depthTest={false} />
      </mesh>
      <mesh position={[0, tip, 0]}>
        <coneGeometry args={[coneR, coneH, 16]} />
        <meshStandardMaterial color={color} depthTest={false} />
      </mesh>
      <mesh position={[0, -tip, 0]} rotation={[Math.PI, 0, 0]}>
        <coneGeometry args={[coneR, coneH, 16]} />
        <meshStandardMaterial color={color} depthTest={false} />
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
    if (!active || !doc || !stock) return; // keep any existing workpiece

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
  }, [active, doc, stock, tool, gridRes, opIndex, setProgress, setStatus]);

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
