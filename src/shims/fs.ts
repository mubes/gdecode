// Browser shim for Node's `fs` — aliased in vite.config.ts. cncjs gcode-parser
// imports it for its file APIs (parseFile/parseFileSync/createReadStream), which
// we never call (we use the pure string APIs). The stubs throw if ever reached.
const unavailable = (): never => {
  throw new Error('fs is not available in the browser (gdecode uses string-based G-code parsing)');
};
export const readFileSync = unavailable;
export const createReadStream = unavailable;
export default { readFileSync, createReadStream };
