import * as Comlink from 'comlink';

// Helpers for the worker side. Each worker calls `expose(api)`; the main thread
// wraps `new Worker(...)` with `wrap<T>()`. Transferables (ArrayBuffers) are
// marked with `transfer()` so large geometry/height buffers move without copy.
export const expose = Comlink.expose;
export const wrap = Comlink.wrap;
export const transfer = Comlink.transfer;
export const proxy = Comlink.proxy;
export type { Remote } from 'comlink';
