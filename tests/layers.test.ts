import { describe, it, expect } from 'vitest';
import { buildLineBuffers, buildTravelBuffers, gradient } from '../src/additive/buildGeometry';
import type { GcodeDoc, Move } from '../src/types';

function move(layer: number, extrude: number, z = layer * 0.2): Move {
  return {
    type: 'cut',
    start: [0, 0, z],
    end: [1, 0, z],
    extrude,
    feed: 1000,
    lineNo: layer,
    layer,
  };
}

function doc(moves: Move[], layerCount: number): GcodeDoc {
  return {
    moves,
    units: 'mm',
    bbox: { min: [0, 0, 0], max: [1, 0, layerCount * 0.2] },
    mode: 'additive',
    meta: { lineCount: moves.length, layerCount },
  };
}

describe('buildLineBuffers (Z-range subset)', () => {
  const d = doc(
    [move(0, 1), move(1, 1), move(2, 1), move(3, 1), move(4, 1)],
    5,
  );

  it('emits one segment (2 verts × 3) per extruding move in range', () => {
    const b = buildLineBuffers(d, [0, 4], 'layer');
    expect(b.segmentCount).toBe(5);
    expect(b.positions.length).toBe(5 * 6);
    expect(b.colors.length).toBe(5 * 6);
  });

  it('filters to the requested layer subset', () => {
    const b = buildLineBuffers(d, [1, 2], 'layer');
    expect(b.segmentCount).toBe(2);
  });

  it('normalizes a reversed range', () => {
    expect(buildLineBuffers(d, [3, 1], 'layer').segmentCount).toEqual(
      buildLineBuffers(d, [1, 3], 'layer').segmentCount,
    );
  });

  it('always excludes non-extruding (travel) moves', () => {
    const withTravel = doc([move(0, 1), move(1, 0), move(2, 1)], 3);
    expect(buildLineBuffers(withTravel, [0, 2], 'layer').segmentCount).toBe(2); // extrudes only
  });
});

describe('buildTravelBuffers', () => {
  it('collects only non-extruding moves in the layer range', () => {
    const d = doc([move(0, 1), move(1, 0), move(2, 1), move(3, 0)], 4);
    expect(buildTravelBuffers(d, [0, 3]).length / 6).toBe(2); // the two travel moves
    expect(buildTravelBuffers(d, [0, 1]).length / 6).toBe(1); // only the layer-1 travel
  });
});

describe('gradient', () => {
  it('clamps and returns rgb in [0,1]', () => {
    for (const t of [-1, 0, 0.5, 1, 2]) {
      const [r, g, b] = gradient(t);
      for (const c of [r, g, b]) expect(c).toBeGreaterThanOrEqual(0);
      for (const c of [r, g, b]) expect(c).toBeLessThanOrEqual(1);
    }
  });
  it('low t is bluer, high t is redder', () => {
    const lo = gradient(0);
    const hi = gradient(1);
    expect(lo[2]).toBeGreaterThan(lo[0]); // blue dominant at t=0
    expect(hi[0]).toBeGreaterThan(hi[2]); // red dominant at t=1
  });
});
