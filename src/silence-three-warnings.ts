// Suppress two known-benign Three.js console warnings. Imported first in
// main.tsx so the override is installed before any Three.js code runs.
//
//  1. "Multiple instances of Three.js being imported" — already addressed by
//     `resolve.dedupe: ['three']` in vite.config.ts; kept here belt-and-braces
//     in case a transitive dep ever reintroduces a second copy.
//  2. "THREE.Clock ... deprecated. Please use THREE.Timer instead." — emitted
//     from library internals (gcode-preview's render loop and @react-three/fiber
//     both construct a THREE.Clock on three@0.184). Not actionable from app code
//     and harmless; we filter the exact message rather than muting console.warn.
//
// The filter matches specific substrings only, so genuine warnings still surface.

const SUPPRESSED: string[] = [
  'Multiple instances of Three.js being imported',
  'THREE.Clock: This module has been deprecated',
];

const originalWarn = console.warn.bind(console);
console.warn = (...args: unknown[]) => {
  const first = args[0];
  if (typeof first === 'string' && SUPPRESSED.some((s) => first.includes(s))) return;
  originalWarn(...args);
};
