// ---------------------------------------------------------------------------
// gdecode — additive geometry builder (pure, framework-free, testable).
//
// Turns a parsed GcodeDoc into flat position/color buffers for line rendering
// in the R3F scene. Extrusion moves within the active layer range become line
// segments; their color depends on the chosen `colorBy` scheme. 'moveType' also
// includes travel (rapid) moves so non-printing motion is visible.
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import { isExtruding, type GcodeDoc, type Move } from '../types';
import type { AdditiveColorBy } from '../store';

export interface LineBuffers {
  positions: Float32Array; // xyz per vertex, 2 vertices per segment
  colors: Float32Array; // rgb per vertex
  segmentCount: number;
}

const EXTRUDE = '#4fa3ff';
const TRAVEL = '#39d98a';

/** Tool palette (T0..T7) as hex — the single source of truth shared with the
 *  legend UI (ColorLegend) so swatches and geometry colors never diverge. */
export const TOOL_PALETTE_HEX = [
  '#4fa3ff',
  '#ff6b6b',
  '#39d98a',
  '#ffd166',
  '#b980f0',
  '#4dd0e1',
  '#ff9f43',
  '#e0e0e0',
] as const;

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** Float-RGB form of TOOL_PALETTE_HEX, for vertex colors. */
const TOOL_PALETTE: [number, number, number][] = TOOL_PALETTE_HEX.map(hexToRgb);

/** Normalize a possibly-reversed [lo, hi] layer range to ascending order. */
function normalizeLayerRange([a, b]: [number, number]): [number, number] {
  return a <= b ? [a, b] : [b, a];
}

/** Map t∈[0,1] to a blue→cyan→green→yellow→red gradient (turbo-ish). */
export function gradient(t: number): [number, number, number] {
  const x = Math.min(1, Math.max(0, t));
  // Piecewise hue sweep 240°(blue) → 0°(red).
  const h = (1 - x) * 240; // degrees
  return hslToRgb(h / 360, 0.85, 0.55);
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hk = (n: number) => {
    let t = h + n;
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [hk(1 / 3), hk(0), hk(-1 / 3)];
}

function moveColor(
  m: Move,
  colorBy: AdditiveColorBy,
  maxLayer: number,
  feedMin: number,
  feedMax: number,
  isTravel: boolean,
): [number, number, number] {
  if (isTravel) return hexToRgb(TRAVEL);
  switch (colorBy) {
    case 'layer':
      return gradient(maxLayer > 0 ? (m.layer ?? 0) / maxLayer : 0);
    case 'feedrate': {
      const f = m.feed ?? feedMin;
      const t = feedMax > feedMin ? (f - feedMin) / (feedMax - feedMin) : 0;
      return gradient(t);
    }
    case 'tool':
      return TOOL_PALETTE[(m.tool ?? 0) % TOOL_PALETTE.length];
    default:
      return hexToRgb(EXTRUDE);
  }
}

/** Build line-segment buffers for one model's additive view. */
export function buildLineBuffers(
  doc: GcodeDoc,
  layerRange: [number, number],
  colorBy: AdditiveColorBy,
): LineBuffers {
  const [lo, hi] = normalizeLayerRange(layerRange);
  const maxLayer = doc.meta.layerCount ? doc.meta.layerCount - 1 : 0;

  // Feed range for 'feedrate' coloring.
  let feedMin = Infinity;
  let feedMax = -Infinity;
  if (colorBy === 'feedrate') {
    for (const m of doc.moves) {
      if (isExtruding(m) && m.feed !== undefined) {
        if (m.feed < feedMin) feedMin = m.feed;
        if (m.feed > feedMax) feedMax = m.feed;
      }
    }
    if (!isFinite(feedMin)) {
      feedMin = 0;
      feedMax = 1;
    }
  }

  // Extrusion-only. Travel/non-printing moves are rendered separately as
  // always-on hairlines (see buildTravelBuffers).
  const verts: number[] = [];
  const cols: number[] = [];

  for (const m of doc.moves) {
    if (!isExtruding(m)) continue;
    const layer = m.layer ?? 0;
    if (layer < lo || layer > hi) continue;

    const c = moveColor(m, colorBy, maxLayer, feedMin, feedMax, false);
    verts.push(m.start[0], m.start[1], m.start[2], m.end[0], m.end[1], m.end[2]);
    cols.push(c[0], c[1], c[2], c[0], c[1], c[2]);
  }

  return {
    positions: new Float32Array(verts),
    colors: new Float32Array(cols),
    segmentCount: verts.length / 6,
  };
}

/** Travel (non-extruding) move segments within the layer range, as positions
 *  for a hairline LineSegments. These show the toolpath in every view mode. */
export function buildTravelBuffers(doc: GcodeDoc, layerRange: [number, number]): Float32Array {
  const [lo, hi] = normalizeLayerRange(layerRange);
  const verts: number[] = [];
  for (const m of doc.moves) {
    if (isExtruding(m)) continue;
    if (m.type !== 'rapid' && m.type !== 'cut' && m.type !== 'arcCW' && m.type !== 'arcCCW') continue;
    const layer = m.layer ?? 0;
    if (layer < lo || layer > hi) continue;
    verts.push(m.start[0], m.start[1], m.start[2], m.end[0], m.end[1], m.end[2]);
  }
  return new Float32Array(verts);
}

export interface InstanceData {
  /** 16 floats (column-major Matrix4) per extrusion bead. */
  matrices: Float32Array;
  count: number;
}

/**
 * Realistic "as printed" geometry: one oriented box (bead) per extrusion move,
 * sized width × height in cross-section. Rendered as a lit InstancedMesh so the
 * print reads as a shaded solid object rather than a diagnostic colormap.
 */
export function buildInstanceMatrices(
  doc: GcodeDoc,
  layerRange: [number, number],
  width: number,
  height: number,
): InstanceData {
  const [lo, hi] = normalizeLayerRange(layerRange);

  const m = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scl = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const xAxis = new THREE.Vector3(1, 0, 0);

  const out: number[] = [];
  for (const mv of doc.moves) {
    if (!isExtruding(mv)) continue;
    const layer = mv.layer ?? 0;
    if (layer < lo || layer > hi) continue;
    a.set(mv.start[0], mv.start[1], mv.start[2]);
    b.set(mv.end[0], mv.end[1], mv.end[2]);
    const len = a.distanceTo(b);
    if (len < 1e-6) continue;
    dir.subVectors(b, a).normalize();
    quat.setFromUnitVectors(xAxis, dir);
    pos.addVectors(a, b).multiplyScalar(0.5);
    // Box local X = bead length; slightly overlong so adjacent beads join.
    scl.set(len + width * 0.5, width, height);
    m.compose(pos, quat, scl);
    for (let i = 0; i < 16; i++) out.push(m.elements[i]);
  }
  return { matrices: new Float32Array(out), count: out.length / 16 };
}
