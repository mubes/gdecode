// ---------------------------------------------------------------------------
// gdecode — Additive (FDM) renderer, native R3F.
//
// Replaces the gcode-preview library: the FDM view is now built from our parsed
// IR as geometry in the SHARED R3F scene. This unifies the camera with the
// subtractive view and unlocks axes, Fit, the scene grid, and — crucially —
// MULTIPLE models, each a draggable/scalable group on the build plate.
//
// Each model renders as line segments (thin) or fat world-unit lines (the
// "solid" / nozzle-width view). Click to select; drag on the XY plane to
// reposition; per-model scale comes from the store transform.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useRef } from 'react';
import { useThree, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { useStore, type ModelEntry } from '../store';
import { buildLineBuffers, buildInstanceMatrices, buildTravelBuffers } from './buildGeometry';

export function AdditiveModels() {
  const models = useStore((s) => s.models);
  const mode = useStore((s) => s.effectiveMode());
  const { camera, gl, raycaster, controls } = useThree();

  const dragId = useRef<string | null>(null);
  const grab = useRef<[number, number]>([0, 0]);
  const plane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), []);

  // Window-level drag: unproject the pointer onto the z=0 build plate.
  useEffect(() => {
    const dom = gl.domElement;
    const ndc = new THREE.Vector2();
    const pt = new THREE.Vector3();
    const onMove = (e: PointerEvent) => {
      if (!dragId.current) return;
      const r = dom.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      if (raycaster.ray.intersectPlane(plane, pt)) {
        useStore
          .getState()
          .setModelPosition(dragId.current, [pt.x - grab.current[0], pt.y - grab.current[1], 0]);
      }
    };
    const onUp = () => {
      if (dragId.current) {
        dragId.current = null;
        if (controls) (controls as { enabled?: boolean }).enabled = true;
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [camera, gl, raycaster, plane, controls]);

  if (mode !== 'additive') return null;

  const onGrab = (id: string, e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    const m = useStore.getState().models.find((x) => x.id === id);
    if (!m) return;
    grab.current = [e.point.x - m.position[0], e.point.y - m.position[1]];
    dragId.current = id;
    useStore.getState().selectModel(id);
    if (controls) (controls as { enabled?: boolean }).enabled = false; // pause orbit while dragging
  };

  return (
    <>
      {models
        .filter((m) => m.doc.mode === 'additive')
        .map((m) => (
          <AdditiveModelObject key={m.id} model={m} onGrab={onGrab} />
        ))}
    </>
  );
}

function AdditiveModelObject({
  model,
  onGrab,
}: {
  model: ModelEntry;
  onGrab: (id: string, e: ThreeEvent<PointerEvent>) => void;
}) {
  const layerRange = useStore((s) => s.layerRange);
  const colorBy = useStore((s) => s.colorBy);
  const renderTubes = useStore((s) => s.renderTubes);
  const extrusionWidth = useStore((s) => s.extrusionWidth);
  const filamentColor = useStore((s) => s.filamentColor);
  const showTravel = useStore((s) => s.showTravel);
  const showBounds = useStore((s) => s.showBounds);
  const selectedId = useStore((s) => s.selectedId);
  const size = useThree((s) => s.size);

  const realistic = colorBy === 'realistic';

  // Diagnostic line buffers (skipped in realistic mode).
  const buffers = useMemo(
    () =>
      realistic
        ? { positions: new Float32Array(), colors: new Float32Array(), segmentCount: 0 }
        : buildLineBuffers(model.doc, layerRange, colorBy),
    [realistic, model.doc, layerRange, colorBy],
  );

  const thinGeom = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(buffers.positions, 3));
    g.setAttribute('color', new THREE.BufferAttribute(buffers.colors, 3));
    return g;
  }, [buffers]);

  const fat = useMemo(() => {
    const g = new LineSegmentsGeometry();
    const mat = new LineMaterial({ worldUnits: true, linewidth: extrusionWidth, vertexColors: true });
    const obj = new LineSegments2(g, mat);
    if (buffers.positions.length) {
      g.setPositions(buffers.positions as unknown as number[]);
      g.setColors(buffers.colors as unknown as number[]);
      obj.computeLineDistances(); // needs a position attribute; skip when empty
    }
    return { obj, g, mat };
  }, [buffers, extrusionWidth]);

  useEffect(() => {
    fat.mat.resolution.set(size.width, size.height);
  }, [fat, size]);
  useEffect(() => () => thinGeom.dispose(), [thinGeom]);
  useEffect(() => () => { fat.g.dispose(); fat.mat.dispose(); }, [fat]);

  // --- realistic "as printed": one lit box bead per extrusion (InstancedMesh) -
  const bb = model.doc.bbox;
  const layerHeight = useMemo(() => {
    const lc = model.doc.meta.layerCount ?? 0;
    const dz = bb.max[2] - bb.min[2];
    return lc > 1 && dz > 0 ? dz / lc : Math.max(0.1, extrusionWidth * 0.5);
  }, [model.doc, bb, extrusionWidth]);

  const instances = useMemo(
    () => (realistic ? buildInstanceMatrices(model.doc, layerRange, extrusionWidth, layerHeight) : null),
    [realistic, model.doc, layerRange, extrusionWidth, layerHeight],
  );

  // Build the InstancedMesh imperatively (robust vs. R3F args/children timing).
  const inst = useMemo(() => {
    if (!instances) return null;
    const geom = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.7, metalness: 0.05 });
    const mesh = new THREE.InstancedMesh(geom, mat, Math.max(1, instances.count));
    const m = new THREE.Matrix4();
    for (let i = 0; i < instances.count; i++) {
      m.fromArray(instances.matrices, i * 16);
      mesh.setMatrixAt(i, m);
    }
    mesh.count = instances.count;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    return { mesh, geom, mat };
  }, [instances]);

  useEffect(() => {
    if (inst) inst.mat.color.set(filamentColor);
  }, [inst, filamentColor]);
  useEffect(
    () => () => {
      if (inst) {
        inst.geom.dispose();
        inst.mat.dispose();
        inst.mesh.dispose();
      }
    },
    [inst],
  );

  // Travel (non-printing) moves — always-on hairlines (1px via LineBasicMaterial).
  const travel = useMemo(() => {
    const positions = buildTravelBuffers(model.doc, layerRange);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    return { g, count: positions.length / 6 };
  }, [model.doc, layerRange]);
  useEffect(() => () => travel.g.dispose(), [travel]);

  const selected = selectedId === model.id;
  const selBox = useMemo(
    () => new THREE.Box3(new THREE.Vector3(...bb.min), new THREE.Vector3(...bb.max)),
    [bb],
  );

  // Offset so the model's XY-center is at the group origin and its base sits on
  // the build plate — position/scale then behave around the model's center.
  const offset: [number, number, number] = [
    -(bb.min[0] + bb.max[0]) / 2,
    -(bb.min[1] + bb.max[1]) / 2,
    -bb.min[2],
  ];

  const grab = (e: ThreeEvent<PointerEvent>) => onGrab(model.id, e);

  return (
    <group position={model.position} scale={model.scale}>
      <group position={offset}>
        {realistic && inst ? (
          <primitive object={inst.mesh} onPointerDown={grab} />
        ) : renderTubes ? (
          <primitive object={fat.obj} onPointerDown={grab} />
        ) : (
          <lineSegments geometry={thinGeom} onPointerDown={grab}>
            <lineBasicMaterial vertexColors />
          </lineSegments>
        )}

        {/* Travel moves: always hairline thin lines, in every view mode. */}
        {showTravel && travel.count > 0 && (
          <lineSegments geometry={travel.g}>
            <lineBasicMaterial color="#7a8a99" transparent opacity={0.5} depthWrite={false} />
          </lineSegments>
        )}

        {showBounds && selected && <box3Helper args={[selBox, new THREE.Color('#ffd166')]} />}
      </group>
    </group>
  );
}

export default AdditiveModels;
