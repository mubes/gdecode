import { create } from 'zustand';
import type { GcodeDoc, Mode, StockDef, ToolDef } from './types';

// ---------------------------------------------------------------------------
// Global app store.
//
// Supports MULTIPLE loaded models (additive build-plate use case): each model
// carries its parsed IR plus a per-model transform (XY position on the plate +
// uniform scale). One model is "selected" (drives the info panel + per-model
// controls). The subtractive carve operates on the active model only.
// ---------------------------------------------------------------------------

// 'realistic' is a render *style* (lit solid in the filament color = "as
// printed"); the others are diagnostic colormaps. (Travel moves are shown
// separately as always-on hairlines, so there's no 'moveType' colormap.)
export type AdditiveColorBy = 'realistic' | 'layer' | 'feedrate' | 'tool';
export type Status = 'idle' | 'parsing' | 'ready' | 'carving' | 'error';

export interface ModelEntry {
  id: string;
  fileName: string;
  doc: GcodeDoc;
  /** XY(Z) offset applied on the build plate (Z usually 0). */
  position: [number, number, number];
  /** Uniform scale factor (1 = original size). */
  scale: number;
}

export interface AppState {
  // --- models ---
  models: ModelEntry[];
  selectedId: string | null;

  // --- status ---
  status: Status;
  error: string | null;
  progress: number;

  // --- mode ---
  /** null = follow auto-detection (active model's mode). */
  modeOverride: Mode | null;

  // --- additive view (global across models) ---
  layerRange: [number, number];
  colorBy: AdditiveColorBy;
  renderTubes: boolean;
  extrusionWidth: number;
  /** Filament color for the realistic "as printed" view. */
  filamentColor: string;

  // --- subtractive view ---
  stock: StockDef | null;
  gridRes: number;
  tool: ToolDef;
  opIndex: number;
  /** Colour of the carved stock/workpiece material. */
  stockColor: string;
  /** Bumped when stock is edited by dragging in the 3D view, so the leva
   *  stock sliders re-seed once (on drag end) without rebuilding mid-drag. */
  stockEditNonce: number;
  /** True once the user has changed the stock manually (sliders or 3D drag).
   *  While false, loading a file auto-fits the stock to the work extremities. */
  stockUserEdited: boolean;
  /** Show the draggable stock-bounds box + handles in the subtractive view. */
  showStockEditor: boolean;

  // --- scene/view ---
  showGrid: boolean;
  showAxes: boolean;
  showStats: boolean;
  /** Show travel (non-printing) moves as hairlines. */
  showTravel: boolean;
  /** Show the selected model's bounding box. */
  showBounds: boolean;
  fitRequest: number;

  // --- actions: models ---
  beginParse: (name: string) => void;
  addModel: (fileName: string, doc: GcodeDoc) => void;
  removeModel: (id: string) => void;
  clearModels: () => void;
  selectModel: (id: string | null) => void;
  setModelPosition: (id: string, position: [number, number, number]) => void;
  setModelScale: (id: string, scale: number) => void;

  // --- actions: status ---
  setStatus: (s: Status) => void;
  setError: (msg: string | null) => void;
  setProgress: (p: number) => void;

  // --- actions: view config ---
  setModeOverride: (m: Mode | null) => void;
  setLayerRange: (r: [number, number]) => void;
  setColorBy: (c: AdditiveColorBy) => void;
  setRenderTubes: (v: boolean) => void;
  setExtrusionWidth: (v: number) => void;
  setFilamentColor: (c: string) => void;
  setStock: (s: StockDef | null) => void;
  /** Set stock as a deliberate USER edit (marks stockUserEdited). */
  editStock: (s: StockDef) => void;
  setGridRes: (n: number) => void;
  setTool: (t: ToolDef) => void;
  setOpIndex: (n: number) => void;
  setStockColor: (c: string) => void;
  bumpStockEdit: () => void;
  setShowStockEditor: (v: boolean) => void;
  setShowGrid: (v: boolean) => void;
  setShowAxes: (v: boolean) => void;
  setShowStats: (v: boolean) => void;
  setShowTravel: (v: boolean) => void;
  setShowBounds: (v: boolean) => void;
  requestFit: () => void;
  reset: () => void;

  // --- derived ---
  activeModel: () => ModelEntry | null;
  effectiveMode: () => Mode | null;
  /** Max additive layer index across all loaded models. */
  maxLayer: () => number;
}

const DEFAULT_TOOL: ToolDef = { kind: 'flat', diameter: 3 };

// Deterministic id (no Math.random/Date in some sandboxes); monotonic counter.
let idCounter = 0;
const nextId = () => `m${++idCounter}`;

function pickActive(models: ModelEntry[], selectedId: string | null): ModelEntry | null {
  if (selectedId) {
    const m = models.find((x) => x.id === selectedId);
    if (m) return m;
  }
  return models[0] ?? null;
}

/** Largest additive layer INDEX across all loaded models (layerCount − 1). */
function computeMaxLayer(models: ModelEntry[]): number {
  return models.reduce(
    (mx, m) => Math.max(mx, m.doc.meta.layerCount ? m.doc.meta.layerCount - 1 : 0),
    0,
  );
}

export const useStore = create<AppState>((set, get) => ({
  models: [],
  selectedId: null,

  status: 'idle',
  error: null,
  progress: 0,

  modeOverride: null,

  layerRange: [0, 0],
  colorBy: 'realistic',
  renderTubes: true,
  extrusionWidth: 1.5,
  filamentColor: '#d9882f',

  stock: null,
  gridRes: 1024,
  tool: DEFAULT_TOOL,
  opIndex: -1,
  stockColor: '#b8b8c0',
  stockEditNonce: 0,
  stockUserEdited: false,
  showStockEditor: true,

  showGrid: true,
  showAxes: true,
  showStats: false,
  showTravel: true,
  showBounds: true,
  fitRequest: 0,

  beginParse: (_name) => set({ status: 'parsing', error: null, progress: 0 }),

  addModel: (fileName, doc) =>
    set((s) => {
      const id = nextId();
      // Stagger new models along +X (by model width + margin) so they don't
      // stack on top of each other; the user can then drag them anywhere.
      const width = doc.bbox.max[0] - doc.bbox.min[0];
      const offsetX = s.models.length * (width + 10);
      const model: ModelEntry = {
        id,
        fileName,
        doc,
        position: [offsetX, 0, 0],
        scale: 1,
      };
      const models = [...s.models, model];
      const maxLayer = computeMaxLayer(models);
      return {
        models,
        selectedId: id,
        status: 'ready',
        error: null,
        progress: 1,
        layerRange: [0, maxLayer],
        opIndex: -1,
        modeOverride: null,
        // Auto-fit the stock to the new file's extremities unless the user has
        // dialled in their own block (then keep it).
        stock: s.stockUserEdited ? s.stock : null,
        fitRequest: s.fitRequest + 1,
      };
    }),

  removeModel: (id) =>
    set((s) => {
      const models = s.models.filter((m) => m.id !== id);
      return {
        models,
        selectedId: s.selectedId === id ? (models[0]?.id ?? null) : s.selectedId,
        status: models.length ? s.status : 'idle',
      };
    }),

  clearModels: () =>
    set({ models: [], selectedId: null, status: 'idle', error: null, stock: null }),

  selectModel: (selectedId) => set({ selectedId }),

  setModelPosition: (id, position) =>
    set((s) => ({
      models: s.models.map((m) => (m.id === id ? { ...m, position } : m)),
    })),

  setModelScale: (id, scale) =>
    set((s) => ({
      models: s.models.map((m) => (m.id === id ? { ...m, scale } : m)),
    })),

  setStatus: (status) => set({ status }),
  setError: (error) => set((s) => ({ error, status: error ? 'error' : s.status })),
  setProgress: (progress) => set({ progress }),

  setModeOverride: (modeOverride) => set({ modeOverride }),
  setLayerRange: (layerRange) => set({ layerRange }),
  setColorBy: (colorBy) => set({ colorBy }),
  setRenderTubes: (renderTubes) => set({ renderTubes }),
  setExtrusionWidth: (extrusionWidth) => set({ extrusionWidth }),
  setFilamentColor: (filamentColor) => set({ filamentColor }),
  setStock: (stock) => set({ stock }),
  editStock: (stock) => set({ stock, stockUserEdited: true }),
  setGridRes: (gridRes) => set({ gridRes }),
  setTool: (tool) => set({ tool }),
  setOpIndex: (opIndex) => set({ opIndex }),
  setStockColor: (stockColor) => set({ stockColor }),
  bumpStockEdit: () => set((s) => ({ stockEditNonce: s.stockEditNonce + 1 })),
  setShowStockEditor: (showStockEditor) => set({ showStockEditor }),
  setShowGrid: (showGrid) => set({ showGrid }),
  setShowAxes: (showAxes) => set({ showAxes }),
  setShowStats: (showStats) => set({ showStats }),
  setShowTravel: (showTravel) => set({ showTravel }),
  setShowBounds: (showBounds) => set({ showBounds }),
  requestFit: () => set((s) => ({ fitRequest: s.fitRequest + 1 })),

  reset: () =>
    set({
      models: [],
      selectedId: null,
      status: 'idle',
      error: null,
      progress: 0,
      modeOverride: null,
      layerRange: [0, 0],
      opIndex: -1,
      stock: null,
      stockUserEdited: false,
    }),

  activeModel: () => pickActive(get().models, get().selectedId),

  effectiveMode: () => {
    const { modeOverride } = get();
    if (modeOverride) return modeOverride;
    return pickActive(get().models, get().selectedId)?.doc.mode ?? null;
  },

  maxLayer: () => computeMaxLayer(get().models),
}));

// --- selector helpers (stable references for useStore selectors) -----------

/** The active model's parsed doc (selected, else first), or null. */
export const activeDoc = (s: AppState): GcodeDoc | null =>
  pickActive(s.models, s.selectedId)?.doc ?? null;
