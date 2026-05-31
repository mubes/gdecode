// ---------------------------------------------------------------------------
// Measure — right-click dimension tool (both views).
//
// Right-click sets the START point, right-click again sets the END (drawing a
// dimension line + length readout), and a third right-click clears it. A live
// snap indicator follows the cursor at ALL times so it's obvious what the next
// click will attach to: a highlighted dot on a feature corner, or a highlighted
// segment when snapping onto an edge. Snapping is screen-space (a pixel radius)
// so it behaves the same whether zoomed in or out, and every placed coordinate
// is quantised to 1/100 mm. Holding CTRL while placing the end constrains the
// line to the dominant primary axis (X/Y/Z); Esc cancels.
//
// Lives INSIDE the Canvas so it can raycast the scene and anchor an Html label.
// Uses its OWN raycaster (never perturbs R3F pointer handling) and skips the
// infinite grid (a PlaneGeometry) so the cursor lands on parts.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useThree } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import './bvh'; // side effect: BVH-accelerate raycasts (fast snap on dense meshes)

/** Snap radius in screen pixels: corners win within VERT_PX, edges within EDGE_PX. */
const VERT_PX = 14;
const EDGE_PX = 11;

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Quantise a point to 1/100 mm on every axis (new vector). */
function quantise(p: THREE.Vector3): THREE.Vector3 {
  return new THREE.Vector3(round2(p.x), round2(p.y), round2(p.z));
}

/** Constrain `end` so the segment from `start` runs along its dominant primary
 *  axis only (the other two components collapse onto `start`). */
function constrainAxis(start: THREE.Vector3, end: THREE.Vector3): THREE.Vector3 {
  const d = new THREE.Vector3().subVectors(end, start);
  const ax = Math.abs(d.x), ay = Math.abs(d.y), az = Math.abs(d.z);
  const out = start.clone();
  if (ax >= ay && ax >= az) out.x = end.x;
  else if (ay >= ax && ay >= az) out.y = end.y;
  else out.z = end.z;
  return out;
}

/** Closest point on segment [a,b] to p. */
function closestOnSeg(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3): THREE.Vector3 {
  const ab = new THREE.Vector3().subVectors(b, a);
  const len2 = ab.lengthSq() || 1e-9;
  const t = Math.max(0, Math.min(1, new THREE.Vector3().subVectors(p, a).dot(ab) / len2));
  return a.clone().addScaledVector(ab, t);
}

/** What the cursor is currently snapped to. */
interface Snap {
  /** The (quantised) world point. */
  point: THREE.Vector3;
  /** The highlighted edge, when snapping onto one. */
  edge?: [THREE.Vector3, THREE.Vector3];
}

export function Measure() {
  const { scene, camera, gl } = useThree();
  const ray = useMemo(() => new THREE.Raycaster(), []);

  const [points, setPoints] = useState<THREE.Vector3[]>([]);
  const [hover, setHover] = useState<Snap | null>(null);

  // Raycastable scene leaves, minus our own helpers and the infinite grid plane.
  const collectTargets = useCallback((): THREE.Object3D[] => {
    const out: THREE.Object3D[] = [];
    scene.traverse((o) => {
      if (o.userData?.measureHelper) return;
      const m = o as THREE.Mesh & { isMesh?: boolean; isLine?: boolean; isLineSegments?: boolean };
      if (!(m.isMesh || m.isLine || m.isLineSegments)) return;
      if (!m.visible || !m.geometry) return;
      if (m.geometry.type === 'PlaneGeometry') return; // the drei grid
      out.push(o);
    });
    return out;
  }, [scene]);

  // Raycast the pointer and resolve a snap (corner → edge → raw surface).
  const pick = useCallback(
    (clientX: number, clientY: number): Snap | null => {
      const rect = gl.domElement.getBoundingClientRect();
      const cursor = new THREE.Vector2(clientX - rect.left, clientY - rect.top);
      const ndc = new THREE.Vector2(
        (cursor.x / rect.width) * 2 - 1,
        -(cursor.y / rect.height) * 2 + 1,
      );
      ray.setFromCamera(ndc, camera);
      ray.params.Line = { threshold: 0.6 };
      const hits = ray.intersectObjects(collectTargets(), false);
      const hit = hits[0];
      if (!hit) return null;

      const base = hit.point.clone();
      const obj = hit.object as THREE.Mesh & { isInstancedMesh?: boolean };

      // Project a world point to canvas pixels.
      const toPx = (p: THREE.Vector3): THREE.Vector2 => {
        const v = p.clone().project(camera);
        return new THREE.Vector2((v.x * 0.5 + 0.5) * rect.width, (-v.y * 0.5 + 0.5) * rect.height);
      };

      // Per-instance transforms aren't in matrixWorld → no corner/edge snap on
      // instanced meshes; use the raw surface hit.
      if (!hit.face || obj.isInstancedMesh || !obj.geometry?.getAttribute('position')) {
        return { point: quantise(base) };
      }

      const pos = obj.geometry.getAttribute('position');
      const verts = [hit.face.a, hit.face.b, hit.face.c].map((i) =>
        new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(obj.matrixWorld),
      );

      // 1) Nearest corner (in screen space) wins if within VERT_PX.
      let bestV: THREE.Vector3 | null = null;
      let bestVD = VERT_PX;
      for (const v of verts) {
        const d = toPx(v).distanceTo(cursor);
        if (d < bestVD) {
          bestVD = d;
          bestV = v;
        }
      }
      if (bestV) return { point: quantise(bestV) };

      // 2) Otherwise the nearest face edge if within EDGE_PX.
      const edges: [THREE.Vector3, THREE.Vector3][] = [
        [verts[0], verts[1]],
        [verts[1], verts[2]],
        [verts[2], verts[0]],
      ];
      let bestE: { p: THREE.Vector3; e: [THREE.Vector3, THREE.Vector3] } | null = null;
      let bestED = EDGE_PX;
      for (const e of edges) {
        const cp = closestOnSeg(base, e[0], e[1]);
        const d = toPx(cp).distanceTo(cursor);
        if (d < bestED) {
          bestED = d;
          bestE = { p: cp, e };
        }
      }
      if (bestE) return { point: quantise(bestE.p), edge: bestE.e };

      // 3) Plain surface hit.
      return { point: quantise(base) };
    },
    [ray, camera, gl, collectTargets],
  );

  // Apply CTRL axis-constraint relative to the first point (detaches from the
  // snapped feature, so no edge highlight in that case).
  const resolve = useCallback(
    (snap: Snap, ctrl: boolean): Snap => {
      if (points.length === 1 && ctrl) {
        return { point: quantise(constrainAxis(points[0], snap.point)) };
      }
      return snap;
    },
    [points],
  );

  useEffect(() => {
    const dom = gl.domElement;
    // Right-button is also OrbitControls' pan; remember the press origin so a
    // click (place a point) is told apart from a drag (pan, ignore).
    let downX = 0;
    let downY = 0;
    const onDown = (e: PointerEvent) => {
      if (e.button === 2) {
        downX = e.clientX;
        downY = e.clientY;
      }
    };
    const onContext = (e: MouseEvent) => {
      e.preventDefault();
      if (Math.hypot(e.clientX - downX, e.clientY - downY) > 5) return; // a pan-drag
      if (points.length >= 2) {
        setPoints([]);
        setHover(null);
        return;
      }
      const snap = pick(e.clientX, e.clientY);
      if (!snap) return;
      const r = resolve(snap, e.ctrlKey);
      setPoints(points.length === 1 ? [points[0], r.point] : [r.point]);
    };
    // Coalesce pointer moves to one raycast per frame — the carved mesh can be
    // millions of triangles, so raycasting on every raw move event backs up and
    // feels laggy. rAF keeps the snap cursor at display rate instead.
    let raf = 0;
    let queued: { x: number; y: number; ctrl: boolean } | null = null;
    const runMove = () => {
      raf = 0;
      const q = queued;
      queued = null;
      if (!q || points.length >= 2) return;
      const snap = pick(q.x, q.y);
      setHover(snap ? resolve(snap, q.ctrl) : null);
    };
    const onMove = (e: PointerEvent) => {
      if (points.length >= 2) return; // measurement complete; no live cursor
      queued = { x: e.clientX, y: e.clientY, ctrl: e.ctrlKey };
      if (!raf) raf = requestAnimationFrame(runMove);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPoints([]);
        setHover(null);
      }
    };
    dom.addEventListener('pointerdown', onDown);
    dom.addEventListener('contextmenu', onContext);
    dom.addEventListener('pointermove', onMove);
    window.addEventListener('keydown', onKey);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      dom.removeEventListener('pointerdown', onDown);
      dom.removeEventListener('contextmenu', onContext);
      dom.removeEventListener('pointermove', onMove);
      window.removeEventListener('keydown', onKey);
    };
  }, [gl, points, pick, resolve]);

  // The measured segment: committed [start,end], or [start,hover] while placing.
  const seg: [THREE.Vector3, THREE.Vector3] | null =
    points.length === 2
      ? [points[0], points[1]]
      : points.length === 1 && hover
        ? [points[0], hover.point]
        : null;

  return (
    <group userData={{ measureHelper: true }}>
      {/* Committed endpoints. */}
      {points.map((p, i) => (
        <Dot key={i} at={p} />
      ))}

      {/* Live snap cursor (corner dot + edge highlight) until the line is done. */}
      {points.length < 2 && hover && (
        <>
          {hover.edge && <Seg a={hover.edge[0]} b={hover.edge[1]} color="#7fd1ff" />}
          <Dot at={hover.point} ghost />
        </>
      )}

      {seg && <Seg a={seg[0]} b={seg[1]} color="#ffd166" />}
      {seg && <Label a={seg[0]} b={seg[1]} pending={points.length < 2} />}
    </group>
  );
}

function Dot({ at, ghost }: { at: THREE.Vector3; ghost?: boolean }) {
  return (
    <mesh position={at} userData={{ measureHelper: true }} raycast={() => null}>
      <sphereGeometry args={[ghost ? 0.5 : 0.7, 14, 14]} />
      <meshBasicMaterial color={ghost ? '#7fd1ff' : '#ffd166'} depthTest={false} transparent opacity={ghost ? 0.95 : 1} />
    </mesh>
  );
}

/** A single overlay segment — the dimension line (yellow) or the snap-edge
 *  highlight (cyan). Drawn over the part (depthTest off) so it's never hidden. */
function Seg({ a, b, color }: { a: THREE.Vector3; b: THREE.Vector3; color: string }) {
  const geom = useMemo(() => new THREE.BufferGeometry().setFromPoints([a, b]), [a, b]);
  useEffect(() => () => geom.dispose(), [geom]);
  // <lineSegments> (not <line>, which clashes with the SVG element in JSX typings).
  return (
    <lineSegments geometry={geom} userData={{ measureHelper: true }} raycast={() => null}>
      <lineBasicMaterial color={color} depthTest={false} />
    </lineSegments>
  );
}

function Label({ a, b, pending }: { a: THREE.Vector3; b: THREE.Vector3; pending: boolean }) {
  const mid = useMemo(() => new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5), [a, b]);
  const d = a.distanceTo(b);
  const dx = Math.abs(b.x - a.x), dy = Math.abs(b.y - a.y), dz = Math.abs(b.z - a.z);
  return (
    <Html position={mid} center style={{ pointerEvents: 'none' }} zIndexRange={[18, 0]}>
      <div
        style={{
          padding: '3px 7px',
          borderRadius: 6,
          background: pending ? 'rgba(40,40,50,0.85)' : 'rgba(28,28,36,0.92)',
          border: '1px solid #ffd166',
          color: '#ffe9a8',
          font: '600 12px/1.3 system-ui, sans-serif',
          whiteSpace: 'nowrap',
          transform: 'translateY(-14px)',
          fontVariantNumeric: 'tabular-nums',
        }}
        title={`Δ ${dx.toFixed(2)} × ${dy.toFixed(2)} × ${dz.toFixed(2)} mm`}
      >
        {d.toFixed(2)} mm
      </div>
    </Html>
  );
}

export default Measure;
