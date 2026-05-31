// ---------------------------------------------------------------------------
// gdecode — shared, mode-independent intermediate representation (IR).
// One normalized representation feeds BOTH renderers (additive + subtractive),
// mode detection, and the info panel. This file is the contract every module
// builds against — change it deliberately.
// ---------------------------------------------------------------------------

export type Vec3 = [number, number, number];

export interface Box3 {
  min: Vec3;
  max: Vec3;
}

export type MoveType = 'rapid' | 'cut' | 'arcCW' | 'arcCCW';

/** A single normalized motion segment. Arcs keep their center so geometry-build
 *  can tessellate them; everything else consumes start→end line segments. */
export interface Move {
  type: MoveType;
  start: Vec3;
  end: Vec3;
  /** Arc center (absolute), derived from I/J/K. Present only for arcCW/arcCCW. */
  center?: Vec3;
  /** Feed rate (F). */
  feed?: number;
  /** ΔE for this move. >0 means deposition (additive). */
  extrude?: number;
  /** Spindle speed (S) — subtractive. */
  spindle?: number;
  /** Active tool index (T) — subtractive. */
  tool?: number;
  /** Source line number, for picking / scrubbing. */
  lineNo: number;
  /** Additive Z-band (layer index), assigned at parse time. */
  layer?: number;
}

/** Canonical IR predicate: a move deposits material (additive) when its E
 *  delta is positive. The single source of truth for "is this an extrusion". */
export function isExtruding(m: Move): boolean {
  return m.extrude !== undefined && m.extrude > 0;
}

export type Units = 'mm' | 'in';
export type Mode = 'additive' | 'subtractive';

export interface GcodeMeta {
  /** Slicer/post-processor name if detected from header comments. */
  generator?: string;
  /** Total source line count. */
  lineCount: number;
  /** Number of distinct additive layers (if additive). */
  layerCount?: number;
  /** Confidence + raw scores from mode detection. */
  detection?: ModeDetection;
  /** Tools referenced (T numbers) → optional diameter (mm) when known. */
  tools?: number[];
}

export interface GcodeDoc {
  moves: Move[];
  units: Units;
  bbox: Box3;
  /** Auto-detected mode (may be overridden by the user in the store). */
  mode: Mode;
  meta: GcodeMeta;
}

export interface ModeDetection {
  additiveScore: number;
  subtractiveScore: number;
  /** The auto-chosen mode (higher score). */
  mode: Mode;
  /** Human-readable signals that drove the decision. */
  reasons: string[];
}

// --- Geometry payloads passed back from workers as transferable buffers ------

/** Result of a subtractive carve: a height field H(x,y) over a regular grid. */
export interface HeightFieldPayload {
  /** Row-major H[y * nx + x], length nx*ny. Transferable. */
  heights: Float32Array;
  nx: number;
  ny: number;
  /** World-space stock footprint the grid spans. */
  origin: Vec3; // min corner (x,y,stockBottomZ)
  sizeX: number;
  sizeY: number;
  stockTopZ: number;
  stockBottomZ: number;
}

// --- Subtractive sim configuration ------------------------------------------

export type ToolKind = 'flat' | 'ball' | 'vbit';

export interface ToolDef {
  kind: ToolKind;
  /** Cutting diameter (mm). */
  diameter: number;
  /** Included angle for V-bits (degrees). */
  vAngle?: number;
}

export interface StockDef {
  /** Min corner of the stock box in world space. */
  origin: Vec3;
  sizeX: number;
  sizeY: number;
  sizeZ: number;
}
