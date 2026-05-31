import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';

// ---------------------------------------------------------------------------
// Renderer-agnostic FPS overlay, toggled by the View → stats control. A
// requestAnimationFrame-based counter (rather than drei's <Stats/>) keeps it
// simple and independent of the render loop. Shown bottom-left when enabled.
// ---------------------------------------------------------------------------

export function StatsOverlay() {
  const showStats = useStore((s) => s.showStats);
  const [fps, setFps] = useState(0);
  const raf = useRef<number>(0);

  useEffect(() => {
    if (!showStats) return;
    let frames = 0;
    let last = performance.now();
    const tick = () => {
      frames++;
      const now = performance.now();
      if (now - last >= 500) {
        setFps(Math.round((frames * 1000) / (now - last)));
        frames = 0;
        last = now;
      }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [showStats]);

  if (!showStats) return null;

  return (
    <div
      style={{
        position: 'fixed',
        left: 12,
        bottom: 12,
        zIndex: 16,
        padding: '4px 8px',
        borderRadius: 6,
        background: 'rgba(20,20,26,0.85)',
        border: '1px solid #3a3a44',
        color: '#8de58d',
        font: '600 12px ui-monospace, monospace',
        fontVariantNumeric: 'tabular-nums',
        pointerEvents: 'none',
      }}
    >
      {fps} FPS
    </div>
  );
}

export default StatsOverlay;
