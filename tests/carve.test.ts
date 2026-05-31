import { describe, it, expect } from 'vitest';
import { carveHeightField } from '../src/subtractive/carve.ts';
import { computeDefaultStock } from '../src/subtractive/Stock.ts';
import { toolProfile } from '../src/subtractive/tools.ts';
import type { Move, StockDef, ToolDef } from '../src/types.ts';

describe('toolProfile', () => {
  it('flat: zero inside radius, +Inf outside', () => {
    const p = toolProfile({ kind: 'flat', diameter: 4 });
    expect(p.radius).toBe(2);
    expect(p.bottomOffset(0)).toBe(0);
    expect(p.bottomOffset(2)).toBe(0);
    expect(p.bottomOffset(2.0001)).toBe(Infinity);
  });

  it('ball: rises from 0 at center to R at rim', () => {
    const p = toolProfile({ kind: 'ball', diameter: 4 }); // R=2
    expect(p.bottomOffset(0)).toBeCloseTo(0, 6);
    expect(p.bottomOffset(2)).toBeCloseTo(2, 6); // R - 0
    expect(p.bottomOffset(Math.SQRT2)).toBeCloseTo(2 - Math.sqrt(2), 6);
  });

  it('vbit: linear cone, 90deg included => slope 1', () => {
    const p = toolProfile({ kind: 'vbit', diameter: 4, vAngle: 90 });
    // half-angle 45deg, tan=1 => offset == r
    expect(p.bottomOffset(0)).toBeCloseTo(0, 6);
    expect(p.bottomOffset(1)).toBeCloseTo(1, 6);
    expect(p.bottomOffset(2)).toBeCloseTo(2, 6);
  });
});

describe('computeDefaultStock', () => {
  it('expands XY by margin and spans Z range', () => {
    const s = computeDefaultStock(
      { min: [0, 0, -5], max: [10, 20, 0] },
      1,
    );
    expect(s.origin).toEqual([-1, -1, -5]);
    expect(s.sizeX).toBe(12);
    expect(s.sizeY).toBe(22);
    expect(s.sizeZ).toBe(5);
  });

  it('uses fallback thickness for flat Z range', () => {
    const s = computeDefaultStock({ min: [0, 0, 0], max: [10, 10, 0] }, 0);
    expect(s.sizeZ).toBe(10);
    expect(s.origin[2]).toBe(-10);
  });
});

describe('carveHeightField', () => {
  const stock: StockDef = { origin: [0, 0, -5], sizeX: 10, sizeY: 10, sizeZ: 5 };
  const flat: ToolDef = { kind: 'flat', diameter: 2 };

  it('initialises to stock top and leaves untouched cells alone', () => {
    const hf = carveHeightField([], stock, flat, 50, -1);
    expect(hf.stockTopZ).toBe(0);
    expect(hf.stockBottomZ).toBe(-5);
    // every cell still at the top
    let allTop = true;
    for (let i = 0; i < hf.heights.length; i++) {
      if (hf.heights[i] !== 0) allTop = false;
    }
    expect(allTop).toBe(true);
  });

  it('lowers H along a straight cut at the cut depth', () => {
    const moves: Move[] = [
      { type: 'cut', start: [1, 5, -2], end: [9, 5, -2], lineNo: 1 },
    ];
    const hf = carveHeightField(moves, stock, flat, 100, -1);
    // A cell on the path centerline should be cut to ~-2.
    const dx = hf.sizeX / hf.nx;
    const dy = hf.sizeY / hf.ny;
    const cx = Math.floor((5 - hf.origin[0]) / dx);
    const cy = Math.floor((5 - hf.origin[1]) / dy);
    const onPath = hf.heights[cy * hf.nx + cx];
    expect(onPath).toBeCloseTo(-2, 1);

    // A corner cell far from the path stays at the top.
    expect(hf.heights[0]).toBe(0);
  });

  it('respects opIndex scrubbing', () => {
    const moves: Move[] = [
      { type: 'cut', start: [1, 3, -2], end: [9, 3, -2], lineNo: 1 },
      { type: 'cut', start: [1, 7, -3], end: [9, 7, -3], lineNo: 2 },
    ];
    const dx = stock.sizeX / 100;
    const dy = stock.sizeY / 100;
    const sampleAt = (x: number, y: number, hf: ReturnType<typeof carveHeightField>) => {
      const cx = Math.floor((x - hf.origin[0]) / (hf.sizeX / hf.nx));
      const cy = Math.floor((y - hf.origin[1]) / (hf.sizeY / hf.ny));
      return hf.heights[cy * hf.nx + cx];
    };
    void dx; void dy;
    const only0 = carveHeightField(moves, stock, flat, 100, 0);
    // second cut not applied yet -> still top at y=7
    expect(sampleAt(5, 7, only0)).toBe(0);
    expect(sampleAt(5, 3, only0)).toBeCloseTo(-2, 1);

    const all = carveHeightField(moves, stock, flat, 100, -1);
    expect(sampleAt(5, 7, all)).toBeCloseTo(-3, 1);
  });

  it('reports progress ending at 1', () => {
    const moves: Move[] = [
      { type: 'cut', start: [1, 5, -2], end: [9, 5, -2], lineNo: 1 },
    ];
    let last = 0;
    carveHeightField(moves, stock, flat, 50, -1, (f) => {
      last = f;
    });
    expect(last).toBe(1);
  });

  it('ignores rapids and spindle-off moves', () => {
    const moves: Move[] = [
      { type: 'rapid', start: [1, 5, -2], end: [9, 5, -2], lineNo: 1 },
      { type: 'cut', start: [1, 5, -2], end: [9, 5, -2], spindle: 0, lineNo: 2 },
    ];
    const hf = carveHeightField(moves, stock, flat, 50, -1);
    let allTop = true;
    for (let i = 0; i < hf.heights.length; i++) if (hf.heights[i] !== 0) allTop = false;
    expect(allTop).toBe(true);
  });
});
