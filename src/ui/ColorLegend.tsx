// ---------------------------------------------------------------------------
// ColorLegend — explains what the active additive "color by" scheme maps onto,
// since the option name alone is unclear. Bottom-center, additive mode only.
// ---------------------------------------------------------------------------

import { useStore, activeDoc } from '../store';
import { gradient, TOOL_PALETTE_HEX } from '../additive/buildGeometry';

function gradientCss(): string {
  const stops: string[] = [];
  for (let i = 0; i <= 8; i++) {
    const [r, g, b] = gradient(i / 8);
    stops.push(`rgb(${(r * 255) | 0},${(g * 255) | 0},${(b * 255) | 0}) ${(i / 8) * 100}%`);
  }
  return `linear-gradient(90deg, ${stops.join(',')})`;
}

export function ColorLegend() {
  const mode = useStore((s) => s.effectiveMode());
  const colorBy = useStore((s) => s.colorBy);
  const doc = useStore(activeDoc);
  const filament = useStore((s) => s.filamentColor);
  if (mode !== 'additive' || !doc) return null;

  let content: React.ReactNode;
  if (colorBy === 'realistic') {
    content = <Swatch color={filament} label="as printed" />;
  } else if (colorBy === 'layer') {
    content = <Bar leftLabel="bottom layer" rightLabel="top layer" />;
  } else if (colorBy === 'feedrate') {
    content = <Bar leftLabel="slow" rightLabel="fast" />;
  } else {
    const tools = doc.meta.tools && doc.meta.tools.length ? doc.meta.tools : [0];
    content = (
      <>
        {tools.map((t) => (
          <Swatch key={t} color={TOOL_PALETTE_HEX[t % TOOL_PALETTE_HEX.length]} label={`T${t}`} />
        ))}
      </>
    );
  }

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
        padding: '6px 12px',
        borderRadius: 8,
        background: 'rgba(28,28,36,0.88)',
        border: '1px solid #3a3a44',
        color: '#cdd',
        font: '12px system-ui, sans-serif',
        pointerEvents: 'none',
      }}
    >
      <span style={{ opacity: 0.6 }}>color: {labelFor(colorBy)}</span>
      {content}
    </div>
  );
}

function labelFor(c: string): string {
  return c === 'realistic'
    ? 'as printed'
    : c === 'feedrate'
      ? 'feed rate'
      : c === 'layer'
        ? 'layer height'
        : 'tool';
}

function Bar({ leftLabel, rightLabel }: { leftLabel: string; rightLabel: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ opacity: 0.7 }}>{leftLabel}</span>
      <div style={{ width: 120, height: 10, borderRadius: 3, background: gradientCss() }} />
      <span style={{ opacity: 0.7 }}>{rightLabel}</span>
    </div>
  );
}

function Swatch({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <span style={{ width: 11, height: 11, borderRadius: 3, background: color, display: 'inline-block' }} />
      {label}
    </span>
  );
}

export default ColorLegend;
