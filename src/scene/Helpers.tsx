import { useEffect } from 'react';
import { Grid, GizmoHelper, GizmoViewcube, useBounds } from '@react-three/drei';
import { useStore } from '../store';

// Z-up scene helpers shared by both renderers: grid on the XY plane, axes,
// viewcube gizmo, optional stats, and a fit-to-frame controller driven by the
// store's `fitRequest` counter.

/** Watches `fitRequest` and refits the camera to the scene contents. */
export function FitController() {
  const bounds = useBounds();
  const fitRequest = useStore((s) => s.fitRequest);
  useEffect(() => {
    bounds.refresh().clip().fit();
  }, [fitRequest, bounds]);
  return null;
}

export function SceneHelpers() {
  const showGrid = useStore((s) => s.showGrid);
  const showAxes = useStore((s) => s.showAxes);

  return (
    <>
      {showGrid && (
        // Grid lies in the world XY plane (rotate the drei XZ grid +90° about X)
        // to match the Z-up CAM/printer convention.
        <Grid
          rotation={[Math.PI / 2, 0, 0]}
          args={[400, 400]}
          cellSize={10}
          cellThickness={0.6}
          sectionSize={100}
          sectionThickness={1.2}
          sectionColor="#4a90d9"
          cellColor="#3a3a44"
          fadeDistance={1200}
          infiniteGrid
        />
      )}
      {showAxes && <axesHelper args={[50]} />}
      <GizmoHelper alignment="bottom-right" margin={[80, 80]}>
        <GizmoViewcube />
      </GizmoHelper>
      {/* FPS readout is a renderer-agnostic DOM overlay (ui/StatsOverlay),
          mounted in App so it works in the additive view too. */}
    </>
  );
}
