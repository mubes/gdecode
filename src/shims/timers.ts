// Browser shim for Node's `timers` — aliased in vite.config.ts. Maps to the
// browser's own timer functions. Only referenced by gcode-parser's unused stream
// path; provided so the import resolves without externalization warnings.
export const setImmediate = (fn: (...args: unknown[]) => void, ...args: unknown[]) =>
  setTimeout(fn, 0, ...args);
export const clearImmediate = (id: ReturnType<typeof setTimeout>) => clearTimeout(id);
export default { setImmediate, clearImmediate };
