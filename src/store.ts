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
  /** Subtractive operation scrubber position for THIS file (-1 = all moves).
   *  Recorded per model so switching files preserves each one's step. */
  opIndex: number;
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
  /** Filament colors for the realistic "as printed" view, one per tool
   *  (T0..T3 → index 0..3). Beads are colored by their move's tool. */
  filamentColors: [string, string, string, string];

  // --- subtractive view ---
  stock: StockDef | null;
  gridRes: number;
  tool: ToolDef;
  /** Colour of the carved stock/workpiece material. */
  stockColor: string;
  /** True once the user has changed the stock manually (3D face drag).
   *  While false, loading a file auto-fits the stock to the work extremities. */
  stockUserEdited: boolean;
  /** True while a stock face is being dragged. The carve is deferred until this
   *  clears (drag end) so the expensive recompute runs once, not per frame. */
  stockDragging: boolean;
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
  /** Set the filament color for one tool slot (0..3). */
  setFilamentColor: (index: number, c: string) => void;
  setStock: (s: StockDef | null) => void;
  /** Set stock as a deliberate USER edit (marks stockUserEdited). */
  editStock: (s: StockDef) => void;
  setGridRes: (n: number) => void;
  setTool: (t: ToolDef) => void;
  /** Set the operation scrubber for the active (selected) model. */
  setOpIndex: (n: number) => void;
  setStockColor: (c: string) => void;
  setStockDragging: (v: boolean) => void;
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
  /** The active (selected) model's operation scrubber position (-1 if none). */
  activeOpIndex: () => number;
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
  filamentColors: ['#d9882f', '#4fa3ff', '#39d98a', '#ff6b6b'],

  stock: null,
  gridRes: 1024,
  tool: DEFAULT_TOOL,
  stockColor: '#b8b8c0',
  stockUserEdited: false,
  stockDragging: false,
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
        opIndex: -1,
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
  setFilamentColor: (index, c) =>
    set((s) => {
      const filamentColors = [...s.filamentColors] as [string, string, string, string];
      if (index >= 0 && index < filamentColors.length) filamentColors[index] = c;
      return { filamentColors };
    }),
  setStock: (stock) => set({ stock }),
  editStock: (stock) => set({ stock, stockUserEdited: true }),
  setGridRes: (gridRes) => set({ gridRes }),
  setTool: (tool) => set({ tool }),
  // Operation scrubber is per-model: write it onto the active model.
  setOpIndex: (opIndex) =>
    set((s) => {
      const id = s.selectedId ?? s.models[0]?.id ?? null;
      if (!id) return {};
      return { models: s.models.map((m) => (m.id === id ? { ...m, opIndex } : m)) };
    }),
  setStockColor: (stockColor) => set({ stockColor }),
  setStockDragging: (stockDragging) => set({ stockDragging }),
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
      stock: null,
      stockUserEdited: false,
    }),

  activeModel: () => pickActive(get().models, get().selectedId),

  activeOpIndex: () => pickActive(get().models, get().selectedId)?.opIndex ?? -1,

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
