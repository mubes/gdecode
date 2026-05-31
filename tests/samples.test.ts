import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseGcode } from '../src/parse/parseGcode';

describe('sample files', () => {
  it('fdm-cube.gcode → additive', () => {
    const text = readFileSync(new URL('../samples/fdm-cube.gcode', import.meta.url), 'utf8');
    const doc = parseGcode(text);
    expect(doc.mode).toBe('additive');
    expect(doc.moves.length).toBeGreaterThan(10);
    expect(doc.meta.layerCount).toBeGreaterThan(5);
    console.log('FDM:', { mode: doc.mode, moves: doc.moves.length, layers: doc.meta.layerCount, units: doc.units, bbox: doc.bbox });
  });

  it('cnc-pocket.nc → subtractive', () => {
    const text = readFileSync(new URL('../samples/cnc-pocket.nc', import.meta.url), 'utf8');
    const doc = parseGcode(text);
    expect(doc.mode).toBe('subtractive');
    expect(doc.moves.length).toBeGreaterThan(10);
    const cuts = doc.moves.filter((m) => m.type === 'cut');
    expect(cuts.length).toBeGreaterThan(0);
    console.log('CNC:', { mode: doc.mode, moves: doc.moves.length, units: doc.units, bbox: doc.bbox });
  });
});
