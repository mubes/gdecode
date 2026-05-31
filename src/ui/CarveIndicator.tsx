// ---------------------------------------------------------------------------
// CarveIndicator — visible feedback while the subtractive height-map carve is
// recomputing. Shown whenever the store status is 'carving' (e.g. after a tool,
// grid, stock, or operation change, or while dragging a stock face). Displays a
// small progress bar driven by the worker's 0..1 progress. Top-centre overlay.
// ---------------------------------------------------------------------------

import { useStore } from '../store';

export function CarveIndicator() {
  const status = useStore((s) => s.status);
  const progress = useStore((s) => s.progress);

  if (status !== 'carving') return null;

  const pct = Math.round(Math.min(1, Math.max(0, progress)) * 100);

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        top: 12,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 25,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        minWidth: 200,
        padding: '8px 12px',
        borderRadius: 8,
        background: 'rgba(28,28,36,0.92)',
        border: '1px solid #3a5a8c',
        color: '#cde',
        font: '12px system-ui, sans-serif',
        boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
        pointerEvents: 'none',
        backdropFilter: 'blur(4px)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
        <span>Recomputing workpiece…</span>
        <span style={{ fontVariantNumeric: 'tabular-nums', opacity: 0.8 }}>{pct}%</span>
      </div>
      <div style={{ height: 4, borderRadius: 2, background: '#2b2b34', overflow: 'hidden' }}>
        <div
          style={{
            width: `${pct}%`,
            height: '100%',
            background: 'linear-gradient(90deg, #4fa3ff, #6da7ff)',
            transition: 'width 80ms linear',
          }}
        />
      </div>
    </div>
  );
}

export default CarveIndicator;
