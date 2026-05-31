# gdecode — browser G-code → 3D artifact viewer

## Context

`gdecode` is a new, empty project. The goal: a web app where you **drag-and-drop a G-code file** and it is processed into the **artifact the machine would make** — either an **additive** (FDM 3D-print) deposition or a **subtractive** (CNC-milled) part carved from stock — then rendered in the browser so you can **freely orbit/pan/zoom** around it.

Decisions confirmed with the user:
- **Subtractive = full material-removal simulation** (carve a stock block into the real machined shape), not just toolpath lines.
- **Build additive first** (more tractable, shares the parser, fast visible result), then subtractive.
- **Client-side only** — a static SPA, no backend (privacy, trivially deployable to any static host).
- **Prefer libraries to new code** — write custom code only where no good library exists (the material-removal sim).

The only genuinely custom subsystem is the CNC material-removal sim: research confirms there is **no** drop-in JS/WebGL library for it; the field uses **dexel/height-map** (fast, accurate, *3-axis only*) and **voxel** (general, heavier) techniques. Everything else (parsing, FDM preview, scene, navigation, CSG/meshing helpers) has a mature library.

## Stack

- **Vite + TypeScript** — build/dev + types (the parser state machine and sim grids benefit strongly from types).
- **React + @react-three/fiber (R3F) + @react-three/drei** — UI shell + Three.js scene host + ready-made navigation/helpers (`OrbitControls`, `Bounds`/`useBounds` fit-to-frame, `Grid`, `GizmoHelper`+`GizmoViewcube`, `Stats`).
- **Three.js** — renderer; heavy geometry built imperatively as `BufferGeometry` and hosted in the R3F scene.
- **zustand** — small global store (file, mode, layer/playback range, sim params, view toggles).
- **Web Workers + Comlink** — parsing, geometry build, and carving run off the main thread; results passed back as transferable `ArrayBuffer`s.

Library-per-concern (prefer libraries):
| Concern | Library |
|---|---|
| Drag/drop + browse + validation | `react-dropzone` |
| G-code parse / motion incl. G2/G3 arcs, units, abs/rel | `gcode-parser` + `gcode-toolpath` (cncjs) |
| Additive (FDM) preview | `gcode-preview` (TS, Three.js; layers, travel/extrude color, tubes, arcs) |
| Subtractive meshing / boolean (later/fidelity) | `three-bvh-csg` (on `three-mesh-bvh`); marching-cubes via `isosurface` or three `MarchingCubes` |
| Control panel GUI | `leva` |
| Unit tests | `vitest`; optional E2E `@playwright/test` |

## Shared core — normalized IR

One mode-independent intermediate representation feeds both renderers, mode detection, and the info panel:

```ts
type MoveType = 'rapid' | 'cut' | 'arcCW' | 'arcCCW';
interface Move {
  type: MoveType;
  start: Vec3; end: Vec3; center?: Vec3;   // center from I/J/K for arcs
  feed?: number; extrude?: number;          // ΔE>0 = deposition (additive)
  spindle?: number; tool?: number;          // S / T (subtractive)
  lineNo: number; layer?: number;           // source line (picking); Z-band (additive)
}
interface GcodeDoc { moves: Move[]; units:'mm'|'in'; bbox: Box3; mode:'additive'|'subtractive'; meta: {...} }
```

Arcs (G2/G3) are tessellated to polylines at geometry-build time so both renderers consume line segments.

**Mode auto-detection** (`detectMode.ts`) — score the parsed stream, expose a manual override toggle:
- *Additive*: any `G1…E`, `M104/109/140/190` (temps), `M106` (fan), slicer headers (`;LAYER:`, `;TYPE:`, PrusaSlicer/Cura), `G29`.
- *Subtractive*: `M3/M4/M5`+`S` (spindle), `M6`/`T` changes, `G20` inches, coolant `M7/8/9`, work offsets `G54–G59`, `G43`, no `E`.

## Scene & navigation (shared)

- **Z-up** scene (CAM/printer convention) — set `camera.up=+Z`, orient grid accordingly.
- drei `OrbitControls` (orbit/pan/zoom + damping); `Bounds` auto-fit on load + a **Fit/Reset view** button; `Grid` sized to bed/stock; `GizmoViewcube` for snap-to-top/front/iso; `Stats` toggle.
- Optional clipping plane for cross-sections (v1.1).

## Phase plan

**Phase 0 — Scaffold.** Vite+TS+React+R3F+drei+zustand. Base scene (grid, axes, OrbitControls, gizmo, fit-to-view), empty drop zone, static-host build config. *Done when:* app runs, you can orbit an empty bed.

**Phase 1 — Ingest & parse (shared core).** `react-dropzone` (accept `.gcode/.nc/.tap/.ngc/.cnc/.g`) → `parse.worker.ts` (gcode-parser/gcode-toolpath) → IR + metadata; `detectMode.ts` + override; file-info panel; parse-error toasts. *Done when:* dropping a file shows correct mode, bounds, units, move count.

**Phase 2 — Additive renderer (FIRST).** Use **`gcode-preview`** for the FDM view (library-first: it already does extrusion lines, travel vs extrude color, layer range, tube geometry, arcs). Wire controls into our panel: **layer-range slider**, color-by (travel/feature/feedrate/layer), **line ↔ tube** toggle. *Fallback only if a single shared camera with Phase 3 becomes essential:* rebuild lines from our IR as drei/three `Line2` fat-lines in the R3F scene. *Done when:* an FDM file renders as the printed shape, layers scrub, navigation is smooth on a large file.

**Phase 3 — Subtractive: full material-removal sim (headline).** 3-axis **height-map (single-Z dexel)** carve:
1. **Stock**: default = toolpath XY bbox + margin, Z from stock-top down; user-editable dims/origin; drawn as a box.
2. **Height field** `H(x,y)` over a grid (default 1024², configurable), init to stock-top.
3. **Carve**: for each cut/arc (spindle on), sweep the **tool profile** (flat / ball / V, diameter from tool table or user input) along the segment; set `H` to `min(H, tool-bottom Z)` across the swept footprint. **CPU carve in worker first** (deterministic, correct); then move the hot path to a **GPU min-blend** pass (render tool sweeps into a float framebuffer, keep the lowest surface) for speed.
4. **Display**: render `H` as a **displaced grid mesh** (vertex shader samples the height texture) + skirt walls + bottom = a navigable solid machined part; normals from the height texture for shading.
5. **Playback**: "scrub to operation N" scrubber (same slider UI as layers, over move index).
- *Stated limitation:* one height-map ⇒ no undercuts/side-undercuts (correct for true 3-axis); 4/5-axis or undercuts need multi-dexel/voxel (Phase 5). *Done when:* a 3-axis CNC file carves a stock block into the expected part with a progress bar and you can orbit it.

**Phase 4 — Polish & perf.** `leva` control panel, `Stats`, large-file handling (chunked parse, optional decimation with a visible notice — never silent truncation), dispose-on-reload, view presets, cross-section clip. Tests + committed sample files. Deploy to static host.

**Phase 5 — Stretch / higher fidelity.** Voxel grid + marching-cubes (`isosurface`/three `MarchingCubes`) or `three-bvh-csg` boolean for undercuts; per-feature coloring; print/machining time estimate; measurement tools.

## Proposed file layout

```
src/
  main.tsx  App.tsx  store.ts  types.ts
  ingest/DropZone.tsx
  parse/{parse.worker.ts, detectMode.ts, arcs.ts}
  scene/{Viewer.tsx, Helpers.tsx}            # Canvas, OrbitControls, Grid, Gizmo, Bounds
  additive/{AdditiveModel.tsx, layers.ts}    # wraps gcode-preview (or IR fat-lines)
  subtractive/{heightmap.worker.ts, carveGpu.ts, Stock.ts, tools.ts, SubtractiveModel.tsx}
  ui/{ControlPanel.tsx, FileInfo.tsx}
  workers/comlink.ts
samples/{fdm-cube.gcode, cnc-pocket.nc}
tests/{parse.test.ts, detectMode.test.ts}
```

## Cross-cutting: performance

- Parse/build/carve in workers; pass geometry as transferable buffers → wrap in `BufferGeometry`; height field as transferable `Float32Array` → `DataTexture`.
- One merged geometry with per-vertex color, not thousands of objects; fat-line material for thickness; instancing for tubes.
- Multi-million-segment FDM files: chunked parse + optional decimation **with an on-screen notice**.

## Verification

- **Unit (`vitest`)**: IR correctness — units (G20/G21), abs/rel (G90/G91), G92 offset, G2/G3 arc interpolation; `detectMode` scoring — against small fixture snippets in `tests/`.
- **Samples**: commit one small FDM file (Cura/Prusa) and one small 3-axis GRBL CNC file under `samples/`.
- **Manual E2E**: `npm run dev`; drag each sample →
  - FDM: auto-detected additive; renders printed shape; layer slider peels layers; orbit/pan/zoom + Fit work.
  - CNC: auto-detected subtractive; stock carves to expected part; playback scrubs; navigation works.
  - Override toggle flips modes; bad file shows an error toast.
- **Perf sanity**: a large FDM file (fine-layer Benchy) loads and navigates at interactive FPS.
- **Optional E2E (`playwright`)**: drop each sample, assert canvas renders, mode detected, slider changes geometry.

## Open risk / note

The one place "prefer libraries" competes with a unified app: Phase 2 uses `gcode-preview` (its own scene/controls), while Phase 3 is custom in our R3F scene. Recommended: ship the library-based additive view first; only unify both into one R3F camera (IR-driven fat-lines) if inconsistent navigation between modes proves annoying in practice.
