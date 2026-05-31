# gdecode — browser G‑code → 3D artifact viewer

Drag‑and‑drop a G‑code file and `gdecode` renders the **artifact the machine would make** — either an **additive** (FDM 3D‑print) deposition or a **subtractive** (CNC‑milled) part carved from a stock block — then lets you freely orbit, pan, and zoom around it.

It runs **entirely client‑side**: a static single‑page app, no backend. Your files never leave the browser, and the build drops onto any static host.

> See [`PLAN.md`](./PLAN.md) for the full design rationale and phase plan.

## Features

- **Drag‑and‑drop ingest** (`.gcode`, `.nc`, `.tap`, `.ngc`, `.cnc`, `.g`) with click‑to‑browse and parse‑error toasts.
- **Automatic mode detection** — scores extrusion vs. spindle/tool signals to pick additive or subtractive, with a manual override.
- **Additive (FDM) view** — renders the print from the parsed toolpath:
  - *as printed* (lit solid beads in a chosen filament color), or diagnostic colormaps by **layer**, **feed rate**, or **tool**;
  - a vertical **Z‑layer range slider** to peel layers;
  - line ↔ solid (world‑unit tube) toggle and always‑on travel‑move hairlines;
  - **multiple models** on one build plate — each selectable, draggable on the XY plane, and scalable.
- **Subtractive (CNC) view** — a true **3‑axis height‑map material‑removal simulation**: a stock block is carved into the real machined surface (flat / ball / V‑bit tools), with an **operation scrubber** and a progress bar. The stock bounds are editable both from the panel sliders and by **dragging the stock's faces directly in the 3D view**, and the workpiece colour is configurable.
- **Shared Z‑up scene** — one camera, grid, axes, view‑cube gizmo, fit‑to‑frame, and an FPS overlay across both modes.

## Stack

- **Vite + TypeScript**, **React 19**
- **@react-three/fiber** + **@react-three/drei** over **Three.js** for the scene
- **zustand** for app state, **leva** for the control panel
- **Web Workers + Comlink** — parsing and carving run off the main thread; the carved height field is handed back as a transferable `ArrayBuffer`
- **gcode-toolpath** (cncjs) for motion/arc/units resolution; tokenizing is inlined (browser‑safe, see below)
- **vitest** for unit tests

## Quick start

```bash
npm install
npm run dev        # serves on http://localhost:5219
```

Drop one of the bundled files from [`samples/`](./samples) (`fdm-cube.gcode`, `cnc-pocket.nc`) onto the window.

### Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Vite dev server on port **5219** (frees the port first). |
| `npm run build` | Type‑check (`tsc --noEmit`) then production build to `dist/`. |
| `npm run preview` | Serve the production build locally. |
| `npm run typecheck` | Type‑check only. |
| `npm run test` | Run the vitest unit suite. |

## Deploying

`vite.config.ts` sets `base: './'`, so built asset URLs are relative — copy `dist/` to any static host (GitHub Pages, S3, a subfolder) with no path rewrites.

## Project layout

```
src/
  main.tsx  App.tsx  store.ts  types.ts     # entry, shell, zustand store, IR contract
  ingest/DropZone.tsx                        # drag/drop + parse-worker dispatch
  parse/
    parseGcode.ts   detectMode.ts  arcs.ts   # pure parse core, mode scoring, arc math
    parse.worker.ts gcode-libs.d.ts          # worker wrapper, ambient lib types
  additive/
    AdditiveModel.tsx  buildGeometry.ts      # R3F renderer + pure geometry builder
  subtractive/
    carve.ts  tools.ts  Stock.ts             # pure carve core, tool profiles, default stock
    heightmap.worker.ts  carveGpu.ts         # carve worker; documented GPU seam (future)
    SubtractiveModel.tsx                      # R3F renderer + mesh builder
  scene/{Viewer.tsx, Helpers.tsx}            # shared Canvas, controls, grid, gizmo, fit
  ui/{ControlPanel,FileInfo,LayerSlider,StatsOverlay,ColorLegend}.tsx
  shims/{stream,events,timers,fs}.ts         # browser stubs for Node builtins (see below)
  workers/comlink.ts                         # thin Comlink re-export
samples/{fdm-cube.gcode, cnc-pocket.nc}
tests/{parse, detectMode, carve, layers, samples}.test.ts
```

### Architecture notes

- **Normalized IR.** Parsing produces one mode‑independent `GcodeDoc` (`src/types.ts`) — a list of `Move`s plus units, bbox, detected mode, and metadata. Both renderers, mode detection, and the info panel build against it.
- **Arc math lives once.** `arcs.ts::arcSweep` resolves the CW/CCW direction and full‑circle rules; both the polyline tessellator (geometry build) and the carve sampler consume it, so they cannot drift apart.
- **Carve is pure and authoritative.** `carve.ts` is a deterministic CPU height‑map sim with no DOM/Three/worker dependency, so it is directly unit‑testable. `carveGpu.ts` documents the planned GPU min‑blend seam but is not yet implemented — the CPU path is authoritative.
- **Browser‑safe tokenizer.** cncjs `gcode-parser` defines a Node `stream.Transform` subclass at module load, which throws in the browser. We tokenize inline and keep only `gcode-toolpath`'s stream‑free motion logic; tiny shims in `src/shims/` satisfy the residual Node‑builtin imports (aliased in `vite.config.ts`).

## Testing

```bash
npm run test
```

Unit tests cover IR correctness (units G20/G21, abs/rel G90/G91, G92 offset, arc interpolation), mode‑detection scoring, additive geometry banding, the carve height‑map (tool profiles, default stock, cut depth, op scrubbing), and the bundled sample files.

## Known limitations

- A single‑Z height map cannot represent **undercuts** — correct for true 3‑axis work, but 4/5‑axis or undercut geometry needs a multi‑dexel/voxel approach (a stretch goal in `PLAN.md`).
- The GPU carve path (`carveGpu.ts`) is a documented stub; carving runs on the CPU in a worker.
- The main JS bundle is ~1.4 MB (Three.js); acceptable for a static viewer, but code‑splitting is an easy future win.
