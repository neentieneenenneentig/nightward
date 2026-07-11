// Loads the nightward-core wasm module and owns THE boundary gotcha:
// memory.grow() detaches every existing typed-array view, so views are
// re-created whenever the buffer identity changes. Never store mem()'s
// return value across calls into the wasm module.
import init, { ping, Spike } from './pkg/nightward_core';
import type { InitOutput } from './pkg/nightward_core';

let wasm: InitOutput;
let cachedBuf: ArrayBufferLike | null = null;
let u8: Uint8Array;

export function mem(): Uint8Array {
  if (wasm.memory.buffer !== cachedBuf) {
    cachedBuf = wasm.memory.buffer;
    u8 = new Uint8Array(wasm.memory.buffer);
  }
  return u8;
}

export async function initCore() {
  wasm = await init(); // Vite resolves the .wasm asset via import.meta.url in the glue
  return { ping, Spike, mem };
}

export { ping, Spike };
