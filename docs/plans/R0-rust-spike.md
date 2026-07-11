# R0 — Rust toolchain + wasm hello-world spike

Goal: Rust compiled to WebAssembly, loaded by Vite, callable from the game, built by CI — proven
end-to-end with the smallest possible surface. **No gameplay changes.** After R0, the rest of the
batch builds on a working two-language pipeline instead of debugging toolchain and architecture at
the same time.

Why Rust at all (the honest math, recorded so future-us doesn't forget): the R2 tile sim is
~40–80k active cells at 10 Hz ≈ well under 1M cell-updates/sec — JS typed arrays handle tens of
millions. Rust/wasm is a **learning-experience choice** (user's call, 2026-07-11: "learning
experience and funzies"), not a perf necessity — until/unless R5's sub-tile ideas happen, where it
becomes one. Design consequence: keep the boundary batch-shaped so the choice stays cheap.

## What WebAssembly is (learning sidebar — read first)
- Rust is compiled **ahead of time** (cargo → LLVM → `.wasm`) into a portable binary instruction
  format; the browser JITs that to machine code. There is no Rust interpreter — "running Rust in
  JS" means *calling compiled exports*, like a native library.
- The module owns one big **linear memory** (an `ArrayBuffer` under the hood). All wasm-side state
  lives in it. JS can create typed-array **views** directly into it — that's "zero-copy".
- **wasm-bindgen** generates the JS↔Rust glue (function wrappers, type marshalling); **wasm-pack**
  orchestrates the build and emits an importable JS package (`pkg/`).
- Boundary rule of thumb: each JS↔wasm call has fixed overhead. Chatty APIs (call per tile) lose;
  batch APIs (one `tick(dt)`, then read views) win.

## Deliverables
1. Toolchain installed (steps below), documented in WORKFLOW.md.
2. `rust/nightward-core/` crate, built via `npm run wasm` → output `src/wasm/pkg/` (gitignored).
3. `src/wasm/core.ts` loader module; exports surfaced on `window.__nw.core`.
4. Two demo exports proving both boundary patterns:
   - `ping() -> u32` returning `42` — plain call + scalar return.
   - `checker_fill(w: u32, h: u32)` + `checker_ptr() -> *const u8` + `checker_len() -> u32` —
     fills a buffer in linear memory; TS wraps it in a zero-copy `Uint8Array` view and bakes it to
     a small debug canvas texture. Console verb `__nw.core.debugChecker()` shows it as a corner
     overlay sprite. This is the exact pattern R1 scales up.
5. deploy.yml builds the wasm in CI.
6. WORKFLOW.md updated: fresh clone / fresh worktree now needs `npm run wasm` before
   typecheck/build; add the command to Handy commands.

## Toolchain steps (Windows, this machine)
1. Install rustup: `winget install Rustlang.Rustup`, then in a fresh shell:
   `rustup toolchain install stable-gnu` and `rustup default stable-gnu`.
   **Why gnu host:** wasm-bindgen's proc-macros compile *on the host* even though the game targets
   wasm, so a working host toolchain is required — and `stable-gnu` is self-contained (bundled
   linker), avoiding the multi-GB Visual Studio Build Tools install. Fallback if any crate
   insists on MSVC: install "Visual Studio Build Tools" (C++ workload) and `rustup default stable-msvc`.
2. `rustup target add wasm32-unknown-unknown`.
3. `npm i -D wasm-pack` — the npm package ships a prebuilt binary. Do **not** `cargo install` it.
4. Crate skeleton `rust/nightward-core/`:
   - `Cargo.toml`: `crate-type = ["cdylib", "rlib"]`, dependency `wasm-bindgen`;
     `[profile.release] opt-level = "s"` + `lto = true`.
   - `src/lib.rs`: the demo exports + one native `#[test]` (smoke test — the harness existing is
     the point; R1 leans on `cargo test` for real logic).
5. `rust/nightward-core/.cargo/config.toml`:
   ```toml
   [build]
   target-dir = "../../node_modules/.cargo-target"
   ```
   **Load-bearing:** the repo lives inside OneDrive; cargo target dirs grow to GBs and churn on
   every build. OneDrive skips folders named `node_modules`, and git already ignores it. Worktrees
   junction `node_modules` from main, so they share the build cache too (cargo file-locks it).
6. npm scripts (package.json):
   ```json
   "wasm": "wasm-pack build rust/nightward-core --target web --release --out-dir ../../src/wasm/pkg",
   "build": "npm run wasm && vite build"
   ```
   Dev flow: run `npm run wasm` manually after Rust edits — Vite full-reloads when `pkg/` changes.
   (A cargo-watch loop is optional QoL, not required.)
7. `.gitignore`: add `src/wasm/pkg/` (and `rust/**/target/` belt-and-braces, in case the
   config.toml is ever bypassed).
8. Known flake: wasm-pack downloads binaryen's `wasm-opt` post-processor; if that misbehaves on
   Windows, disable it in Cargo.toml (`[package.metadata.wasm-pack.profile.release] wasm-opt = false`)
   — the size cost is irrelevant at this scale. Revisit later.

## Loader pattern (`src/wasm/core.ts`)
- `import init, { ping, checker_fill, checker_ptr, checker_len } from './pkg/nightward_core';`
  then `await init()` — top-level await is fine (target es2022).
- **Encode THE gotcha once, here:** growing wasm memory (`WebAssembly.Memory.grow`) detaches every
  existing typed-array view. Write a `views()` helper that caches views and rebuilds them whenever
  `memory.buffer` identity changes. All of R1+ reads world state through this helper — getting it
  right in the spike, on a 10-line demo, is the whole reason R0 exists.
- Boot order: `main.ts` awaits core init before constructing game systems (R1 will depend on it;
  wire the await now so the seam exists).

## CI (deploy.yml)
- Add before the npm build: `dtolnay/rust-toolchain@stable` with `targets: wasm32-unknown-unknown`;
  optionally `Swatinem/rust-cache@v2` (point its workspace at `rust/nightward-core`).
- `npm ci && npm run build` (build now includes the wasm step).
- NOTE: while the repo is private the Pages *deploy* step still fails (known visibility issue —
  user's call). R0's CI check is the **build job** passing, wasm step included.

## Verify
- `npm run wasm` produces `src/wasm/pkg/`; `npm run typecheck` clean; `npm run build` green.
- `cargo test` (in `rust/nightward-core/`) passes.
- Live on main after merge: `__nw.core.ping() === 42`; `__nw.core.debugChecker()` renders the
  checkerboard (proves the linear-memory → view → canvas → Pixi texture round trip).
- Record the `.wasm` file size in the tag message (expect tens of KB) — "bundle stays lean" now
  has a second number to watch.
- No playtest gate: nothing player-visible changed.
