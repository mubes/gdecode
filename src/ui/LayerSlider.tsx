import { useCallback, useEffect, useRef } from 'react';
import { useStore } from '../store';

// ---------------------------------------------------------------------------
// Vertical dual-handle Z-layer range slider for the additive view.
//
// leva's interval slider is horizontal and fixed-height; to get more travel
// (and therefore finer resolution per layer) this is a custom tall vertical
// slider rendered down the LEFT edge of the viewport (opposite the control
// panel). Bottom = layer 0 (print base), top = top layer — matching the Z-up
// scene. Bound to store.layerRange [min, max]; only shown in additive mode.
// ---------------------------------------------------------------------------

const WIDTH = 46;
const THUMB = 16;

export function LayerSlider() {
  const mode = useStore((s) => s.effectiveMode());
  const layerRange = useStore((s) => s.layerRange);
  const setLayerRange = useStore((s) => s.setLayerRange);
  const max = useStore((s) => s.maxLayer());

  const trackRef = useRef<HTMLDivElement | null>(null);
  const dragging = useRef<null | 'lo' | 'hi'>(null);

  // Map a clientY within the track to a (rounded) layer index. Track top maps
  // to the top layer, bottom to layer 0.
  const layerFromClientY = useCallback(
    (clientY: number): number => {
      const el = trackRef.current;
      if (!el || max <= 0) return 0;
      const r = el.getBoundingClientRect();
      const frac = 1 - (clientY - r.top) / r.height; // 1 at top, 0 at bottom
      return Math.round(Math.min(1, Math.max(0, frac)) * max);
    },
    [max],
  );

  const moveActive = useCallback(
    (clientY: number) => {
      if (!dragging.current) return;
      const L = layerFromClientY(clientY);
      const [lo, hi] = useStore.getState().layerRange;
      if (dragging.current === 'lo') setLayerRange([Math.min(L, hi), hi]);
      else setLayerRange([lo, Math.max(L, lo)]);
    },
    [layerFromClientY, setLayerRange],
  );

  useEffect(() => {
    const onMove = (e: PointerEvent) => moveActive(e.clientY);
    const onUp = () => {
      dragging.current = null;
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [moveActive]);

  if (mode !== 'additive' || max < 1) return null;

  const [lo, hi] = layerRange;
  // Percent-from-top for a layer index.
  const topPct = (L: number) => `${(1 - L / max) * 100}%`;

  // Start dragging whichever thumb is nearer to the click, and jump it there.
  const onTrackDown = (e: React.PointerEvent) => {
    const L = layerFromClientY(e.clientY);
    dragging.current = Math.abs(L - lo) <= Math.abs(L - hi) ? 'lo' : 'hi';
    moveActive(e.clientY);
  };

  const thumbStyle = (L: number): React.CSSProperties => ({
    position: 'absolute',
    left: '50%',
    top: topPct(L),
    width: THUMB,
    height: THUMB,
    transform: 'translate(-50%, -50%)',
    borderRadius: '50%',
    background: '#4fa3ff',
    border: '2px solid #cfe6ff',
    boxShadow: '0 1px 4px rgba(0,0,0,0.5)',
    cursor: 'ns-resize',
    touchAction: 'none',
  });

  return (
    <div
      style={{
        position: 'fixed',
        left: 12, // left edge — opposite side from the control panel
        top: 64,
        bottom: 56,
        width: WIDTH,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        zIndex: 15,
        userSelect: 'none',
        pointerEvents: 'none', // children re-enable; lets clicks pass elsewhere
      }}
    >
      <div
        style={{
          fontSize: 11,
          color: '#9fb4cc',
          marginBottom: 6,
          pointerEvents: 'none',
        }}
      >
        Z {hi}
      </div>

      {/* Track */}
      <div
        ref={trackRef}
        onPointerDown={onTrackDown}
        style={{
          position: 'relative',
          flex: 1,
          width: 8,
          background: '#2b2b34',
          border: '1px solid #3a3a44',
          borderRadius: 4,
          cursor: 'pointer',
          pointerEvents: 'auto',
          touchAction: 'none',
        }}
      >
        {/* Selected range fill (between lo and hi). */}
        <div
          style={{
            position: 'absolute',
            left: -1,
            right: -1,
            top: topPct(hi),
            bottom: `${(lo / max) * 100}%`,
            background: 'linear-gradient(#4fa3ff, #2e6fb0)',
            borderRadius: 4,
          }}
        />
        {/* Thumbs */}
        <div
          role="slider"
          aria-label="top layer"
          aria-valuenow={hi}
          aria-valuemin={0}
          aria-valuemax={max}
          onPointerDown={(e) => {
            e.stopPropagation();
            dragging.current = 'hi';
          }}
          style={thumbStyle(hi)}
        />
        <div
          role="slider"
          aria-label="bottom layer"
          aria-valuenow={lo}
          aria-valuemin={0}
          aria-valuemax={max}
          onPointerDown={(e) => {
            e.stopPropagation();
            dragging.current = 'lo';
          }}
          style={thumbStyle(lo)}
        />
      </div>

      <div
        style={{
          fontSize: 11,
          color: '#9fb4cc',
          marginTop: 6,
          pointerEvents: 'none',
        }}
      >
        Z {lo}
      </div>
    </div>
  );
}

export default LayerSlider;
