# R1 — The Writable World (materials + overrides in the Rust core)

Goal: terrain becomes runtime-mutable. A sparse override layer in `nightward-core` sits on top of
the pure procgen function; tiles become **materials** — a first-class data table with gameplay
properties; chunk rendering, walkability, and movement speed all read the *effective* material.
After R1, skills finally have a world they can change: fire (R2), physics verbs (R3),
water/farming (R4) all build on exactly this layer.

This brief is implementation-grade; the **Acceptance checklist** at the bottom is the post-merge
verification contract — run it verbatim. Prereq: R0 merged (toolchain, `src/wasm/core.ts` with the
`mem()` helper, `__nw.core` seam).

## The one big idea (learning sidebar)
The infinite world stays a pure function — **procgen is the DEFAULT VALUE of every tile**. The
core stores only diffs (`tile → material`). Memory grows with what players change, not with world
size. This is the existing `depleted`-map pattern, generalized to terrain and moved into wasm,
where the R2+ simulation will read it at full speed without crossing the JS boundary per tile.

**Undo rule (load-bearing, both sides implement it identically):** writing a tile's *base*
material back **clears** the override entirely — repaint-to-base = undo, feature returns. A tile
"has an override" iff its effective material ≠ its base material. This keeps the active and
inactive code paths consistent and makes the feature-kill rule (below) unambiguous.

## Data — `src/game/data/materials.ts` (TS stays the source of truth for ALL content)
Supersedes `biomes.ts` as THE tile table. `biomes.ts` becomes a re-export shim (`T`, `BIOMES`
mapped onto the first 9 materials) or is deleted with imports updated — either way ONE table.
```ts
export interface MaterialDef {
  name: string;
  art: { ramp: RGB[]; detail: Detail; accents?: RGB[] };  // never crosses the wasm boundary
  passable: boolean;
  speedMult: number;   // movement multiplier standing on it (1 = normal; ignored if impassable)
  buildable: boolean;  // may buildings be placed on it (canPlaceAt gains this check)
  flammable: number;   // 0..1 ignition factor — stored now, used by R2
  fuel: number;        // burn-seconds — R2
  burnsTo: number;     // material id after burnout; -1 = fireproof — R2
}
export const MATERIALS: MaterialDef[] = [/* index IS the material id (u8) */];
export const M = { DEEP:0, WATER:1, SAND:2, GRASS:3, MEADOW:4, FOREST:5, HILL:6, MOUNTAIN:7,
  SNOW:8, DIRT:9, ASH:10, ICE:11, MUD:12, GRAVEL:13, TILLED:14, SHALLOW:15 } as const;
```
Rows 0–8 keep today's nine biomes **verbatim** (same ramps/details/passable). New gameplay props
for them and the 7 new rows (all numbers are CFG-grade suggestions — tune at the playtest gate;
`detail` must be an existing `Detail` kind):

| id | name | passable | speedMult | buildable | flammable | fuel | burnsTo | art suggestion |
|----|------|----------|-----------|-----------|-----------|------|---------|----------------|
| 0 DEEP | as today | no | 0 | no | 0 | 0 | -1 | unchanged |
| 1 WATER | as today | no | 0 | no | 0 | 0 | -1 | unchanged |
| 2 SAND | as today | yes | 0.9 | yes | 0 | 0 | -1 | unchanged |
| 3 GRASS | as today | yes | 1.0 | yes | 0.15 | 2 | 10 | unchanged |
| 4 MEADOW | as today | yes | 1.0 | yes | 0.2 | 2 | 10 | unchanged |
| 5 FOREST | as today | yes | 1.0 | yes | 0.45 | 6 | 10 | unchanged |
| 6 HILL | as today | yes | 0.85 | yes | 0.05 | 2 | 10 | unchanged |
| 7 MOUNTAIN | as today | no | 0 | no | 0 | 0 | -1 | unchanged |
| 8 SNOW | as today | no | 0 | no | 0 | 0 | -1 | unchanged |
| 9 DIRT | Dirt | yes | 1.0 | yes | 0 | 0 | -1 | ramp('#5a4632','#6e5740','#84694e'), 'speckle' |
| 10 ASH | Ash | yes | 1.0 | yes | 0 | 0 | -1 | ramp('#3a3a3e','#4a4a50','#5f5f66'), 'speckle' |
| 11 ICE | Ice | yes | 1.15 | no | 0 | 0 | -1 | ramp('#9fc4e8','#bcd9f2','#e0f0fb'), 'cracks' |
| 12 MUD | Mud | yes | 0.55 | yes | 0 | 0 | -1 | ramp('#4b3b2a','#5d4a35','#6f5a41'), 'speckle' |
| 13 GRAVEL | Gravel | yes | 0.95 | yes | 0 | 0 | -1 | ramp('#6b6f77','#7d828c','#9198a3'), 'pebbles' |
| 14 TILLED | Tilled Soil | yes | 0.9 | no | 0.1 | 1 | 9 | ramp('#4a3928','#5a4632','#6e5740'), 'cracks' |
| 15 SHALLOW | Shallows | yes | 0.6 | no | 0 | 0 | -1 | ramp('#2565a0','#3579b4','#4a8ec9'), 'waves' |

⚠ Balance note: speedMults on EXISTING tiles (sand 0.9, hill 0.85) change current feel — that's
deliberate (terrain finally matters) but it's exactly what the playtest gate judges; falling back
to 1.0 is a data edit, not a code change.

**Flat-packing** (`packMaterials(): Float32Array`, in materials.ts): `STRIDE = 6` floats per
material, layout `[passable(0|1), speedMult, buildable(0|1), flammable, fuel, burnsTo]`. Rust
never sees names or art. Expose the live table as `window.NW.MATS = MATERIALS` (like `NW.CFG`);
`__nw.core.pushMaterials()` re-packs + re-uploads so console tinkering works at runtime.

## Rust — `nightward-core` exports
Exported class **`Core`** (NOT "WorldCore" — that name is taken by the TS wrapper):
```rust
#[wasm_bindgen]
pub struct Core {
    seed: u32,
    cap: usize,                            // chunk slot capacity
    mats: Vec<f32>,                        // materials table, stride 6
    slots: Vec<u8>,                        // cap*256 effective materials — allocated ONCE, never grows
    base:  Vec<u8>,                        // cap*256 base materials (for diffing) — allocated ONCE
    slot_of: HashMap<(i32, i32), usize>,   // (cx,cy) -> slot
    free: Vec<usize>,                      // free slot indices
    overrides: HashMap<(i32, i32), u8>,    // (tx,ty) -> mat, for tiles in INACTIVE chunks only
    events: Vec<i32>,                      // flat (tx,ty) pairs since last clear; may grow/realloc
}
```
Methods (exact semantics — chunk = 16×16 tiles, matching `CHUNK` in chunkmap.ts; do not invent a
second chunk size):
- `new(seed: u32, chunk_capacity: u32) -> Core` — preallocates `slots`/`base` at full capacity so
  their pointers are stable for the lifetime of the instance (only `events` may realloc).
- `set_materials(props: &[f32], stride: u32)` — replaces `mats`. Called at init and by
  `pushMaterials()`.
- `activate_chunk(cx: i32, cy: i32, base: &[u8]) -> bool` — false if pool exhausted (JS logs a
  warning, world still works read-only via fallback). Copies the 256 base bytes into both arrays,
  then drains every entry of `overrides` belonging to this chunk into the slot (apply + remove
  from the map — ownership moves to the slot). Pushes NO events (JS bakes fresh on load anyway).
- `deactivate_chunk(cx: i32, cy: i32)` — for each of the 256 tiles, if `slots ≠ base`, insert into
  `overrides`; return slot to `free`; drop from `slot_of`. No events.
- `chunk_ptr(cx: i32, cy: i32) -> u32` — absolute byte offset of the chunk's 256-byte effective
  array in linear memory (`slots.as_ptr() + slot*256`); `0` if inactive.
- `set_material(tx: i32, ty: i32, mat: u8, base_mat: u8)` — TS always passes the tile's base
  (from `gen.tileAt`; Rust lacks worldgen). Active chunk: write the slot (skip if value unchanged).
  Inactive: if `mat == base_mat` remove from `overrides`, else insert. Both paths push one
  `(tx,ty)` event pair when the effective value actually changed.
- `override_at(tx: i32, ty: i32) -> i32` — effective ≠ base? Active: compare slot vs base array.
  Inactive: `overrides.get`. Returns the override material id, or `-1` for "no override".
- `events_ptr() -> u32` / `events_count() -> u32` (pair count) / `events_clear()` — drained once
  per frame. `events` may realloc, so JS fetches `events_ptr()` fresh at every drain and builds a
  throwaway `Int32Array(memory.buffer, ptr, count*2)`.
- `tick(_dt: f32)` — empty body. The entry point exists so main-loop wiring lands now (R2 fills it).

Native `cargo test` coverage (minimum): override survives deactivate→reactivate round trip;
`set_material` on an inactive chunk applies on activation; repaint-to-base clears the override on
BOTH the active and inactive paths; `override_at` agrees with `set_material` on both paths;
events record exactly the effectively-changed tiles; pool exhaustion returns false and stays sane.

## TS integration (file by file)
- **NEW `src/game/world/core.ts` — class `WorldCore`** (owns the wasm `Core` instance):
  - `ensureAround(px, py, viewW, viewH)` — mirrors `ChunkMap.ensureAround` math (radius `r`,
    unload beyond `r+2`) to activate/deactivate chunks; **pinned chunks never deactivate**.
    Called each frame right where `chunkmap.ensureAround` is called today. Activation builds the
    256-byte base buffer via `gen.tileAt` (one loop — same cost as a chunk bake's ground pass).
  - `pin(keys: Set<string>)` — set of `"cx,cy"` chunk keys that must stay active: every chunk
    containing a building. Recomputed wherever `world.reindexBuildings()` runs (territory must
    stay authoritative off-screen).
  - `materialAt(tx, ty): number` — THE only effective-material path in the game: active chunk →
    direct `mem()` read at cached `chunk_ptr` (an array index, no wasm call; cache the ptr per
    chunk key, invalidated by activate/deactivate which this class itself drives); inactive →
    `override_at` ≥ 0 ? that : `gen.tileAt`.
  - `setMaterial(tx, ty, mat)` — computes `base = gen.tileAt(tx,ty)`, calls
    `core.set_material(tx, ty, mat, base)`.
  - `drainEvents(): [number, number][]` — reads pairs, `events_clear()`, returns them.
  - `pushMaterials()` — repack `NW.MATS` → `set_materials`.
  - `stats = { activations, deactivations, events, rebakes }` counters (verification hooks).
  - Test-only helpers `_activate(cx,cy)` / `_deactivate(cx,cy)` (used by the acceptance script).
- **`src/game/world/world.ts`**: constructor takes the `WorldCore`; `passable()` reads
  `MATERIALS[core.materialAt(tx,ty)].passable` (building/feature logic unchanged on top); NEW
  `speedAt(tx, ty): number` returning the material's `speedMult`; `canPlaceAt` additionally
  requires `MATERIALS[...].buildable`; **`featureAt` returns `null` when
  `core.overrideAt(tx,ty) >= 0`** (feature-kill rule; `depleted` map untouched this milestone —
  unification is an R4 candidate, not now).
- **`src/game/world/chunkmap.ts`**: `bake` reads effective materials through
  `world.materialAt` (never `gen.tileAt` directly); NEW `rebakeTiles(tiles)` — dedupes to unique
  chunks (incl. the existing south-border tree rule) and rebuilds each once. Per-frame wiring:
  `chunkmap.rebakeTiles(worldCore.drainEvents())`. The dedupe is what keeps R2's fire from
  thrashing the baker.
- **movement** (`world/player.ts`, `systems/hordes.ts`, `systems/worldbosses.ts`): multiply
  velocity by `world.speedAt(...)` at the entity's feet tile. One shared helper on `World`;
  applied where each currently computes its move step.
- **`main.ts`**: boot order `await initCore()` → `new Core(seed, 4096)` → `set_materials(pack)` →
  `newState(...)` → systems as today. Frame order: `worldCore.ensureAround` → sim systems →
  `core.tick(dt)` (no-op) → drain events → rebakes. Plus: **`?seed=<int>` URL param overrides the
  random seed** (tiny, but it makes every future acceptance script deterministic).
- **God brush** (god mode only): hotkey **P** paints the current brush material at the player's
  feet tile; **Shift+P** cycles the brush (toast shows the material name). Console verb
  `__nw.paint(matId, tx, ty, r = 0)` paints a square radius. Every paint emits a log entry (new
  `'world'` LogKind in `systems/log.ts` + a UI color for it).
- **`__nw` surface additions** (verification contract): `__nw.core` = the `WorldCore` wrapper
  (`materialAt`, `setMaterial`, `overrideAt`, `pushMaterials`, `stats`, `_activate`,
  `_deactivate`), `__nw.paint`, `window.NW.MATS`.

## Explicitly OUT of scope
- No fields / CA ticking (R2), no ice TTL melt (R3), no planting (R4), no LOD/zoom (W5-after-R2).
- No worldgen port to Rust: TS `WorldGen` remains the single base-terrain source; the core stores
  diffs, it never generates. (R5 may move generation wholesale — never two implementations.)
- No new player skills — the brush is god-mode only; Firemaking (R2) and Excavation (R3) are the
  real verbs with their own balance passes.
- `findSpawn`, camera, fog, domains: untouched.

## Acceptance checklist (post-merge verification contract)
Static, in the worktree: (1) `npm run wasm` + `npm run typecheck` + `npm run build` green;
(2) `cargo test` — all listed cases present and passing.

Live on main, at `?seed=1234`, god mode ON, each block ONE synchronous eval (the harness ticker
corrupts multi-eval sequences — W3 lesson):
3. **Ice bridge / undo:** scan outward from spawn for the first `WATER` tile `w`. Assert
   `passable(w) === false` → `__nw.paint(11, w.tx, w.ty)` → `materialAt === 11`,
   `passable === true`, `overrideAt === 11` → paint base back (`1`) → `overrideAt === -1`,
   `passable === false`.
4. **Feature kill + return:** find a tile where `world.featureAt !== null`; paint `9` (DIRT) →
   `featureAt === null`; repaint base → feature back (undo rule).
5. **Speed:** paint a 3-tile MUD pad and a GRASS control pad; teleport player onto each,
   `step(60)` of held movement; displacement ratio ≈ `0.55 ± 0.1`.
6. **Persistence across deactivation:** paint a tile, `__nw.core._deactivate(cx,cy)` →
   `materialAt` still returns the override (inactive path) → `_activate(cx,cy)` (re-supplying
   base) → still the override; `stats.activations/deactivations` incremented.
7. **Determinism:** reload at `?seed=1234`; 100-sample probe
   `[...Array(100)].map((_,i)=>__nw.gen.tileAt(i*7-350,i*13-650)).join('')` identical across two
   fresh boots; identical to the same probe taken BEFORE any painting in this session.
8. **Live re-upload:** `NW.MATS[12].speedMult = 1.0; __nw.core.pushMaterials()` → repeat check 5
   → ratio ≈ 1.0, no reload.
9. **Events → rebake:** one paint increments `stats.events` by 1 and `stats.rebakes` by ≥ 1 on
   the next frame; painting the same value twice adds no second event.
10. **Perf sanity:** sprint across ~10 regions; `stats.activations` grows, frame stays smooth
    (no observable hitch in `step` timing), pool never exhausts at capacity 4096.
11. **Buildable:** `canPlaceAt` on painted ICE → false (with the existing reason-toast pathway).

**Playtest gate: STOP after tagging** (playtest agent screens first, then the user's verdict —
seven new materials' look + mud/ice/sand/hill feel are the judged surface).

## Learning notes
- Sparse overlay = "the world is a database whose default value is a function." The same trick
  later powers dream-regen for free: deleting overrides IS regeneration.
- `chunk_ptr` hands JS a window into wasm RAM — reading a tile is an array index, not a function
  call; that's why the boundary doesn't hurt at 60 fps, and why the override store lives in wasm
  (R2's fire tick reads override-aware materials without crossing back to JS).
- Events-out instead of JS polling: the sim knows exactly what changed; the renderer shouldn't
  diff 40k tiles to find out.
