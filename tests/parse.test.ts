import { describe, it, expect } from 'vitest';
import { parseGcode } from '../src/parse/parseGcode';
import { tessellateArc } from '../src/parse/arcs';
import type { Vec3 } from '../src/types';

describe('parseGcode — units', () => {
  it('reports mm under G21 and keeps coordinates in mm', () => {
    const doc = parseGcode(['G21', 'G90', 'G1 X10 Y0 F100'].join('\n'));
    expect(doc.units).toBe('mm');
    const m = doc.moves[doc.moves.length - 1];
    expect(m.end[0]).toBeCloseTo(10, 6);
  });

  it('reports inches under G20 but emits geometry converted to mm', () => {
    const doc = parseGcode(['G20', 'G90', 'G1 X1 Y0 F100'].join('\n'));
    expect(doc.units).toBe('in');
    const m = doc.moves[doc.moves.length - 1];
    // 1 inch == 25.4 mm
    expect(m.end[0]).toBeCloseTo(25.4, 6);
  });
});

describe('parseGcode — distance mode', () => {
  it('absolute (G90) moves to the given coordinate', () => {
    const doc = parseGcode(['G21', 'G90', 'G1 X10', 'G1 X15'].join('\n'));
    expect(doc.moves[1].end[0]).toBeCloseTo(15, 6);
  });

  it('relative (G91) accumulates offsets', () => {
    const doc = parseGcode(['G21', 'G91', 'G1 X10', 'G1 X5'].join('\n'));
    // 0 -> 10 -> 15
    expect(doc.moves[0].end[0]).toBeCloseTo(10, 6);
    expect(doc.moves[1].end[0]).toBeCloseTo(15, 6);
  });
});

describe('parseGcode — G92 offset', () => {
  it('G92 resets the work coordinate so subsequent moves are offset', () => {
    // Move to X10, then declare current X as 0; next absolute move to X5 lands
    // at world X=15 (10 + 5).
    const doc = parseGcode(['G21', 'G90', 'G1 X10', 'G92 X0', 'G1 X5'].join('\n'));
    const last = doc.moves[doc.moves.length - 1];
    expect(last.end[0]).toBeCloseTo(15, 6);
  });
});

describe('parseGcode — extrusion detection', () => {
  it('computes ΔE per move and marks deposition with positive extrude', () => {
    const doc = parseGcode(
      ['G21', 'G90', 'M82', 'G92 E0', 'G1 X10 E1 F1500', 'G1 X20 E2.5'].join('\n'),
    );
    const extruding = doc.moves.filter((m) => (m.extrude ?? 0) > 0);
    expect(extruding.length).toBe(2);
    expect(extruding[0].extrude).toBeCloseTo(1, 6);
    expect(extruding[1].extrude).toBeCloseTo(1.5, 6); // 2.5 - 1
    expect(doc.mode).toBe('additive');
  });

  it('treats a travel move (no E change) as non-extruding', () => {
    const doc = parseGcode(
      ['G21', 'G90', 'M82', 'G92 E0', 'G1 X10 E1', 'G0 X30', 'G1 X40 E2'].join('\n'),
    );
    const travel = doc.moves.find((m) => m.type === 'rapid');
    expect(travel).toBeTruthy();
    expect(travel?.extrude ?? 0).toBe(0);
  });

  it('assigns additive layers by ascending extruding Z', () => {
    const doc = parseGcode(
      [
        'G21',
        'G90',
        'M82',
        'G92 E0',
        'G1 Z0.2',
        'G1 X10 E1',
        'G1 X20 E2',
        'G1 Z0.4',
        'G1 X10 E3',
      ].join('\n'),
    );
    expect(doc.meta.layerCount).toBe(2);
    const lastExtrude = doc.moves.filter((m) => (m.extrude ?? 0) > 0).at(-1);
    expect(lastExtrude?.layer).toBe(1);
  });
});

describe('parseGcode — arc moves', () => {
  it('emits arcCW with an absolute center derived from I/J', () => {
    // From (10,0), I0 J10 -> center (10,10); CW quarter to (20,10).
    const doc = parseGcode(['G21', 'G90', 'G0 X10 Y0', 'G2 X20 Y10 I0 J10'].join('\n'));
    const arc = doc.moves.find((m) => m.type === 'arcCW');
    expect(arc).toBeTruthy();
    expect(arc?.center?.[0]).toBeCloseTo(10, 6);
    expect(arc?.center?.[1]).toBeCloseTo(10, 6);
    expect(arc?.start[0]).toBeCloseTo(10, 6);
    expect(arc?.end[0]).toBeCloseTo(20, 6);
    expect(arc?.end[1]).toBeCloseTo(10, 6);
  });

  it('emits arcCCW for G3', () => {
    const doc = parseGcode(['G21', 'G90', 'G0 X10 Y0', 'G3 X10 Y20 I0 J10'].join('\n'));
    expect(doc.moves.some((m) => m.type === 'arcCCW')).toBe(true);
  });
});

describe('tessellateArc', () => {
  const close = (a: Vec3, b: Vec3, eps = 1e-6) => {
    expect(a[0]).toBeCloseTo(b[0], 5);
    expect(a[1]).toBeCloseTo(b[1], 5);
    expect(a[2]).toBeCloseTo(b[2], 5);
    void eps;
  };

  it('hits both endpoints exactly', () => {
    const start: Vec3 = [10, 0, 0];
    const end: Vec3 = [0, 10, 0];
    const center: Vec3 = [0, 0, 0];
    const pts = tessellateArc(start, end, center, false, 16);
    expect(pts.length).toBe(17);
    close(pts[0], start);
    close(pts[pts.length - 1], end);
  });

  it('keeps every point on the circle radius', () => {
    const center: Vec3 = [0, 0, 0];
    const r = 10;
    const start: Vec3 = [r, 0, 0];
    const end: Vec3 = [0, r, 0];
    const pts = tessellateArc(start, end, center, false, 32);
    for (const p of pts) {
      expect(Math.hypot(p[0] - center[0], p[1] - center[1])).toBeCloseTo(r, 4);
    }
  });

  it('CCW quarter arc has a positive-angle midpoint', () => {
    const center: Vec3 = [0, 0, 0];
    const pts = tessellateArc([10, 0, 0], [0, 10, 0], center, false, 2);
    // Midpoint of a CCW quarter from +X to +Y is at 45° → (r/√2, r/√2).
    close(pts[1], [10 / Math.SQRT2, 10 / Math.SQRT2, 0]);
  });

  it('CW quarter arc goes the other way', () => {
    const center: Vec3 = [0, 0, 0];
    // CW from +X to +Y is the long way (270°); midpoint at 135° relative.
    const ccw = tessellateArc([10, 0, 0], [0, 10, 0], center, false, 2)[1];
    const cw = tessellateArc([10, 0, 0], [0, 10, 0], center, true, 2)[1];
    expect(cw[0]).not.toBeCloseTo(ccw[0], 2);
  });

  it('handles a full circle (coincident endpoints)', () => {
    const center: Vec3 = [0, 0, 0];
    const start: Vec3 = [10, 0, 0];
    const pts = tessellateArc(start, start, center, false, 36);
    expect(pts.length).toBe(37);
    // Quarter-way around a full CCW circle should be near (0, 10).
    const q = pts[9];
    expect(q[0]).toBeCloseTo(0, 4);
    expect(q[1]).toBeCloseTo(10, 4);
  });

  it('interpolates Z for a helix', () => {
    const pts = tessellateArc([10, 0, 0], [0, 10, 5], [0, 0, 0], false, 4);
    expect(pts[0][2]).toBeCloseTo(0, 6);
    expect(pts[pts.length - 1][2]).toBeCloseTo(5, 6);
    expect(pts[2][2]).toBeCloseTo(2.5, 6); // halfway
  });

  it('derives segment count from chord tolerance', () => {
    const tight = tessellateArc([10, 0, 0], [0, 10, 0], [0, 0, 0], false, 0.01);
    const loose = tessellateArc([10, 0, 0], [0, 10, 0], [0, 0, 0], false, 0.5);
    expect(tight.length).toBeGreaterThan(loose.length);
  });
});
