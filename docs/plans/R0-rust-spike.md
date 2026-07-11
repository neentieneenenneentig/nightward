# R0 — Rust toolchain + wasm hello-world spike

Goal: Rust compiled to WebAssembly, loaded by Vite, callable from the game, built by CI — proven
end-to-end with the smallest possible surface. **No gameplay changes.** After R0, the rest of the
batch builds on a working two-language pipeline instead of debugging toolchain and architecture at
the same time.

This brief is implementation-grade: an implementer (Sonnet/Opus) follows it without inventing
contracts, and the **Acceptance checklist** at the bottom is the post-merge verification contract —
run it verbatim.

Why Rust at all (the honest math, recorded so future-us doesn't forget): the R2 tile sim is
~40–80k active cells at 10 Hz ≈ well under 1M cell-updates/sec — JS typed arrays handle tens of
millions. Rust/wasm is a **learning-experience choice** (user's call, 2026-07-11: "learning
experience and funzies"), not a perf necessity — until/unless R5's sub-tile ideas happen. Design
consequence: keep the boundary batch-shaped so the choice stays cheap.

## What WebAssembly is (learning sidebar — read first)
- Rust is compiled **ahead of time** (cargo → LLVM → `.wasm`) into a portable binary format; the
  browser JITs that to machine code. There is no Rust interpreter — "running Rust in JS" means
  *calling compiled exports*, like a native library.
- The module owns one **linear memory** (an `ArrayBuffer` under the hood). All wasm-side state
  lives in it. JS can create typed-array **views** directly into it — that's "zero-copy".
- **wasm-bindgen** generates the JS↔Rust glue (a `#[wasm_bindgen] pub struct` becomes a JS class);
  **wasm-pack** orchestrates the build and emits an importable package (`pkg/`).
- Boundary rule of thumb: every JS↔wasm call has fixed overhead. Chatty APIs (call per tile) lose;
  batch APIs (one call, then read views) win.

## Deliverables
1. Toolchain installed (steps below).
2. `rust/nightward-core/` crate; `npm run wasm` builds it to `src/wasm/pkg/` (gitignored).
3. `src/wasm/core.ts` loader with the `mem()` view helper (the one gotcha, encoded once).
4. Demo exports: `ping()` (scalar round trip) and class `Spike` (linear-memory round trip),
   surfaced as `window.__nw.core` with a self-checking `debugChecker()`.
5. deploy.yml builds the wasm in CI.
6. WORKFLOW.md updated (fresh clone/worktree step + handy commands, see task 7).

## Tasks

### 1. Toolchain (one-time, on this machine)
```
winget install Rustlang.Rustup
# fresh shell:
rustup toolchain install stable-gnu
rustup default stable-gnu
rustup target add wasm32-unknown-unknown
npm i -D wasm-pack
```
- **Why gnu host:** wasm-bindgen's proc-macros compile *on the host* even though the game targets
  wasm, so a working host toolchain is required — `stable-gnu` is self-contained (bundled linker)
  and avoids the multi-GB Visual Studio Build Tools install. Fallback if any build step demands
  MSVC: install "Visual Studio Build Tools" (C++ workload), `rustup default stable-msvc`.
- **wasm-pack comes from npm** (prebuilt binary). Never `cargo install` it.

### 2. Crate `rust/nightward-core/`
`Cargo.toml`:
```toml
[package]
name = "nightward-core"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib", "rlib"]

[dependencies]
wasm-bindgen = "0.2"

[profile.release]
opt-level = "s"
lto = true
```
`src/lib.rs` (complete):
```rust
use wasm_bindgen::prelude::*;

/// Boundary smoke test: scalar across the JS<->wasm boundary.
#[wasm_bindgen]
pub fn ping() -> u32 {
    42
}

/// The pattern R1 scales up: state lives inside the module; JS reads it
/// through a zero-copy view into linear memory (ptr + len, no copying).
#[wasm_bindgen]
pub struct Spike {
    buf: Vec<u8>,
    w: u32,
    h: u32,
}

#[wasm_bindgen]
impl Spike {
    #[wasm_bindgen(constructor)]
    pub fn new(w: u32, h: u32) -> Spike {
        let mut buf = vec![0u8; (w * h) as usize];
        for y in 0..h {
            for x in 0..w {
                buf[(y * w + x) as usize] = if (x / 8 + y / 8) % 2 == 0 { 255 } else { 0 };
            }
        }
        Spike { buf, w, h }
    }
    pub fn ptr(&self) -> *const u8 { self.buf.as_ptr() }
    pub fn len(&self) -> u32 { self.buf.len() as u32 }
    pub fn width(&self) -> u32 { self.w }
    pub fn height(&self) -> u32 { self.h }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ping_is_42() { assert_eq!(ping(), 42); }

    #[test]
    fn checker_pattern() {
        let s = Spike::new(16, 16);
        assert_eq!(s.len(), 256);
        assert_eq!(s.buf[0], 255);   // first cell of first 8x8 block
        assert_eq!(s.buf[8], 0);     // first cell of second block
    }
}
```
(`cargo test` compiles for the HOST and runs natively — that's where Rust logic gets tested from
R1 on; the browser only ever runs release wasm.)

`rust/nightward-core/.cargo/config.toml`:
```toml
[build]
target-dir = "../../node_modules/.cargo-target"
```
**Load-bearing:** the repo lives inside OneDrive; cargo target dirs grow to GBs and churn on every
build. OneDrive skips folders named `node_modules`, and git already ignores it. Worktrees junction
`node_modules` from main, so they share the build cache (cargo file-locks it).

### 3. npm scripts (package.json)
```json
"wasm": "wasm-pack build rust/nightward-core --target web --release --out-dir ../../src/wasm/pkg",
"build": "npm run wasm && vite build"
```
(`--out-dir` is relative to the crate.) Dev flow: run `npm run wasm` after Rust edits; Vite
full-reloads when `pkg/` changes. `typecheck` script is unchanged but now requires `pkg/` to exist
— see task 7.

### 4. .gitignore
Add `src/wasm/pkg/` and (belt-and-braces) `rust/**/target/`.

### 5. Loader `src/wasm/core.ts` (complete)
```ts
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
```
`main.ts`: `const core = await initCore()` **before** game construction (top-level await is fine,
target es2022) — R1 depends on this seam; wire the await now.

### 6. `window.__nw.core` + debugChecker
Extend the existing `__nw` hook object:
```ts
__nw.core = {
  ping,                    // () => 42
  debugChecker(): boolean {
    const s = new Spike(64, 64);
    const view = mem().subarray(s.ptr(), s.ptr() + s.len()); // zero-copy window
    // computational self-check (no screenshots — harness renders hidden):
    let ok = true;
    for (let y = 0; y < 64; y++)
      for (let x = 0; x < 64; x++)
        ok &&= view[y * 64 + x] === (((x >> 3) + (y >> 3)) % 2 === 0 ? 255 : 0);
    // visual payoff: bake to a canvas -> Pixi sprite pinned top-left of the UI layer
    // (grayscale ImageData from view; sprite removable on second call/toggle)
    /* ...canvas bake + sprite add... */
    s.free(); // wasm-bindgen classes need explicit free — teach it here
    return ok;
  },
};
```
Contract for later verification: `__nw.core.ping() === 42` and
`__nw.core.debugChecker() === true`, both callable from a single eval.

### 7. WORKFLOW.md + CI
- WORKFLOW.md: add to Handy commands — `npm run wasm` (rebuild core; required once per fresh
  clone AND per fresh worktree before typecheck/build, since `pkg/` is gitignored; the shared
  cargo target dir makes worktree builds fast). Add `cargo test` (in `rust/nightward-core/`) to
  the per-milestone static verify list.
- deploy.yml: insert before the Node/npm steps:
  ```yaml
  - uses: dtolnay/rust-toolchain@stable
    with:
      targets: wasm32-unknown-unknown
  - uses: Swatinem/rust-cache@v2
    with:
      workspaces: rust/nightward-core
  ```
  The existing `npm ci && npm run build` then covers the wasm build. While the repo is private the
  Pages *deploy* step still fails (known visibility issue, user's call) — R0's CI target is the
  **build job** passing.

### Known flake
wasm-pack downloads binaryen's `wasm-opt` post-processor; if that download/run misbehaves on
Windows, disable it in Cargo.toml and move on (size is irrelevant at this scale):
```toml
[package.metadata.wasm-pack.profile.release]
wasm-opt = false
```

## Acceptance checklist (post-merge verification contract)
Run on main after merge. Every item must pass; record the wasm size in the tag message.
1. `npm run wasm` → exit 0; `src/wasm/pkg/nightward_core.js` and
   `src/wasm/pkg/nightward_core_bg.wasm` exist. Note the `.wasm` byte size (expect < 100 KB).
2. `git check-ignore src/wasm/pkg` → prints the path (it is ignored, not committed).
3. `node_modules/.cargo-target/` exists after the build (proves the OneDrive dodge is active) and
   `rust/nightward-core/target/` does NOT.
4. `cargo test` in `rust/nightward-core/` → 2 tests pass.
5. `npm run typecheck` clean; `npm run build` green; `dist/` contains exactly one `.wasm` asset.
6. Live (preview on main), single eval:
   `window.__nw.core.ping() === 42 && window.__nw.core.debugChecker() === true` → `true`.
7. deploy.yml build job green in Actions (wasm step included; Pages deploy step may still fail
   while the repo is private — that failure is out of scope).
8. WORKFLOW.md contains the `npm run wasm` fresh-clone/worktree note and `cargo test` verify line.
9. No gameplay diff: no file under `src/game/` changed except the `__nw.core` hook wiring.

No playtest gate: nothing player-visible changed.
