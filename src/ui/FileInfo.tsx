// ---------------------------------------------------------------------------
// FileInfo — model manager + active-model details (top, right of the Z slider).
// Lists all loaded models (click to select, × to remove), then shows details
// for the selected model. Renders nothing until at least one model is loaded.
// ---------------------------------------------------------------------------

import { useStore, activeDoc } from '../store';

function fmt(n: number): string {
  if (!isFinite(n)) return '–';
  return (Math.round(n * 100) / 100).toString();
}

export function FileInfo() {
  const models = useStore((s) => s.models);
  const selectedId = useStore((s) => s.selectedId);
  const doc = useStore(activeDoc);
  const selectModel = useStore((s) => s.selectModel);
  const removeModel = useStore((s) => s.removeModel);
  const clearModels = useStore((s) => s.clearModels);
  const effectiveMode = useStore((s) => s.effectiveMode());

  if (models.length === 0) return null;

  return (
    <div
      style={{
        position: 'fixed',
        top: 56,
        left: 70,
        zIndex: 15,
        minWidth: 210,
        maxWidth: 320,
        padding: '10px 12px',
        borderRadius: 10,
        background: 'rgba(28,28,36,0.88)',
        border: '1px solid #3a3a44',
        color: '#dde',
        fontSize: 12,
        lineHeight: 1.5,
        backdropFilter: 'blur(6px)',
        boxShadow: '0 4px 16px rgba(0,0,0,0.35)',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ opacity: 0.6 }}>Models ({models.length})</span>
        {models.length > 1 && (
          <button onClick={clearModels} style={linkBtn}>
            clear all
          </button>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginBottom: 8 }}>
        {models.map((m) => {
          const sel = m.id === selectedId;
          return (
            <div
              key={m.id}
              onClick={() => selectModel(m.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '2px 6px',
                borderRadius: 6,
                cursor: 'pointer',
                background: sel ? 'rgba(79,163,255,0.22)' : 'transparent',
                border: `1px solid ${sel ? '#4fa3ff' : 'transparent'}`,
              }}
            >
              <span
                style={{
                  flex: 1,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
                title={m.fileName}
              >
                {m.fileName}
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  removeModel(m.id);
                }}
                style={linkBtn}
                title="remove"
              >
                ×
              </button>
            </div>
          );
        })}
      </div>

      {doc && <Details mode={effectiveMode ?? doc.mode} />}
    </div>
  );
}

function Details({ mode }: { mode: string }) {
  const doc = useStore(activeDoc);
  if (!doc) return null;
  const { bbox, units, moves, meta } = doc;
  const rows: [string, string][] = [
    ['Mode', mode],
    ['Units', units],
    [
      'Size',
      `${fmt(bbox.max[0] - bbox.min[0])} × ${fmt(bbox.max[1] - bbox.min[1])} × ${fmt(
        bbox.max[2] - bbox.min[2],
      )} ${units}`,
    ],
    ['Moves', moves.length.toLocaleString()],
  ];
  if (meta.layerCount !== undefined) rows.push(['Layers', meta.layerCount.toLocaleString()]);
  if (meta.tools && meta.tools.length) rows.push(['Tools', meta.tools.join(', ')]);
  if (meta.generator) rows.push(['Generator', meta.generator]);

  return (
    <table style={{ borderCollapse: 'collapse', width: '100%' }}>
      <tbody>
        {rows.map(([k, v]) => (
          <tr key={k}>
            <td style={{ opacity: 0.6, paddingRight: 10, verticalAlign: 'top', whiteSpace: 'nowrap' }}>
              {k}
            </td>
            <td style={{ textAlign: 'right', wordBreak: 'break-word', fontVariantNumeric: 'tabular-nums' }}>
              {v}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const linkBtn: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: '#9fb4cc',
  cursor: 'pointer',
  fontSize: 12,
  padding: '0 2px',
};

export default FileInfo;
