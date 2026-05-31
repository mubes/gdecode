// Browser shim for Node's `events` — aliased in vite.config.ts. cncjs
// gcode-parser imports it but only uses it inside its (unused) stream code path.
// A minimal EventEmitter keeps the import valid without pulling a polyfill.
export class EventEmitter {
  on() {
    return this;
  }
  once() {
    return this;
  }
  emit() {
    return false;
  }
  removeListener() {
    return this;
  }
  removeAllListeners() {
    return this;
  }
}
export default EventEmitter;
