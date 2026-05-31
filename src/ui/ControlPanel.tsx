import { Leva, useControls, folder, button } from 'leva';
import { useStore, activeDoc } from '../store';
import type { AdditiveColorBy } from '../store';
import type { Mode, ToolKind } from '../types';

// ---------------------------------------------------------------------------
// gdecode — leva control panel. ONE useControls call builds the whole schema
// (Mode → active-mode folder → View) so leva renders deterministically.
// ---------------------------------------------------------------------------

// Clearer color-by labels (the raw enum was opaque). A legend (ColorLegend.tsx)
// explains what the active scheme maps onto.
const COLOR_BY_OPTIONS: Record<string, AdditiveColorBy> = {
  'as printed': 'realistic',
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

export function ControlPanel() {
  const doc = useStore(activeDoc);
  const modeOverride = useStore((s) => s.modeOverride);
  const colorBy = useStore((s) => s.colorBy);
  const renderTubes = useStore((s) => s.renderTubes);
  const extrusionWidth = useStore((s) => s.extrusionWidth);
  const gridRes = useStore((s) => s.gridRes);
  const tool = useStore((s) => s.tool);
  const showStockEditor = useStore((s) => s.showStockEditor);
  const showGrid = useStore((s) => s.showGrid);
  const showAxes = useStore((s) => s.showAxes);
  const showStats = useStore((s) => s.showStats);
  const showTravel = useStore((s) => s.showTravel);
  const showBounds = useStore((s) => s.showBounds);

  const effectiveMode = useStore((s) => s.effectiveMode)();
  const detectedMode: Mode | null = doc?.mode ?? null;

  const isAdditive = effectiveMode === 'additive';
  const isSubtractive = effectiveMode === 'subtractive';

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
          // Filament colours (per tool) are edited via the swatches in the
          // bottom-centre legend (ui/ColorLegend) — native colour wells with no
          // hex readout, which leva's colour control can't suppress.
        });
      } else if (isSubtractive) {
        schema.Subtractive = makeFolder({
          // The operation scrubber is a custom debounced slider (ui/OpScrubber),
          // not a leva control — leva's number input can't show "all" for -1.
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
          // Stock bounds are edited by dragging the face arrows in the 3D view
          // (the live dimensions show in the file-info panel). The stock colour
          // is a native colour well in that same panel — leva's colour control
          // can't hide its hex readout. No sliders here.
          editHandles: {
            label: 'edit handles',
            value: showStockEditor,
            onChange: (v: boolean, _p, { initial }) => {
              if (initial) return;
              useStore.getState().setShowStockEditor(v);
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
    // rebuilds): the schema shape only depends on the active mode.
    [isAdditive, isSubtractive, detectedMode, modeOverride],
  );

  // Wider panel + a roomier label column so toggle labels aren't truncated.
  return (
    <Leva
      collapsed={false}
      titleBar={{ filter: false }}
      theme={{ sizes: { rootWidth: '340px', controlWidth: '150px' } }}
    />
  );
}

// --- helpers ---------------------------------------------------------------

type FolderSchema = Record<string, ReturnType<typeof folder>>;

function makeFolder(
  schema: Parameters<typeof folder>[0],
  settings?: Parameters<typeof folder>[1],
): FolderSchema[string] {
  return folder(schema, settings) as FolderSchema[string];
}

export default ControlPanel;
