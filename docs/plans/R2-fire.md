# R2 — Fire (the living world, part 1)

Goal: the world stops being merely writable (R1) and paintable-pretty (R1.5) — it starts
**reacting**. A per-active-chunk cellular automaton in `nightward-core` burns flammable terrain,
spreads on the wind, drowns near water, and leaves permanent scars (`burnsTo` overrides) the
existing override system already knows how to persist and render. Firemaking becomes the game's
first skill that manipulates the simulation directly instead of just harvesting it.

This brief is implementation-grade; the **Acceptance checklist** at the bottom is the post-merge
verification contract — run it verbatim. Prereq: R1.5 merged (`v0.14-r15-painted-world`) —
`world.materialAt`/override store, `ChunkMap.rebakeTiles`, the foam overlay mechanism (the pattern
the fire glow overlay extends), `heightClass`/art data conventions.

## The one big idea (learning sidebar)
A cellular automaton is just "every cell decides its own next state from its neighbors' *current*
state" — the trap is letting iteration order leak into the result (cell A updates, cell B reads
A's *new* value instead of the value that existed at tick-start, and now the simulation depends on
a HashMap's arbitrary iteration order instead of physics). The fix used throughout `fire_step`
below: **read a full snapshot, collect every change into a list, apply the list once at the end.**
Same discipline Conway's Game of Life needs, same discipline any CA needs. Combined with a
counter-based hash (seed + coordinates + tick number → a reproducible "random" roll, no mutable
RNG stream to desync) this is what makes "same seed + same ignition ⇒ identical burn footprint"
achievable at all.

## PREREQ (own commit, before any fire code) — chunk-keyed override index
`Core::activate_chunk` currently drains `overrides` with a full scan:
```rust
for (&(tx, ty), &mat) in self.overrides.iter() { if chunk_of(tx, ty) == (cx, cy) { ... } }
```
O(world overrides), not O(chunk). Fine for the god-brush; wrong once fire mass-produces standing
overrides (every burnt tile is one) while chunks stream in and out during normal play.

Add a secondary index and route every override mutation through two small helpers so `overrides`
and the index never drift apart:
```rust
overrides: HashMap<(i32, i32), u8>,                    // unchanged — source of truth
overrides_by_chunk: HashMap<(i32, i32), HashSet<(i32, i32)>>, // NEW: (cx,cy) -> tile keys with an override

fn override_insert(&mut self, tx: i32, ty: i32, mat: u8) {
    self.overrides.insert((tx, ty), mat);
    self.overrides_by_chunk.entry(chunk_of(tx, ty)).or_default().insert((tx, ty));
}
fn override_remove(&mut self, tx: i32, ty: i32) {
    self.overrides.remove(&(tx, ty));
    if let Some(set) = self.overrides_by_chunk.get_mut(&chunk_of(tx, ty)) {
        set.remove(&(tx, ty));
        if set.is_empty() { self.overrides_by_chunk.remove(&chunk_of(tx, ty)); }
    }
}
```
`set_material`'s inactive branch calls these instead of touching `overrides` directly.
`activate_chunk`'s drain becomes:
```rust
if let Some(keys) = self.overrides_by_chunk.remove(&(cx, cy)) {
    for (tx, ty) in keys {
        if let Some(mat) = self.overrides.remove(&(tx, ty)) {
            self.slots[off + local_index(tx, ty)] = mat;
        }
    }
}
```
O(overrides in THIS chunk) — typically single digits, never the whole world.

**cargo test** `activate_chunk_cost_independent_of_total_overrides`: scatter 50,000 overrides
across 50,000 distinct far-apart (never-activated) chunks, then time activating 100 fresh chunks;
assert the total stays under a generous bound (e.g. 200ms) — a regression guard, not a
microbenchmark (timing tests are inherently loose; the point is catching an O(world) regression
blowing up to seconds, not measuring microseconds). Also re-run every existing R1 override test —
all must still pass unchanged (the index is an optimization, not a semantic change).

## Data — `src/game/data/materials.ts`
One new field, the last one that crosses the wasm boundary this milestone:
```ts
export interface MaterialDef {
  // ...existing fields unchanged...
  wetness: number; // 0..1 baseline moisture — water-family tiles are wet SOURCES that diffuse
                    // dampness into flammable neighbors over CA ticks; high enough wet[] both
                    // blocks ignition and extinguishes an already-burning tile
}
```
`flammable`/`fuel`/`burnsTo` **already cross the boundary** (R1's `packMaterials` stride already
includes them at offsets 3/4/5) — `wetness` is the only genuinely new uploaded field. Values, one
per row (index = material id):

| id | name | wetness | | id | name | wetness |
|----|------|---------|-|----|------|---------|
| 0 | DEEP | 1.0 | | 8 | SNOW | 1.0 |
| 1 | WATER | 1.0 | | 9 | DIRT | 0.05 |
| 2 | SAND | 0.1 | | 10 | ASH | 0 |
| 3 | GRASS | 0.05 | | 11 | ICE | 1.0 |
| 4 | MEADOW | 0.05 | | 12 | MUD | 0.6 |
| 5 | FOREST | 0.1 | | 13 | GRAVEL | 0.05 |
| 6 | HILL | 0.05 | | 14 | TILLED | 0.15 |
| 7 | MOUNTAIN | 0 | | 15 | SHALLOW | 1.0 |

Full expected array (acceptance check #2): `1,1,0.1,0.05,0.05,0.1,0.05,0,1,0.05,0,1,0.6,0.05,0.15,1`.
SNOW=1.0 is deliberate — snowy mountains become a natural firebreak, which is free and correct
given they already border MOUNTAIN/HILL in the elevation bands.

**`STRIDE` 6 → 7**, layout unchanged except the new tail slot:
`[passable, speedMult, buildable, flammable, fuel, burnsTo, wetness]`. Update `packMaterials`'s
loop to write `out[o + 6] = m.wetness`.

**Rust side actually uses `stride` now** — `set_materials(props, stride)` currently ignores its
second argument (`_stride`, dead). Store it: `self.mats_stride = stride as usize;` and read every
material property through it (`fn mat_prop(&self, mat: usize, offset: usize) -> f32`, bounds-
checked, returns `0.0` out of range) instead of a hardcoded stride constant. This makes Rust
robust to future pure-numeric field additions without a second simultaneous edit, and it's the
correct fix for a parameter that was silently unused since R0. cargo test
`set_materials_uses_uploaded_stride`: upload a stride-7 table with a known planted wetness value,
assert `mat_prop` reads it back at offset 6.

## `src/game/data/config.ts` — `CFG.fire`
Split cleanly: the first six fields cross into the core (sim tuning); everything after is
TS-only gameplay (never uploaded — same split R1.5 used for pixel constants living in `art.ts`
instead of `CFG`).
```ts
fire: {
  // ---- uploaded to the core via set_fire_params (packFireParams, order below) ----
  tickHz: 10,                  // CA tick rate; core paces itself, independent of render fps
  spreadBase: 0.35,            // base per-tick ignition probability onto a dry flammable neighbor
  windStrength: 0.5,           // 0 = no directional bias, 1 = fully wind-driven
  wetExtinguish: 0.55,         // burn[] is doused once wet[] climbs past this
  wetDiffuseRate: 0.15,        // per-tick blend of a tile's wet[] toward its diffusion target
  wetSpreadDecay: 0.85,        // neighbor wet's influence falloff crossing one tile hop
  // ---- TS-only gameplay, never crosses the boundary ----
  reachTiles: 1.6,             // how far the player can ignite (mirrors CFG.gather.reachTiles)
  ignitionXp: 8,               // Firemaking xp per successful ignite
  burnDmgPerSec: 6,            // entity damage/s while standing in a burning tile
  burnTickSec: 0.5,            // burn-damage timer granularity (throttles hit spam)
  glowHz: 20,                  // fire glow overlay redraw cap
  campfireFearTiles: 6,        // hordes avoid spawning / hesitate within this radius of a campfire
  campfireFearSpeedMult: 0.5,  // speed multiplier applied to foes inside the fear radius
  charcoalChance: 0.7,         // chance a player-ignited controlled burn leaves charcoal on burnout
  charcoalXp: 12,              // bonus Firemaking xp when a controlled burn actually yields charcoal
},
```
Add, right after the `CFG` object closes:
```ts
export const FIRE_PARAM_COUNT = 6;
export function packFireParams(): Float32Array {
  const f = CFG.fire;
  return new Float32Array([1 / f.tickHz, f.spreadBase, f.windStrength, f.wetExtinguish, f.wetDiffuseRate, f.wetSpreadDecay]);
}
```

## Rust — `nightward-core` fire fields + exports
New `Core` fields, preallocated at `cap * CHUNK_TILES` exactly like `slots`/`base` (never resized):
```rust
fuel: Vec<f32>,               // remaining burnable seconds; 0 = can't burn
burn: Vec<f32>,                // 0 = unlit, 1.0 = actively burning (boolean today; f32 for headroom)
wet: Vec<f32>,                 // 0..1 moisture
wet_next: Vec<f32>,            // scratch buffer, swapped with `wet` each fire tick (see fire_step)
campfires: HashSet<(i32, i32)>, // tiles with a permanent, self-refueling ignition source
wind: (f32, f32),              // unit vector, derived once from `seed` at construction
fire_params: [f32; 6],         // [tick_sec, spread_base, wind_strength, wet_extinguish, diffuse_rate, spread_decay]
fire_accum: f32,               // tick(dt) accumulator — the core paces its OWN 10Hz regardless of caller
fire_tick_n: u32,               // monotonic tick counter — the deterministic RNG's time axis
mats_stride: usize,             // from set_materials — see the STRIDE section above
```
`Core::new` additionally initializes `wind` from `seed` (`hash_f32` below) and `fire_params` to
sane defaults matching `CFG.fire`'s suggested values (`[0.1, 0.35, 0.5, 0.55, 0.15, 0.85]`) so
`cargo test` works without a prior `set_fire_params` call; `main.ts` still calls
`worldCore.pushFireParams()` at boot for live-tunability, same pattern as `pushMaterials()`.

`activate_chunk` additionally initializes, for every one of the 256 tiles it just brought online
(after the existing base/override drain): `fuel[i] = mat_prop(mat, 4)`, `burn[i] = 0.0`,
`wet[i] = mat_prop(mat, 6)` where `mat` is that tile's just-written effective material.
`deactivate_chunk` does **not** spill fire fields anywhere — they're simply abandoned when the
slot returns to the pool. This is a deliberate simplification, not an oversight: fire only
simulates on active (near-player) chunks, so a fire you walk away from mid-burn "goes out" when
its chunk unloads and relights fresh (from the material's base fuel) if you wander back and
re-ignite it. Any *permanent* effect of a fire that already completed (a `burnsTo` transition) is
unaffected — that already lives in the override store, which persists exactly like every other
R1 override. Document this near the field: "ephemeral sim state resets on deactivate; permanent
effects use the override store, which already survives it."

**Small exports** (real Rust, wasm-bindgen `pub fn` on `impl Core`):
```rust
pub fn set_fire_params(&mut self, p: &[f32]) {
    for i in 0..6.min(p.len()) { self.fire_params[i] = p[i]; }
}

pub fn ignite(&mut self, tx: i32, ty: i32) -> bool {
    let (cx, cy) = chunk_of(tx, ty);
    let Some(&slot) = self.slot_of.get(&(cx, cy)) else { return false }; // unloaded chunks can't ignite
    let idx = slot * CHUNK_TILES + local_index(tx, ty);
    if self.burn[idx] > 0.0 || self.fuel[idx] <= 0.0 || self.wet[idx] >= self.fire_params[3] { return false; }
    self.burn[idx] = 1.0;
    true
}

pub fn add_campfire(&mut self, tx: i32, ty: i32) { self.campfires.insert((tx, ty)); }
pub fn remove_campfire(&mut self, tx: i32, ty: i32) { self.campfires.remove(&(tx, ty)); }

pub fn fuel_at(&self, tx: i32, ty: i32) -> f32 { /* 0.0 if chunk inactive */ }
pub fn burn_at(&self, tx: i32, ty: i32) -> f32 { /* 0.0 if chunk inactive */ }
pub fn wet_at(&self, tx: i32, ty: i32) -> f32 { /* 0.0 if chunk inactive */ }
pub fn is_burning(&self, tx: i32, ty: i32) -> bool { self.burn_at(tx, ty) > 0.0 }
pub fn burn_ptr(&self, cx: i32, cy: i32) -> u32 {
    // byte offset into the `burn` f32 array — 4 bytes/elem, unlike chunk_ptr's u8 slots.
    // 0 if inactive.
}
pub fn wind_x(&self) -> f32 { self.wind.0 }
pub fn wind_y(&self) -> f32 { self.wind.1 }
```
All four scalar getters (`fuel_at`/`burn_at`/`wet_at`/`is_burning`) share the same
active-chunk-lookup shape as `override_at` — inactive chunk → `0.0`/`false`, no fallback
computation (fire fields don't exist for inactive chunks by design, see above).

**Deterministic hash** (counter-based — no mutable RNG stream to desync across replays):
```rust
fn hash_f32(mut x: u32) -> f32 {
    x ^= x >> 16; x = x.wrapping_mul(0x7feb352d);
    x ^= x >> 15; x = x.wrapping_mul(0x846ca68b);
    x ^= x >> 16;
    (x as f32) / (u32::MAX as f32)
}
fn spread_roll(seed: u32, ntx: i32, nty: i32, tick: u32) -> f32 {
    let mut h = seed;
    h = h.wrapping_mul(0x9e3779b1).wrapping_add(ntx as u32);
    h = h.wrapping_mul(0x9e3779b1).wrapping_add(nty as u32);
    h = h.wrapping_mul(0x9e3779b1).wrapping_add(tick);
    hash_f32(h)
}
```
Wind at construction: `let a = hash_f32(seed ^ 0x517c_c1b7) * std::f32::consts::TAU; wind = (a.cos(), a.sin());`

### `tick(dt)` and `fire_step` — the CA itself
```rust
pub fn tick(&mut self, dt: f32) {
    self.fire_accum += dt;
    let step = self.fire_params[0].max(0.001);
    while self.fire_accum >= step {
        self.fire_accum -= step;
        self.fire_step();
    }
}
```
`fire_step()` (replaces the R1 no-op `tick` body) — **read-only pass first, apply deltas after**,
per the learning sidebar's rule:

0. **Force-relight campfires.** For every `(tx,ty)` in `campfires` whose chunk is active:
   `burn[idx] = 1.0; fuel[idx] = 999.0` (a constant far above any material's natural fuel — an
   eternal hearth). This runs FIRST so campfires participate as burning sources for step 1's
   spread this same tick. `remove_campfire` doesn't need to touch `burn`/`fuel` itself — once a
   tile stops being force-relit, it just ages down like any ordinary fire on whatever fuel is left.
1. **Burn/spread pass**, read-only over the CURRENT `slots`/`fuel`/`burn`/`wet`, for every active
   chunk's every local tile where `burn[idx] > 0`:
   - If `wet[idx] >= wet_extinguish` (and this tile isn't a campfire): schedule **Extinguish**,
     skip fuel decay and spread for it this tick (water wins outright).
   - Else: `new_fuel = fuel[idx] - dt` (campfires skip this — already refueled to 999 above). If
     `new_fuel <= 0`: schedule **Burnout(tx,ty, burns_to)** where `burns_to = mat_prop(mat,5) as i32`;
     if `burns_to < 0` (fireproof material somehow lit — shouldn't happen, defensive) schedule
     **Extinguish** instead. Else schedule **FuelDecay(idx, new_fuel)**.
   - Then, regardless of the fuel branch (a tile burns and can still ignite neighbors the same
     tick it's about to burn out — that reads as fire "handing off"): for each of N/E/S/W
     `(dx,dy)`, resolve the neighbor tile; skip if its chunk isn't active, if it's already burning,
     if its `fuel <= 0`, or if its material's `flammable <= 0`. Otherwise compute
     `align = dx*wind.0 + dy*wind.1`, `wind_factor = (1.0 + wind_strength*align).max(0.1)`,
     `p = (spread_base * flammable(neighbor) * wind_factor * (1.0 - wet[neighbor]).max(0.0)).clamp(0,1)`,
     and roll `spread_roll(seed, ntx, nty, fire_tick_n) < p` — schedule **Ignite(ntx,nty)** on
     success. The roll depends only on the TARGET tile's coords + tick + seed, never on which
     burning neighbor proposed it or what order chunks were visited in — this is what keeps the
     result independent of `HashMap` iteration order.
2. **Wetness diffusion**, read `wet` write `wet_next` (full double-buffer — every active tile
   updates every tick, not just burning ones, so this can't safely use a sparse delta list): for
   each active tile, `baseline = mat_prop(mat, 6)`, `neighbor_max = max(wet[n] for each active
   N/E/S/W neighbor, else 0)`, `target = baseline.max(neighbor_max * wet_spread_decay)`,
   `wet_next[idx] = wet[idx] + (target - wet[idx]) * wet_diffuse_rate`. After the full pass:
   `std::mem::swap(&mut self.wet, &mut self.wet_next)`.
3. **Apply deltas**, in this order (order among these four is safe — they touch disjoint or
   idempotent state): FuelDecay (`fuel[idx] = new_fuel`) → Burnout (write through the SAME
   active-chunk write path `set_material` already uses, so it pushes exactly one `events` entry
   and rides the EXISTING event-drain → `rebakeTiles` pipeline in `main.ts` — burnout is a real
   material change and DOES need a rebake, unlike the glow overlay's own per-frame flicker, which
   must not; after writing, also reset that tile's fire identity to its new material:
   `fuel[idx] = mat_prop(new_mat, 4); wet[idx] = wet[idx].max(mat_prop(new_mat, 6)); burn[idx] = 0.0`)
   → Extinguish (`burn[idx] = 0.0`) → Ignite (`burn[idx] = 1.0`; if a tile was scheduled to ignite
   by two different burning neighbors this tick, the second write is a no-op — safe by construction).

Refactor `set_material`'s active-chunk branch into a small private `fn write_active(&mut self,
slot, tx, ty, mat)` (checks-if-changed, writes `slots`, pushes the event pair) so both the public
`set_material` and `fire_step`'s Burnout application call the identical code — one code path, one
place that can push an event, exactly the reuse the ROADMAP asks for.

### cargo test coverage (minimum, new)
- `fire_ignite_and_burn_out_produces_burns_to_override` — ignite GRASS, tick past its fuel,
  assert `override_at == 10` (ASH) and `burn_at == 0`.
- `fire_spread_is_deterministic_given_seed_and_ticks` — two fresh `Core`s, same seed, same
  ignition, same tick count → identical `burn_at`/`override_at` footprint over a small neighborhood.
- `fire_extinguished_by_rising_wetness_near_water` — ignite a FOREST tile (long fuel) adjacent to
  WATER, tick until wet crosses threshold (converges in single-digit ticks given the defaults —
  see the acceptance checklist's math), assert `burn_at == 0` while `fuel_at > 0` (extinguished,
  not naturally burned out — the two must be distinguishable).
- `fire_does_not_ignite_wet_tile` — raise a tile's wet past threshold via diffusion, then assert
  `ignite()` returns `false`.
- `fire_wind_is_deterministic_from_seed` — two same-seed `Core::new`s agree on `wind_x`/`wind_y`.
- `fire_does_not_cross_into_inactive_chunk` — a burning tile at an active chunk's edge; the
  neighbor chunk is never activated; after many ticks, activating that neighbor chunk shows no
  override there (fire never touched it — unloaded chunks are simply not simulated).
- `campfire_refuels_indefinitely` — `add_campfire`, tick far past any material's natural fuel,
  assert still `burn_at > 0`.
- `campfire_removed_lets_fire_die_naturally` — `remove_campfire`, tick past the remaining natural
  fuel, assert it eventually reaches `burn_at == 0` via ordinary burnout.
- `set_materials_uses_uploaded_stride` — upload a stride-7 table with a known wetness value at a
  known offset, assert `mat_prop` reads it back correctly.
- Full existing R1 suite unaffected (override index refactor + STRIDE bump touch shared code paths).

## TS integration (file by file)

**`src/wasm/core.ts`**: add `memF32(ptr, count): Float32Array` alongside the existing `memI32`
(same throwaway-view-per-call pattern — memory may grow and detach prior views).

**`src/game/world/core.ts` (`WorldCore`)** — new passthrough methods, same style as the existing
`materialAt`/`setMaterial`:
```ts
ignite(tx: number, ty: number): boolean { return this.core.ignite(tx, ty); }
isBurning(tx: number, ty: number): boolean { return this.core.is_burning(tx, ty); }
fuelAt(tx: number, ty: number): number { return this.core.fuel_at(tx, ty); }
burnAt(tx: number, ty: number): number { return this.core.burn_at(tx, ty); }
wetAt(tx: number, ty: number): number { return this.core.wet_at(tx, ty); }
addCampfire(tx: number, ty: number) { this.core.add_campfire(tx, ty); }
removeCampfire(tx: number, ty: number) { this.core.remove_campfire(tx, ty); }
pushFireParams() { this.core.set_fire_params(packFireParams()); }
tick(dt: number) { this.core.tick(dt); } // console/test convenience — main.ts's render() already
                                          // calls the raw `core.tick(dt)` on the SAME underlying
                                          // instance; this is not a second, competing tick source
wind(): [number, number] { return [this.core.wind_x(), this.core.wind_y()]; }
/** Zero-copy view of a loaded chunk's 256 burn values, for the glow overlay. Re-fetch every call
 * (memory may have grown). null if the chunk isn't active. */
burnView(cx: number, cy: number): Float32Array | null {
  const ptr = this.core.burn_ptr(cx, cy);
  return ptr ? memF32(ptr, 256) : null;
}
```
Import `packFireParams` from `../data/config`.

**`src/game/world/art.ts`** — one new drawing primitive, sibling to `shadow()`:
```ts
/** Warm additive glow blob — same radial-gradient shape as shadow(), fire-colored. Meant to be
 * composited with Sprite blendMode 'add' on a per-chunk overlay canvas. */
glow(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, alpha: number) {
  if (r <= 0) return;
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  g.addColorStop(0, `rgba(255,170,60,${alpha})`);
  g.addColorStop(0.6, `rgba(255,90,20,${alpha * 0.5})`);
  g.addColorStop(1, 'rgba(255,60,10,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
}
```

**`src/game/world/chunkmap.ts`** — extend the per-chunk overlay mechanism R1.5 generalized (its
own learning note: "R2's fire glow follows the same `{sprite, tex}`-per-chunk-overlay shape but
re-renders continuously... don't invent a second mechanism, extend this one"):
```ts
interface Glow { view: Sprite; tex: Texture; canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D }
interface Chunk { sprite: Sprite; tex: Texture; foam: Foam | null; glow: Glow | null }
```
`tickGlow(nowMs: number)`, called once per render frame from `main.ts` alongside `tickFoam`,
gated to `CFG.fire.glowHz` (≤20Hz): for every LOADED chunk, read `world.core.burnView(cx,cy)`
(`null` for inactive — skip). Scan the 256 floats for any `> 0`. No fire and no existing glow →
skip. No fire but a glow exists (fire went out) → destroy it, set `glow = null` (matches
`destroyChunk`'s existing pattern for foam). Fire present and no glow → lazily create one (a
`CHUNK_PX`×`CHUNK_PX` canvas, `Texture.from(canvas)`, a `Sprite` with `blendMode: 'add'` added to
`this.layer`). Either way with fire present: clear the canvas, for every tile with `burn[i] > 0`
call `art.glow(ctx, px, py, 20, 0.5 * flicker)` where `flicker = 0.75 + 0.25 * hash2(tx, ty,
Math.floor(nowMs / 80) ^ 0x2f1e)` (reuse the existing `hash2` — a render-side-only flicker,
decoupled from the sim's strictly-boolean `burn` value, exactly the sim↔render split the ROADMAP
wants learned here), then `glow.tex.source.update()` (Pixi v8's `TextureSource.update()` — the
real, existing API for "I mutated the backing canvas, re-upload it"; confirmed present in the
installed `pixi.js` — this is the one thing in this pipeline that mutates a texture in place
instead of creating a fresh one per bake). `destroyChunk` additionally destroys `c.glow`'s view +
texture if present (mirror the existing foam cleanup).

Add `private lastGlowMs = -1;` and the `CFG.fire.glowHz` gate exactly like `tickFoam`'s existing
5Hz gate (import `CFG` from `'../data/config'`).

Test-only hooks, sibling to `hasFoam`/`debugPixel`:
```ts
hasGlow(tx: number, ty: number): boolean { /* mirrors hasFoam */ }
debugGlowPixel(tx: number, ty: number, offX = 16, offY = 16): [number,number,number,number] | null {
  /* mirrors debugPixel but reads c.glow.canvas instead of c.tex's backing resource */
}
```

## `src/game/systems/fire.ts` (NEW) — FireSystem
Owns every fire-adjacent gameplay rule; `World`/`WorldCore` stay generic simulation plumbing.
```ts
export class FireSystem {
  private ignitedByPlayer = new Map<string, { expectMat: number }>(); // tileKey -> what burnout should yield
  private dmgT = 0; // shared throttle timer for the burn-damage tick

  constructor(private ctx: any) {}

  /** F key / Ignite button: nearest eligible tile within reach, if the player carries a torch. */
  tryIgnite() {
    const { state, world, toast } = this.ctx;
    if ((state.player.inv.torch ?? 0) <= 0) { toast('You need a torch for that', 'bad'); return; }
    const target = this.findIgniteTarget();
    if (!target) { toast('Nothing to burn nearby', 'bad'); return; }
    this.ignite(target.tx, target.ty);
  }

  private findIgniteTarget(): { tx: number; ty: number } | null {
    // nearest tile within CFG.fire.reachTiles where MATERIALS[materialAt].flammable > 0,
    // !isBurning, fuelAt > 0 — same 5x5-tile scan shape as GatherSystem.findTarget
  }

  /** Direct action (also used by the console/acceptance harness). */
  ignite(tx: number, ty: number): boolean {
    const { state, world, worldCore, toast, log } = this.ctx;
    if (!worldCore.ignite(tx, ty)) { toast("That won't catch", 'bad'); return false; }
    const expectMat = MATERIALS[world.materialAt(tx, ty)].burnsTo;
    this.ignitedByPlayer.set(tileKey(tx, ty), { expectMat });
    const lvl = addXp(state, 'firemaking', CFG.fire.ignitionXp);
    toast('The flame catches.', 'good');
    log?.push('world', `Set fire to (${tx},${ty})`, state.clock);
    if (lvl) { toast(`Firemaking reached level ${lvl}!`, 'good'); log?.push('level', `Firemaking reached level ${lvl}`, state.clock); }
    return true;
  }

  /** Building placed/destroyed — campfires are literally an eternal ignition point on their tile. */
  onBuildingAdded(b: Building) { if (b.type === 'campfire') this.ctx.worldCore.addCampfire(b.tx, b.ty); }
  onBuildingRemoved(b: Building) { if (b.type === 'campfire') this.ctx.worldCore.removeCampfire(b.tx, b.ty); }

  /** Called from main.ts right after worldCore.drainEvents() — checks whether any changed tile
   * was a tracked controlled burn finishing, and pays out charcoal. */
  onWorldEvents(changed: [number, number][]) {
    const { world, state, toast, log } = this.ctx;
    for (const [tx, ty] of changed) {
      const key = tileKey(tx, ty);
      const tracked = this.ignitedByPlayer.get(key);
      if (!tracked) continue;
      this.ignitedByPlayer.delete(key);
      if (world.materialAt(tx, ty) !== tracked.expectMat) continue; // something else touched it
      if (Math.random() < CFG.fire.charcoalChance) {
        invAdd(state, 'charcoal', 1);
        const lvl = addXp(state, 'firemaking', CFG.fire.charcoalXp);
        toast('+1 Charcoal from the embers', 'good');
        log?.push('gather', `Collected charcoal from a controlled burn at (${tx},${ty})`, state.clock);
        if (lvl) { toast(`Firemaking reached level ${lvl}!`, 'good'); log?.push('level', `Firemaking reached level ${lvl}`, state.clock); }
      }
    }
  }

  /** Sim tick: entity burn damage, throttled so it reads as periodic ticks, not per-frame spam. */
  update(dt: number) {
    this.dmgT -= dt;
    if (this.dmgT > 0) return;
    this.dmgT = CFG.fire.burnTickSec;
    const dmg = CFG.fire.burnDmgPerSec * CFG.fire.burnTickSec;
    const { state, world, worldCore, hordes, damagePlayer } = this.ctx;
    const ptx = Math.floor(state.player.x / TILE), pty = Math.floor(state.player.y / TILE);
    if (worldCore.isBurning(ptx, pty)) damagePlayer(dmg, 'Fire');
    for (const f of hordes.foes) {
      const ftx = Math.floor(f.x / TILE), fty = Math.floor(f.y / TILE);
      if (worldCore.isBurning(ftx, fty)) hordes.hurt(f, dmg, false);
    }
  }
}
```
`tileKey`/`invAdd`/`addXp`/`MATERIALS`/`CFG`/`TILE` imports as elsewhere. Expose on `ctx.fire` and
`__nw.sys.fire` (main.ts wiring below).

## `src/game/systems/build.ts` + `src/game/systems/hordes.ts` — small hooks
`BuildSystem.commit()`: after `this.ctx.views.addBuilding(b);`, add `this.ctx.fire?.onBuildingAdded(b);`.

`HordeSystem.damageBuilding()`: after `views.removeBuilding(b.uid);`, add
`this.ctx.fire?.onBuildingRemoved(b);`.

`HordeSystem` gains a public method (no reason to hide it — matches the file's existing openness):
```ts
nearestCampfireDist(x: number, y: number): number {
  const { state } = this.ctx;
  let best = Infinity;
  for (const b of state.buildings) {
    if (b.type !== 'campfire') continue;
    best = Math.min(best, Math.hypot((b.tx + 0.5) * TILE - x, (b.ty + 0.5) * TILE - y));
  }
  return best;
}
```
Two call sites:
- `spawn()`: after picking a candidate `(x,y)` in the placement retry loop, also require
  `this.nearestCampfireDist(x, y) > CFG.fire.campfireFearTiles * TILE` (reject and retry, same
  shape as the existing `world.canStand` rejection).
- `updateFoe()`'s march step: `terrain` already scales speed by ground material; additionally
  multiply by `CFG.fire.campfireFearSpeedMult` when `nearestCampfireDist(f.x, f.y) <
  CFG.fire.campfireFearTiles * TILE` (foes hesitate near firelight — no pathfinding, just a speed
  penalty, cheap and legible).

## Content rows
- **`src/game/data/skills.ts`**: `{ id: 'firemaking', name: 'Firemaking', kind: 'gather' }` — the
  UI's skill panel loop is fully generic over `SKILLS`, no other UI change needed.
- **`src/game/data/items.ts`**: add `'torch' | 'charcoal'` to `IconKind`; add
  `I('torch', 'Torch', 'torch', '#c47b3b', '#ffd27a')` (no `toolClass`/soul-gear involvement —
  carrying ≥1 is checked directly via `invCount`, matching the brief's `tryIgnite`) and
  `I('charcoal', 'Charcoal', 'charcoal', '#232023', '#3a3a3e')`.
- **`src/engine/procgen/icons.ts`**: two new `case` blocks in `makeIcon`'s switch — `'torch'`
  (diagonal handle like `'axe'`/`'pick'`'s, topped with a small 2-3px flame shape in the accent
  color) and `'charcoal'` (2-3 small irregular dark rects, `darken(c, ...)` shading, like a
  miniature `'stone'` but smaller and near-black).
- **`src/game/data/buildings.ts`**: extend `BuildingDef['art']` to include `'campfire'`; add
  ```ts
  { id: 'campfire', name: 'Campfire',
    desc: 'Warmth, light, and a ward against the dark. Feeds on whatever tinder catches beneath it.',
    hp: 60, cost: [s('log', 3), s('stone', 2)], pop: 0, territory: 0, unique: false, art: 'campfire' },
  ```
- **`src/engine/procgen/sprites.ts`**: new `'campfire'` case in `makeBuilding`'s switch (~20×14px):
  a ring of small stone blocks (reuse the `STONE` ramp) around a crossed-logs base (`WOOD` ramp),
  with 1-2 warm ember pixels (`[255,170,60]`/`[255,220,140]`) at the center — the STATIC baseline
  sprite; the actual light/motion comes from the fire glow overlay treating this tile as a
  permanently-burning tile (see `add_campfire` above), so the sprite itself can be simple.
- **`src/game/data/recipes.ts`**: `R('torch', 'crafting', 1, 15, s('torch'), s('log', 1), s('stone', 1))`.

## UI — `src/game/ui/ui.ts`
`UIHooks` gains `ignite(): void`. Bind key **F** in `onKey` (`else if (k === 'f') this.hooks.ignite();`)
and add one more action-bar button in `buildActions()`, same shape as the existing ones:
`btn('nw-ignite', '🔥 Ignite', 'F')` → `.addEventListener('click', () => this.hooks.ignite())`.
`main.ts`'s `UI` construction passes `ignite: () => fire.tryIgnite()`.

## `src/main.ts` wiring
- Boot: after `worldCore` is constructed and before `newState`, no change needed there — but right
  after `const world = new World(...)` / system construction, add
  `const fire = new FireSystem(ctx); ctx.fire = fire;` (same "assign onto ctx after construction"
  pattern already used for `ctx.hordes`/`ctx.worldbosses` — read at call-time by build.ts/hordes.ts,
  construction order doesn't matter). Call `worldCore.pushFireParams();` once, right after
  `core.set_materials(packMaterials(), STRIDE);` and before `newState(...)` (mirrors the boot-order
  comment already in the file).
- `sim(dt)`: add `fire.update(dt);` alongside the existing `gather.update`/`combat.update`/etc calls.
- `render(alpha)`: add `chunks.tickGlow(performance.now());` next to the existing
  `chunks.tickFoam(performance.now());` call. In the existing tail —
  ```ts
  const changed = worldCore.drainEvents();
  if (changed.length) worldCore.bumpRebakes(chunks.rebakeTiles(changed));
  ```
  add `fire.onWorldEvents(changed);` (order relative to `rebakeTiles` doesn't matter — one's visual,
  one's inventory/xp).
- `__nw` additions: `sys: { gather, economy, build, hordes, combat, worldbosses, fire }`; and in
  `setupDebug`'s `NW = {...}` object, add `ENEMIES` (`NW = { CFG, state, MATS: MATERIALS, ENEMIES }`)
  — a small, harmless console-testability addition (mirrors why `MATS` is exposed) needed by the
  acceptance checklist's foe-burn-damage script, which constructs a synthetic `Foe` from the console
  since there's no synchronous "spawn one foe now" hook otherwise.

## Explicitly OUT of scope
- No pathfinding for the campfire fear radius — a flat speed multiplier within a fixed distance,
  not route avoidance. No fear effect on world bosses (rare, tanky, roam far — not the point of a
  campfire).
- No entity burn damage for world bosses this milestone (player + regular hordes foes only) — a
  natural, trivial follow-up (same `worldCore.isBurning` check) if wanted later.
- No smoke/particle plume, no directional wind visualization beyond the CA's actual spread bias.
- No fuel-consuming torch (it's a carried tool, unlimited uses, matching axe/pick) and no recipe
  consuming charcoal yet (a W7 loot-economy/smithing tie-in, not this milestone's job).
- No cross-chunk fire persistence through deactivation (documented deliberate simplification above)
  and no worldgen changes — fire only ever touches tiles via the existing override mechanism.
- No rain/weather interaction with `wet[]` (R4's job — "Water, growth & farming" explicitly owns
  weather events; this milestone's water source is purely the existing WATER/SHALLOW/DEEP/ICE/MUD
  material family via `wetness`).

## Acceptance checklist (post-merge verification contract)
Static, in the worktree: (1) `npm run wasm` + `npm run typecheck` + `npm run build` green;
(2) `cargo test` — every listed case (prereq index + fire suite + the full R1 regression set) passing.

Live on main, at `?seed=1234`, god mode ON unless an item says otherwise, each block ONE
synchronous eval (the harness ticker corrupts multi-eval sequences — W3 lesson). **Harness
gotcha from R1.5, still true**: the preview tab may render fully hidden (rAF never fires,
`__nw.frames` stays 0) — every script below starts by calling `worldCore.ensureAround` /
`chunks.ensureAround` directly rather than relying on a real-time wait for the render loop.
`core.tick(dt)` and `chunks.tickGlow(nowMs)` are render-loop methods — drive them explicitly with
looped calls inside the eval, never via `__nw.step()` (which only runs `sim()`).

3. **wetness data + determinism regression:**
   `MATERIALS.map(m=>m.wetness).join(',')` === `"1,1,0.1,0.05,0.05,0.1,0.05,0,1,0.05,0,1,0.6,0.05,0.15,1"`,
   AND the R1 100-sample `gen.tileAt` probe still matches a fresh boot at the same seed (confirms
   the STRIDE bump didn't touch worldgen).
4. **Ignite + burn state:** `worldCore.ensureAround(player.x, player.y, 800, 600)` then scan
   outward from spawn for a FOREST or GRASS tile `f` → `worldCore.materialAt` confirms it →
   `worldCore.ignite(f.tx, f.ty)` → `true`; `worldCore.isBurning(f.tx, f.ty)` → `true`;
   `worldCore.fuelAt(f.tx, f.ty) > 0`; a second `worldCore.ignite` on the same tile → `false`
   (already burning).
5. **Determinism of spread:** run the ignite-then-`for(i=0;i<50;i++) worldCore.tick(0.1)`-then-
   snapshot-a-7×7-neighborhood-of-`overrideAt`-values script once, record the joined string; reload
   at the same `?seed=1234`, `ensureAround` the same spot, run the identical script → identical
   string. Also: `worldCore.wind()` is a unit vector (`Math.hypot(...) ≈ 1`) and identical across
   two fresh same-seed boots.
6. **Burnout → override + rebake:** ignite a GRASS tile (fuel=2s), `for(i=0;i<25;i++)
   worldCore.tick(0.1)` (2.5s > its fuel) → `worldCore.overrideAt(tx,ty) === 10` (ASH),
   `worldCore.isBurning(tx,ty) === false`, `worldCore.stats.events` incremented by ≥1 since the
   ignite began.
7. **Extinguish by wetness:** find a FOREST tile (fuel=6s) adjacent to WATER/SHALLOW → ignite it →
   `for(i=0;i<15;i++) worldCore.tick(0.1)` (1.5s, well under its 6s fuel) →
   `worldCore.isBurning(tx,ty) === false` AND `worldCore.fuelAt(tx,ty) > 0` (proves extinguish, not
   natural burnout) AND `worldCore.wetAt(tx,ty) > CFG.fire.wetExtinguish`.
8. **Glow overlay:** before ignite, `chunks.ensureAround(...)`, `chunks.hasGlow(tx,ty) === false`.
   Ignite a tile in a loaded chunk, `chunks.tickGlow(performance.now())` → `chunks.hasGlow(tx,ty)
   === true` and `chunks.debugGlowPixel(tx,ty,16,16)[3] > 0` (non-transparent warm pixel where the
   fire is). Let it burn out (tick past fuel) then `chunks.tickGlow(performance.now()+1000)` →
   `hasGlow === false` again (overlay torn down once the fire's gone — not left as a permanent
   ghost sprite).
9. **Entity burn damage (player):** `state.god = false;` (burn damage no-ops under god mode, must
   toggle off for this one check), ignite a tile, teleport the player onto it (`state.player.hp =
   100; player.teleport(x,y); state.player.x=x; state.player.y=y;`), `__nw.step(Math.ceil(
   CFG.fire.burnTickSec/(1/30))+2)` → `state.player.hp < 100` by approximately
   `CFG.fire.burnDmgPerSec * CFG.fire.burnTickSec` (armor-adjusted, player carries none by
   default). Restore `state.god = true` afterward.
10. **Entity burn damage (foe):** construct a synthetic foe from `NW.ENEMIES` positioned on a
    burning tile, push it into `__nw.sys.hordes.foes`, `__nw.step(...)` past one burn tick,
    assert its `hp` dropped by the expected amount, then remove it from `foes` again (cleanup).
11. **Controlled burn → charcoal:** `CFG.fire.charcoalChance = 1;` (deterministic for the test,
    matching the existing "live re-upload" idiom from R1's checklist item 8), give the player a
    torch (`state.player.inv.torch = 1`), `sys.fire.ignite(tx,ty)` on a GRASS tile,
    `for(i=0;i<25;i++) worldCore.tick(0.1)` past burnout, `const changed = worldCore.drainEvents();
    sys.fire.onWorldEvents(changed);` → `invCount(state,'charcoal') > 0`.
12. **Campfire fear radius:** place a synthetic campfire (`state.buildings.push({uid:...,
    type:'campfire', tx, ty, hp:60}); world.reindexBuildings();`) → `sys.hordes.nearestCampfireDist(
    (tx+0.5)*32, (ty+0.5)*32) === 0` (roughly; same tile). Two synthetic foes at equal distance from
    a shared target, terrain-matched, one inside the fear radius and one well outside it → step
    both by the same `n` → the near foe's displacement ≈ the far foe's displacement ×
    `CFG.fire.campfireFearSpeedMult` (±10%).
13. **Determinism regression (perf-adjacent, cargo-only):** the prereq index test is a static
    check only — no live equivalent needed; a live sanity pass is simply "painting/igniting near a
    chunk boundary with many unrelated overrides elsewhere doesn't visibly hitch," covered
    qualitatively by items 4-8 above completing promptly.

**Playtest gate — this is the batch's flagship (per ROADMAP).** Fix `.claude/agents/playtest.md`'s
stale `mcp__Claude_Preview__*` tool list to the current `mcp__Claude_Browser__*` names first (own
small docs commit), then run the playtest agent; if it still can't drive the harness, run a
structured self-playtest covering: honest ignition via torch/campfire, spread rate vs CFG intent,
extinguish at water, burnout→ash+charcoal, entity burn damage, the controlled-burn charcoal loop,
and a night wave interacting with fire (does a burning patch actually deter/damage foes marching
through it). Present the evidence, then **STOP and ask the user's verdict** — do not start R3 or W5.

## Learning notes
- Cellular automata correctness is an ordering problem before it's a math problem: read a
  snapshot, compute every delta, apply once. Get that right and the rest (spread formulas,
  extinguish thresholds) is just tuning numbers in `CFG.fire`.
- Active-set simulation: fire only exists where the world is loaded, exactly like night hordes
  only exist near the hall. "The world doesn't simulate what nobody's near" is the same idea
  R1's sparse override store already taught, one level up (chunks, not individual tiles).
- Sim↔render decoupling made concrete: `burn` in Rust is a strict on/off signal ticked at a fixed
  10Hz; the flicker you'd actually see is entirely a render-side hash computed fresh every glow
  frame. Neither side needs to know about the other's cadence or details — that's the whole point
  of the boundary.
