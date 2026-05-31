import { Leva, useControls, folder, button } from 'leva';
import { useStore, activeDoc } from '../store';
import type { AdditiveColorBy } from '../store';
import type { Mode, ToolKind, StockDef } from '../types';

// ---------------------------------------------------------------------------
// gdecode — leva control panel. ONE useControls call builds the whole schema
// (Mode → active-mode folder → View) so leva renders deterministically.
// ---------------------------------------------------------------------------

// Clearer color-by labels (the raw enum was opaque). A legend (ColorLegend.tsx)
// explains what the active scheme maps onto.
const COLOR_BY_OPTIONS: Record<string, AdditiveColorBy> = {
  'as printed (realistic)': 'realistic',
  'layer (height)': 'layer',
  'feed rate': 'feedrate',
  tool: 'tool',
};
const GRID_RES_OPTIONS = [256, 512, 1024, 2048];
const TOOL_KINDS: ToolKind[] = ['flat', 'ball', 'vbit'];

const MODE_OPTIONS: Record<string, Mode | null> = {
  Auto: null,
  Additive: 'additive',
  Subtractive: 'subtractive',
};

const DEFAULT_STOCK: StockDef = { origin: [0, 0, 0], sizeX: 100, sizeY: 100, sizeZ: 20 };

export function ControlPanel() {
  const doc = useStore(activeDoc);
  const selectedId = useStore((s) => s.selectedId);
  const activeModel = useStore((s) => s.activeModel());
  const modeOverride = useStore((s) => s.modeOverride);
  const colorBy = useStore((s) => s.colorBy);
  const renderTubes = useStore((s) => s.renderTubes);
  const extrusionWidth = useStore((s) => s.extrusionWidth);
  const filamentColor = useStore((s) => s.filamentColor);
  const opIndex = useStore((s) => s.opIndex);
  const gridRes = useStore((s) => s.gridRes);
  const tool = useStore((s) => s.tool);
  const stock = useStore((s) => s.stock);
  const stockColor = useStore((s) => s.stockColor);
  const stockEditNonce = useStore((s) => s.stockEditNonce);
  const showGrid = useStore((s) => s.showGrid);
  const showAxes = useStore((s) => s.showAxes);
  const showStats = useStore((s) => s.showStats);
  const showTravel = useStore((s) => s.showTravel);
  const showBounds = useStore((s) => s.showBounds);

  const effectiveMode = useStore((s) => s.effectiveMode)();
  const detectedMode: Mode | null = doc?.mode ?? null;

  const moveCount = doc?.moves.length ?? 0;
  const curStock = stock ?? DEFAULT_STOCK;
  const modelScale = activeModel?.scale ?? 1;

  // Stock slider bounds: the toolpath bbox expanded by a generous per-axis
  // margin (≥ the axis extent, min 100mm) so the stock can be grown well
  // beyond the cut envelope. Dragging the stock faces in the 3D view sets the
  // same values; these wider ranges keep that room available on the sliders.
  const bnd = (axis: 0 | 1 | 2): [number, number] => {
    if (!doc) return [-200, 200];
    const lo = doc.bbox.min[axis];
    const hi = doc.bbox.max[axis];
    const pad = Math.max(100, hi - lo);
    return [Math.floor(lo - pad), Math.ceil(hi + pad)];
  };

  const isAdditive = effectiveMode === 'additive';
  const isSubtractive = effectiveMode === 'subtractive';

  // Current stock extents as [min,max] per axis.
  const sx: [number, number] = [curStock.origin[0], curStock.origin[0] + curStock.sizeX];
  const sy: [number, number] = [curStock.origin[1], curStock.origin[1] + curStock.sizeY];
  const sz: [number, number] = [curStock.origin[2], curStock.origin[2] + curStock.sizeZ];

  const setStockAxis = (axis: 0 | 1 | 2, min: number, max: number) => {
    const s = useStore.getState().stock ?? DEFAULT_STOCK;
    const origin: [number, number, number] = [...s.origin];
    origin[axis] = min;
    const size = { sizeX: s.sizeX, sizeY: s.sizeY, sizeZ: s.sizeZ };
    if (axis === 0) size.sizeX = max - min;
    if (axis === 1) size.sizeY = max - min;
    if (axis === 2) size.sizeZ = max - min;
    useStore.getState().setStock({ origin, ...size });
  };

  useControls(
    () => {
      const schema: FolderSchema = {
        Mode: makeFolder({
          override: {
            label: 'mode',
            options: MODE_OPTIONS,
            value: modeOverride,
            onChange: (v: Mode | null, _p, { initial }) => {
              if (initial) return;
              useStore.getState().setModeOverride(v);
            },
          },
        }),
      };

      if (isAdditive) {
        // Z layer-range is the dedicated vertical LayerSlider on the left.
        schema.Additive = makeFolder({
          scale: {
            label: 'scale (selected)',
            value: modelScale,
            min: 0.1,
            max: 5,
            step: 0.05,
            onChange: (v: number, _p, { initial }) => {
              if (initial) return;
              const id = useStore.getState().selectedId;
              if (id) useStore.getState().setModelScale(id, v);
            },
          },
          nozzleWidth: {
            label: 'nozzle width (mm)',
            value: extrusionWidth,
            min: 0.1,
            max: 5,
            step: 0.05,
            onChange: (v: number, _p, { initial }) => {
              if (initial) return;
              useStore.getState().setExtrusionWidth(v);
            },
          },
          renderTubes: {
            label: 'solid (tubes)',
            value: renderTubes,
            onChange: (v: boolean, _p, { initial }) => {
              if (initial) return;
              useStore.getState().setRenderTubes(v);
            },
          },
          colorBy: {
            label: 'color by',
            options: COLOR_BY_OPTIONS,
            value: colorBy,
            onChange: (v: AdditiveColorBy, _p, { initial }) => {
              if (initial) return;
              useStore.getState().setColorBy(v);
            },
          },
          filament: {
            label: 'filament color',
            value: filamentColor,
            onChange: (v: string, _p, { initial }) => {
              if (initial) return;
              useStore.getState().setFilamentColor(v);
            },
          },
        });
      } else if (isSubtractive) {
        schema.Subtractive = makeFolder({
          operation: {
            label: 'operation',
            value: clampNum(opIndex, -1, moveCount),
            min: -1,
            max: moveCount,
            step: 1,
            onChange: (v: number, _p, { initial }) => {
              if (initial) return;
              useStore.getState().setOpIndex(v);
            },
          },
          gridRes: {
            label: 'grid res',
            options: GRID_RES_OPTIONS,
            value: gridRes,
            onChange: (v: number, _p, { initial }) => {
              if (initial) return;
              useStore.getState().setGridRes(v);
            },
          },
          toolKind: {
            label: 'tool',
            options: TOOL_KINDS,
            value: tool.kind,
            onChange: (v: ToolKind, _p, { initial }) => {
              if (initial) return;
              useStore.getState().setTool({ ...useStore.getState().tool, kind: v });
            },
          },
          diameter: {
            label: 'diameter',
            value: tool.diameter,
            min: 0.1,
            step: 0.1,
            onChange: (v: number, _p, { initial }) => {
              if (initial) return;
              useStore.getState().setTool({ ...useStore.getState().tool, diameter: v });
            },
          },
          vAngle: {
            label: 'V angle',
            value: tool.vAngle ?? 90,
            min: 1,
            max: 179,
            step: 1,
            render: (get) => get('Subtractive.toolKind') === 'vbit',
            onChange: (v: number, _p, { initial }) => {
              if (initial) return;
              useStore.getState().setTool({ ...useStore.getState().tool, vAngle: v });
            },
          },
          // Stock = base material bounds as X/Y/Z min..max interval sliders.
          stockX: {
            label: 'stock X (min..max)',
            value: sx,
            min: bnd(0)[0],
            max: bnd(0)[1],
            step: 1,
            onChange: (v: [number, number], _p, { initial }) => {
              if (initial) return;
              setStockAxis(0, Math.min(v[0], v[1]), Math.max(v[0], v[1]));
            },
          },
          stockY: {
            label: 'stock Y (min..max)',
            value: sy,
            min: bnd(1)[0],
            max: bnd(1)[1],
            step: 1,
            onChange: (v: [number, number], _p, { initial }) => {
              if (initial) return;
              setStockAxis(1, Math.min(v[0], v[1]), Math.max(v[0], v[1]));
            },
          },
          stockZ: {
            label: 'stock Z (min..max)',
            value: sz,
            min: bnd(2)[0],
            max: bnd(2)[1],
            step: 1,
            onChange: (v: [number, number], _p, { initial }) => {
              if (initial) return;
              setStockAxis(2, Math.min(v[0], v[1]), Math.max(v[0], v[1]));
            },
          },
          stockColor: {
            label: 'stock color',
            value: stockColor,
            onChange: (v: string, _p, { initial }) => {
              if (initial) return;
              useStore.getState().setStockColor(v);
            },
          },
        });
      }

      schema.View = makeFolder({
        showGrid: {
          label: 'grid',
          value: showGrid,
          onChange: (v: boolean, _p, { initial }) => {
            if (initial) return;
            useStore.getState().setShowGrid(v);
          },
        },
        showAxes: {
          label: 'axes',
          value: showAxes,
          onChange: (v: boolean, _p, { initial }) => {
            if (initial) return;
            useStore.getState().setShowAxes(v);
          },
        },
        showStats: {
          label: 'stats',
          value: showStats,
          onChange: (v: boolean, _p, { initial }) => {
            if (initial) return;
            useStore.getState().setShowStats(v);
          },
        },
        showTravel: {
          label: 'travel moves',
          value: showTravel,
          onChange: (v: boolean, _p, { initial }) => {
            if (initial) return;
            useStore.getState().setShowTravel(v);
          },
        },
        showBounds: {
          label: 'selection box',
          value: showBounds,
          onChange: (v: boolean, _p, { initial }) => {
            if (initial) return;
            useStore.getState().setShowBounds(v);
          },
        },
        fit: button(() => useStore.getState().requestFit()),
      });

      return schema;
    },
    // Structural deps only (live-edited values excluded to avoid mid-drag
    // rebuilds). selectedId rebuilds so per-model controls (scale) + stock
    // bounds re-seed when the active model changes; stockEditNonce re-seeds the
    // stock sliders once after a face is dragged in the 3D view.
    [isAdditive, isSubtractive, detectedMode, modeOverride, moveCount, selectedId, stockEditNonce],
  );

  return <Leva collapsed={false} />;
}

// --- helpers ---------------------------------------------------------------

type FolderSchema = Record<string, ReturnType<typeof folder>>;

function makeFolder(
  schema: Parameters<typeof folder>[0],
  settings?: Parameters<typeof folder>[1],
): FolderSchema[string] {
  return folder(schema, settings) as FolderSchema[string];
}

function clampNum(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export default ControlPanel;
