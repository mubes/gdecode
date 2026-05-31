// Minimal browser shim for Node's `stream`, wired up via `resolve.alias` in
// vite.config.ts.
//
// Why this exists: cncjs `gcode-parser` (pulled in transitively by
// `gcode-toolpath` → `gcode-interpreter`) does `import stream, { Transform }
// from 'stream'` and defines `class GCodeLineStream extends Transform` at module
// load. In the browser Vite externalizes `stream` to an empty stub, so
// `Transform` is `undefined` and the class definition throws
// ("Super expression must either be null or a function"), crashing the worker.
//
// We only ever call the library's PURE string APIs (`parseStringSync` /
// `parseLine`) — never the stream/file ones — so these classes never need to
// actually function. They just need to exist so the `extends` is valid at load.

export class Transform {}
export class Readable {}
export class Writable {}
export class Duplex {}
export class PassThrough {}

export default { Transform, Readable, Writable, Duplex, PassThrough };
