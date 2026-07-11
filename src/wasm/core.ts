// Loads the nightward-core wasm module and owns THE boundary gotcha:
// memory.grow() detaches every existing typed-array view, so views are
// re-created whenever the buffer identity changes. Never store mem()'s
// return value across calls into the wasm module.
import init, { ping, Spike, Core } from './pkg/nightward_core';
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

/** A throwaway Int32Array view over `count` i32s at byte offset `ptr` (events). */
export function memI32(ptr: number, count: number): Int32Array {
  return new Int32Array(wasm.memory.buffer, ptr, count);
}

export async function initCore() {
  wasm = await init(); // Vite resolves the .wasm asset via import.meta.url in the glue
  return { ping, Spike, Core, mem };
}

export { ping, Spike, Core };
