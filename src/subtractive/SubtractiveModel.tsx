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
import * as THREE from 'three';
import { useStore, activeDoc } from '../store.ts';
import { computeDefaultStock } from './Stock.ts';
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

// --- component ---------------------------------------------------------------

export function SubtractiveModel() {
  const doc = useStore(activeDoc);
  const storeStock = useStore((s) => s.stock);
  const gridRes = useStore((s) => s.gridRes);
  const tool = useStore((s) => s.tool);
  const opIndex = useStore((s) => s.opIndex);
  const effectiveMode = useStore((s) => s.effectiveMode);
  const setStock = useStore((s) => s.setStock);
  const setProgress = useStore((s) => s.setProgress);
  const setStatus = useStore((s) => s.setStatus);

  const mode = effectiveMode();
  const active = !!doc && mode === 'subtractive';

  // Resolve stock: derive a default from the toolpath bbox if none is set.
  // This writes to the store as a side effect (in an effect, not during render).
  const stock: StockDef | null = useMemo(() => {
    if (!active || !doc) return null;
    return storeStock ?? computeDefaultStock(doc.bbox);
  }, [active, doc, storeStock]);

  useEffect(() => {
    if (active && doc && !storeStock && stock) {
      setStock(stock);
    }
  }, [active, doc, storeStock, stock, setStock]);

  const [geometry, setGeometry] = useState<THREE.BufferGeometry | null>(null);
  const geomRef = useRef<THREE.BufferGeometry | null>(null);

  // Carve whenever inputs change.
  useEffect(() => {
    if (!active || !doc || !stock) {
      // Clear any existing geometry when leaving subtractive mode.
      if (geomRef.current) {
        geomRef.current.dispose();
        geomRef.current = null;
        setGeometry(null);
      }
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

  if (!active || !geometry) return null;

  return (
    <mesh geometry={geometry} castShadow receiveShadow>
      <meshStandardMaterial
        color="#b8b8c0"
        metalness={0.35}
        roughness={0.55}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}
