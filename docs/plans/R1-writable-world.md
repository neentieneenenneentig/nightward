# R1 — The Writable World (materials + overrides in the Rust core)

Goal: terrain becomes runtime-mutable. A sparse override layer in `nightward-core` sits on top of
the pure procgen function; tiles become **materials** — a first-class data table with gameplay
properties; chunk rendering, walkability, and movement speed all read the *effective* material.
After R1, skills finally have a world they can change: fire (R2), physics verbs (R3), and
water/farming (R4) all build on exactly this layer.

## The one big idea (learning sidebar)
The infinite world stays a pure function — **procgen is the DEFAULT VALUE of every tile**. The
core stores only diffs (`tile → material` overrides). Memory grows with what players change, not
with world size. This is the existing `depleted`-map pattern, generalized to terrain and moved
into wasm, where the R2+ simulation can read it at full speed without crossing the JS boundary
per tile.

## Data (TS stays the source of truth for ALL content)
New `src/game/data/materials.ts` — supersedes `biomes.ts` as THE tile table:
- `MaterialDef { name, art: { ramp, detail, accents? }, passable, speedMult, buildable,
  flammable /* 0..1 */, fuel /* burn-seconds */, burnsTo? /* material id */ }`
  — array index IS the material id (u8 tile code).
- Rows 0–8 = today's nine biome tiles **verbatim** (DEEP…SNOW; keep the `T` constants working —
  `biomes.ts` shrinks to a re-export shim over materials, or is deleted with imports updated;
  either way ONE table, no drift).
- New rows (~7): `DIRT`, `ASH`, `ICE` (passable — walk on frozen water; slippery comes in R3),
  `MUD` (slow), `GRAVEL`, `TILLED` (farming, R4), `SHALLOW` (passable water). Art recipes are
  procgen ramps/details exactly like biomes today (`art.ts#tile()` keys by material id — mostly a
  rename).
- `packMaterials(): Float32Array` flat-packs the *numeric gameplay props only* (passable,
  speedMult, flammable, fuel, burnsTo — art never crosses the boundary) → uploaded at init.
  `__nw.core.pushMaterials()` re-uploads, so `window.NW.CFG`-style live tinkering keeps working
  (two-language rule: adding/tuning a material never touches Rust).

## Core API (`nightward-core` exports)
```
init_world(seed: u32, chunk_capacity: u32)   // preallocate slot pool + event ring ONCE (no grow)
set_materials(props: &[f32], stride: u32)    // gameplay props table (re-uploadable)
activate_chunk(cx: i32, cy: i32, base: &[u8])// 256 bytes from TS worldgen; applies stored overrides
deactivate_chunk(cx: i32, cy: i32)           // diffs slot vs base → sparse override map
chunk_ptr(cx: i32, cy: i32) -> u32           // byte offset of the 256-byte effective array; 0 = inactive
override_at(tx: i32, ty: i32) -> i32         // -1 = none; answers for INACTIVE chunks too
set_material(tx: i32, ty: i32, mat: u8)      // active or not; pushes a changed-tile event
events_ptr() / events_count() / events_clear()  // ring of (tx, ty) i32 pairs since last drain
tick(dt: f32)                                // empty this milestone — the entry point exists for R2
```
Implementation notes:
- Slot pool: `chunk_capacity` × 256 u8 effective-material arrays (4096 chunks ≈ 1 MB — trivial),
  plus `HashMap<(i32, i32), u8>` for overrides on tiles whose chunk isn't active. Preallocating at
  init avoids `memory.grow` view-invalidation in the steady state (R0's `views()` helper covers
  the residual case anyway).
- Chunk geometry matches the renderer: 16×16 tiles (`CHUNK` in chunkmap.ts). Do not invent a
  second chunk size.
- Native `cargo test` coverage (this is where Rust logic gets tested, not in the browser):
  override survives a deactivate→reactivate round trip; `set_material` on an inactive chunk lands
  after activation; event ring wraps correctly at capacity; base-equal writes clear the override.

## TS integration
- New `src/game/world/core.ts` — `WorldCore` wrapper class:
  - owns chunk activation: follow `ChunkMap.ensureAround`'s radius around the camera, **pin all
    territory chunks** (they must stay simulated/authoritative even off-screen), deactivate with
    hysteresis (radius +2, mirroring chunkmap's unload rule);
  - holds cached zero-copy views via the R0 view-refresh helper;
  - `materialAt(tx, ty)`: active chunk → direct view read (an array index, no wasm call);
    inactive → `override_at` → fallback `gen.tileAt`. This is the ONLY effective-material path —
    nothing else may combine overrides with base terrain;
  - `setMaterial(tx, ty, mat)`, `drainEvents()` (once per frame).
- `World.passable()` and new `World.speedAt()`: read `MATERIALS[core.materialAt(...)]` instead of
  `BIOMES[gen.tileAt(...)]`. Player, hordes, and world bosses multiply movement by `speedAt`
  underfoot — mud/ice become *real* now, *fun* in R3.
- **Feature rule:** an override at a tile REMOVES the procgen feature there (`world.featureAt`
  checks override presence first). The world remembers your touch; deliberate re-planting arrives
  in R4 as explicit feature-overrides. The `depleted` map is untouched this milestone (unifying it
  into overrides is an R4 candidate — noted, not scoped).
- `ChunkMap.bake` reads effective materials (via `world`, not `gen`); rebakes are driven by
  drained change events — collect per frame → unique chunk set → rebuild each once (a single
  `set_material` already costs one full chunk rebake; the debounce is what keeps R2's fire from
  thrashing the baker later).
- Boot order in `main.ts`: `await core init` → `set_materials(packMaterials())` → `newState()` →
  `init_world(seed, capacity)` → systems as today.
- God-mode brush (the milestone's interactive verb): console `__nw.paint(matId, tx, ty, r = 0)`
  plus a god-mode hotkey painting the hovered tile with a cycled material. Every paint emits a log
  event (new `'world'` LogKind) per the "every action logs" convention.

## Explicitly OUT of scope
- No fields / CA ticking (R2), no ice TTL melt (R3), no planting (R4), no LOD/zoom (W5-after-R2).
- No worldgen port to Rust: TS `WorldGen` remains the single base-terrain source; the core stores
  diffs, it never generates. (R5 may move generation wholesale — but never two implementations.)
- No new player skills yet — the brush is god-mode only; Firemaking (R2) and Excavation (R3) are
  the real verbs and deserve their own balance passes.

## Verify
- Static, in the worktree: typecheck clean, build green, `cargo test` green.
- Live on main after merge (via `__nw` evals + `step()`):
  - paint `ICE` across a water span → `canStand` flips true → walk across; repaint `WATER` →
    blocked again;
  - paint `DIRT` under a tree tile → feature gone after the rebake event lands;
  - `MUD` measurably slows px-per-step; `speedAt` returns the data-table value;
  - walk far away and back (deactivate → reactivate) → painted tiles persist;
  - fresh boot, same seed, nothing painted → world byte-identical (determinism);
  - `pushMaterials()` after live-editing a `speedMult` changes movement without reload.
- Perf sanity: chunk activation adds one 256-byte upload per newly-seen chunk on top of the
  existing bake cost — confirm `ensureAround` frame time stays trivial while sprinting across
  regions.
- **Playtest gate: STOP after tagging.** Seven new materials' look + mud/ice underfoot are
  feel-work; playtest agent screens first, then the user's verdict before R2 starts.

## Learning notes
- Sparse overlay = "the world is a database whose default value is a function." The same trick
  (diff over procgen) later powers dream-regen for free: deleting overrides IS regeneration.
- `chunk_ptr` hands JS a window into wasm RAM — reading a tile is an array index, not a function
  call. That's why the boundary doesn't hurt at 60 fps, and why the override store lives in wasm:
  R2's fire tick will read override-aware materials at full speed without crossing back to JS.
- Why events-out instead of JS polling: the sim knows exactly what changed; the renderer shouldn't
  diff 40k tiles to find out.
