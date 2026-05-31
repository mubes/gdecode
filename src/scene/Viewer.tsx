import { Canvas } from '@react-three/fiber';
import { OrbitControls, Bounds } from '@react-three/drei';
import type { ReactNode } from 'react';
import * as THREE from 'three';
import { SceneHelpers, FitController } from './Helpers';

// The shared R3F scene host. Mode-specific models are passed in as children so
// both additive and subtractive views share one camera, lighting, and controls.
//
// Z-up: we set camera.up = +Z (CAM/printer convention) and place the camera at
// an isometric-ish position looking at the origin.
export function Viewer({ children }: { children?: ReactNode }) {
  return (
    <Canvas
      style={{ position: 'absolute', inset: 0 }}
      gl={{ antialias: true, preserveDrawingBuffer: true }}
      camera={{ position: [200, -200, 200], up: [0, 0, 1], fov: 45, near: 0.1, far: 10000 }}
      onCreated={({ camera, scene }) => {
        camera.up.set(0, 0, 1);
        scene.background = new THREE.Color('#1a1a1f');
      }}
    >
      <ambientLight intensity={0.6} />
      <directionalLight position={[100, -100, 300]} intensity={1.1} />
      <directionalLight position={[-150, 150, 100]} intensity={0.4} />

      <SceneHelpers />

      <Bounds fit clip observe margin={1.2}>
        <FitController />
        {children}
      </Bounds>

      <OrbitControls makeDefault enableDamping dampingFactor={0.1} />
    </Canvas>
  );
}
