// ---------------------------------------------------------------------------
// OpScrubber — subtractive "operation" scrubber (bottom-centre).
//
// leva's number slider can't relabel a value, so — like LayerSlider — this is a
// small custom DOM control. The leftmost position (-1) carves EVERY move and is
// shown as "all" rather than "-1"; any other position carves moves [0..n]. The
// thumb and label track the drag live, but the store commit (which triggers the
// expensive re-carve) is DEBOUNCED, so scrubbing doesn't re-carve every step.
//
// The value is per-model (store.activeOpIndex / setOpIndex), so each loaded file
// keeps its own scrub position.
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState } from 'react';
import { useStore, activeDoc } from '../store';

/** Quiet period (ms) after the last scrub before the carve is kicked off. */
const DEBOUNCE_MS = 200;

export function OpScrubber() {
  const mode = useStore((s) => s.effectiveMode());
  const opIndex = useStore((s) => s.activeOpIndex());
  const doc = useStore(activeDoc);
  const total = doc?.moves.length ?? 0;

  const [live, setLive] = useState(opIndex);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Re-sync the thumb when the store value changes out from under us (e.g.
  // selecting a different model, which has its own scrub position).
  useEffect(() => setLive(opIndex), [opIndex]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  if (mode !== 'subtractive' || !doc || total === 0) return null;

  const onInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = Number(e.target.value);
    setLive(v); // immediate: thumb + label stay responsive
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => useStore.getState().setOpIndex(v), DEBOUNCE_MS);
  };

  const label = live < 0 ? 'all' : `${live.toLocaleString()} / ${total.toLocaleString()}`;

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 14,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 16,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '8px 14px',
        borderRadius: 8,
        background: 'rgba(28,28,36,0.88)',
        border: '1px solid #3a3a44',
        color: '#cdd',
        font: '12px system-ui, sans-serif',
        backdropFilter: 'blur(6px)',
      }}
    >
      <span style={{ opacity: 0.6 }}>operation</span>
      <input
        type="range"
        min={-1}
        max={total}
        step={1}
        value={live}
        onChange={onInput}
        style={{ width: 220, accentColor: '#4fa3ff', cursor: 'pointer' }}
      />
      <span style={{ minWidth: 70, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
        {label}
      </span>
    </div>
  );
}

export default OpScrubber;
