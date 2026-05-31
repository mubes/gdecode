// ---------------------------------------------------------------------------
// ColorWell — a compact editable colour swatch backed by a native
// <input type="color">. Shows ONLY the swatch (no hex readout, which leva's
// colour control can't suppress), so it's used wherever a colour is edited in
// the overlays: filament colours (ColorLegend) and the stock colour (FileInfo).
//
// `pointerEvents` is forced on here because some host overlays disable them.
// ---------------------------------------------------------------------------

export function ColorWell({
  color,
  label,
  onChange,
}: {
  color: string;
  label?: string;
  onChange: (c: string) => void;
}) {
  return (
    <label
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        pointerEvents: 'auto',
        cursor: 'pointer',
      }}
      title={label ? `${label} colour` : 'colour'}
    >
      <input
        type="color"
        value={color}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: 16,
          height: 16,
          padding: 0,
          border: '1px solid #555',
          borderRadius: 3,
          background: 'none',
          cursor: 'pointer',
        }}
      />
      {label}
    </label>
  );
}

export default ColorWell;
