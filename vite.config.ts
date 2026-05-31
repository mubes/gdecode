import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// `base: './'` makes the built asset URLs relative so the SPA can be dropped onto
// any static host (GitHub Pages, S3, a subfolder) without path rewrites.
export default defineConfig({
  base: './',
  plugins: [react()],
  // Always serve on a fixed port (the `dev`/`preview` npm scripts free it first).
  server: { port: 5219, strictPort: true },
  preview: { port: 5219, strictPort: true },
  resolve: {
    alias: {
      // cncjs gcode-parser (pulled in by gcode-toolpath) imports Node builtins.
      // `stream` is the load-time crash (class extends Transform); the others are
      // only used by its unused stream/file code paths. Tiny browser shims keep
      // the imports valid. Applies to main + worker builds (`resolve` is global).
      stream: fileURLToPath(new URL('./src/shims/stream.ts', import.meta.url)),
      events: fileURLToPath(new URL('./src/shims/events.ts', import.meta.url)),
      timers: fileURLToPath(new URL('./src/shims/timers.ts', import.meta.url)),
      fs: fileURLToPath(new URL('./src/shims/fs.ts', import.meta.url)),
    },
  },
  worker: {
    format: 'es',
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
