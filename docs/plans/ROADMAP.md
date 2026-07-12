# NIGHTWARD — Roadmap (batches 2+; batch 4 "World Engine" is ACTIVE)

Status baseline: `v0.4-world-and-dread` (M0–M3 + World & Dread pass shipped).
This roadmap is the source of truth for the current batch. Each milestone is built in its
own worktree (see `docs/plans/WORKFLOW.md`) and has a detailed brief `docs/plans/W<n>-*.md`
when it becomes the active task.

## Non-negotiables (keep these true)
- **100% procgen** — no hosted image/audio assets; everything is generated from seed + params.
- **Data-driven** — content is a row in `src/game/data/*`; systems are generic functions over one
  `GameState`. Adding content ≠ new engine code.
- Loose-mode TS + Vite + PixiJS v8 (WebGPU, `?gl` forces WebGL). Determinism from seed.
- `npm run typecheck` clean and `npm run build` green before any merge.
- **No persistence (added 2026-07-07).** No save/load, no localStorage/IndexedDB state, no
  login/logout. The game exists only in the currently-open tab; closing/reloading/rebooting
  loses the character — that's the point (see decision below). Every milestone's "verify"
  step drops the old "bump save.ts + migrate" requirement entirely.
  *Amended (2026-07-07, scoreboard carve-out):* finished-run **results** (character age, nights
  survived, seed, date) may persist locally for the oldest-character board. Outcomes, not state —
  a run can never be resumed from them, so the anti-save-scum intent stands untouched.

## Architectural decisions
- **360° animation — SHIPPED THEN REVERTED (2026-07-07).** Built a parametric rig (ordered parts,
  whole-body rotation toward a float `facing`, local per-part animation) and migrated the player to
  it in W1 (`v0.6-w1-player`). Playtest verdict: disliked the look, and correctly pointed out movement
  is keyboard-driven (a handful of discrete directions), so true continuous 360° rotation doesn't pay
  for itself. Reverted back to the original baked 4-direction frames (`makePlayerFrames`, `Facing =
  'down'|'up'|'left'|'right'`) — see the revert fix commit right after `v0.7-w2-soulgear`. The rig
  files (`engine/procgen/{parts,rig}.ts`, `world/rigview.ts`) were deleted; `docs/plans/W1-rig.md` is
  kept as a record of the approach and why it didn't stick. **Any future animation work should assume
  4-direction baked frames as the baseline**, not rebuild the rig, unless the user asks for it again.
- **Weighty combat = attack state machine** `windup → active(hit-window) → recovery`; damage only in
  the active window; `attackSpeed` scales the envelope. Numbers in `config.ts`. *(Re-scoped after the
  rig revert:)* phases drive the existing sprite + slash effect (windup tint/scale-pulse, slash during
  the active window) — NOT rig poses. Spin/channel was premised on float facing; with 4-direction
  facing it becomes a full-circle radial burst, or gets cut — it no longer "falls out" of anything.
- **Soul Gear = soul-bound instanced gear** (tools/weapons/armour/rings/amulets/charms/inventory-size),
  each an instance with its own `level`/`xp` on a RuneScape-scale curve, leveling by use + fed materials,
  upgrades gated on rare + boss loot. Inventory model changes: materials stay stackable counts, gear
  becomes uid'd instances.
- **Sound** — the WebAudio synth *is* the tiny embedded generator; scale variety with a data-driven SFX
  recipe table, not a neural model.
- **"Tiles ×4"** — decouple art-resolution from the 32px sim tile (raise procgen detail, keep `TILE=32`)
  and add multi-tile resource nodes separately.
- **Zoom/LOD/dream-regen** — wheel/pinch zoom + LOD chunk streaming; unowned terrain regenerates from a
  slow "dream phase" seed, owned territory pinned constant.
- **Event log** — ring-buffer bus + UI panel + `window.__nw.log`; built in W0 so later systems emit to it.
- **Content-first pivot (2026-07-07, post-W3 playtest).** User verdict after playing the W3 build:
  nights too easy, leveling ~10× too fast, the day needs prey to hunt, and loot needs sinks (feed
  soul gear / fund building). Batch-2's remaining engine/feel work (multi-res art, dream-regen,
  action polish) is deferred behind a content batch (new W4–W8 below). Zoom got pulled forward out
  of the old zoom/LOD/dream-regen milestone because the user asked for it directly.
- **Hosting (2026-07-07).** The game is a static Vite build with zero backend — GitHub Pages hosts it
  as-is (push repo → enable Pages → build via Action, set Vite `base` to the repo name). One limit:
  Pages is static-only, so the "oldest character ever, across everyone" leaderboard needs a separate
  tiny backend/serverless store later; the local (this-browser) board works on Pages today.
- **No persistence, ever.** `state = newState(seed, spawn)` on every boot, full stop. No save file,
  no autosave, no "continue" button — one open tab is one instance of one character. Closing the
  tab, refreshing, or a crash/reboot ends that character permanently (in-run death already respawns
  you via the roguelike scatter; only losing the Hall or closing the tab ends things for good). This
  is on-theme (dream-world, nothing persists but what you've claimed *while you're in it*) and it's
  what makes a future highscore/leaderboard interesting — no one can safety-scum a save, every run
  that reaches a leaderboard actually survived. A real leaderboard needs a backend, which is still
  explicitly out of scope for this batch — noted here as a later idea, not a milestone.

## Milestones (one worktree each, in order)
- **W0 — Foundations & fixes** ✅ shipped `v0.5-w0`: build-menu input-trap fix, auto-connecting walls,
  event log, data-driven SFX table. Brief: `docs/plans/W0-foundations.md`.
- **W1 — 360° rig animator** ✅ shipped `v0.6-w1-player`, then **reverted** (2026-07-07) — disliked the
  look, and keyboard-only movement doesn't need continuous rotation. Back to 4-direction baked frames.
  Brief (historical): `docs/plans/W1-rig.md`.
- **W2 — Soul Gear** ✅ shipped `v0.7-w2-soulgear` (weapon/armor/tools pass; simplified from uid'd
  instances to per-slot soul-bound leveling — see `docs/plans/W2-soulgear.md`). Rings/amulets/charms
  and the inventory-size "Soul Satchel" deferred (need new content, not just systems work).
- **W3 — Weighty combat** ✅ shipped `v0.8-w3-combat` (2026-07-07): player `attack()` now runs
  `windup → active (damage resolves once here) → recovery` instead of an instant flat-cooldown hit;
  pressing during recovery buffers one queued swing, mid-swing presses are ignored; envelope duration
  scales down with weapon soul level (floored at 0.5×); movement slows mid-swing; sprite tints/squashes
  on windup and desaturates on recovery. Foes/bosses gained a data-driven `telegraphSec` tell (blinking
  warning tint + SFX) — a committed hit only lands if the player is still in reach (+ small slack) when
  it elapses, so stepping out during the tell whiffs it. All verified live via direct sim-state driving
  (see `docs/plans/W3-combat.md`'s verify section). **Spin/channel (hold-to-charge radial burst) was
  deferred**, per the brief's own escape hatch — it needs key-down/up hold tracking through
  `input.ts`/`ui.ts`/`main.ts` that the tap-based phase machine doesn't otherwise require, and
  phases+telegraphs were the actual milestone content. Revisit spin as its own small follow-up if
  wanted. Brief: `docs/plans/W3-combat.md`. **Playtest gate: STOP here** — combat *feel* is subjective;
  get the user's verdict before starting W4 (W1 lesson).
- **W4 — Day hunts & the balance pass** ✅ shipped `v0.9-w4-dayhunts` (2026-07-07): daytime prey
  mobs (data-driven `daytime` flag + `config.dayspawn`, wander/despawn/no hall aggro), night retune,
  ×10 xp curves. Brief: `docs/plans/W4-dayhunts.md`. The automated playtest agent
  (`.claude/agents/playtest.md`, added same day) screened the build and found two real aim bugs —
  fixed in the follow-up batch below. **Balance verdict from the user is still OPEN** (night
  pressure / grind speed); building-UX feedback arrived instead and was handled as fixes.
- **Fix batch v0.9.1–v0.9.3 (2026-07-08, on main, no worktree — bug fixes to shipped work):**
  `v0.9.1-aimfix` melee aim (true-angle swings via `player.aimAngle`, sticky diagonal facing,
  feet-anchored hit arc); `v0.9.2-buildux` build placement rework (click-through grace, press-aim/
  release-place, drag-paint walls, ghost grid + tower range ring, reason-specific errors, afford
  count in banner); `v0.9.3-godmode-logging` god/test mode on **U** (immortal + all items/skills —
  also unblocks the playtest agent), bosses smash palisades instead of phasing, info-level logging
  (every mob/boss attack, tower shot, spawn, equip/use; log ring 200→500).
- **W4.5 — Pixel UI skin** ✅ shipped `v0.10-w4.5-rpgui` (2026-07-10). **Pivoted per user: yoink
  RPGUI** (zlib license, bundled via npm — the brief's procgen-9-slice option was passed over).
  Amends the no-assets non-negotiable for UI CHROME only: RPGUI's frame/button/cursor art + the
  vendored OFL "Press Start 2P" font (`src/game/ui/fonts/`) are build-time-bundled; game art stays
  100% procgen. RPGUI's CSS is NOT imported — `styles.ts` consumes only its images via Vite asset
  imports, so layout/classes were untouched. Brief (historical option analysis):
  `docs/plans/W4.5-uiskin.md`. **Playtest gate: user verdict on the look still open.**
- **W4.6 — Trinket gear slots** ✅ shipped `v0.11-trinkets` (2026-07-10, user: "more gear slots
  then we flesh out progression"): ring (+dmg, levels on landed swings), amulet (+armor, levels on
  hits taken), charm (+day regen, levels on kills, ×10 from bosses) — three new soul-bound slots on
  the existing machinery (`ItemDef.trinket` routes `slotOf`). Six craftables + brute/wisp/boss
  drops. Also a danger pass: `perNight 5→5.5`, `hpGrowth 1.18→1.21`, `dmgGrowth 1.12→1.15` (night 1
  untouched — user is happy with the start). Deeper progression (soul-feeding, satchel, paper-doll)
  stays W7/W8 scope.
- **W5 — Zoom & the wide view** *(re-sequenced 2026-07-11: runs AFTER R2 — see Batch 4 below;
  R1/R2 rewrite chunk rendering, so the LOD baker gets built once, over the final world model)*:
  mouse-wheel (+ pinch) zoom, pulled forward from the old
  zoom/LOD/dream-regen milestone. Needs LOD chunk baking to stay performant zoomed out. Zoom-out is
  **capped at a wide tactical view** — the world is unbounded procgen, so "see the whole map" literally
  can't exist; a minimap of explored regions is the honest complement (candidate stretch scope).
  Dream-regen stays deferred (below).
- **W6 — Lifespan & scoreboards**: HUD age readout ("days dreamed" — `state.clock` is already the
  authoritative age; death-respawn doesn't reset it, only hall loss / tab close ends a character),
  a death/game-over scorecard, and oldest-character boards: this run, and this browser's all-time
  (uses the scores-only persistence carve-out in the non-negotiables). "Oldest ever, everyone" needs
  a backend — out of scope, but shape the local board's record format so a remote one slots in later.
- **W7 — Loot economy & soul-feeding**: enemy loot tables drop upgrade materials; **feed materials →
  soul-gear xp** (the "fed materials" half of the original Soul Gear concept, finally); hunts also
  supply building materials. This closes the intended core loop: hunt by day → feed gear / fund
  buildings → survive harder nights → grow territory → attract worse things.
- **W8 — Grid inventory & paper-doll**: limited-capacity inventory in the D2/PoE mold — items with
  w×h footprints in a grid (uniform-slot WoW-style cells are the documented fallback if tetris
  placement balloons; same cut-line pattern that worked for W3's spin). Paper-doll equip panel; the
  natural home for W2's deferred rings/amulets/charms and the "Soul Satchel" capacity upgrades.
  **Design sign-off gate:** agree the inventory style with the user BEFORE building — look/feel milestone.

## Batch 4 — The World Engine (R-batch: Rust/wasm runtime world) — ACTIVE (approved 2026-07-11)

User verdict on the current world: too few blocks, nothing reacts — "no room for physics for
skills." Root cause: terrain is a pure function of (seed, x, y); the only runtime-mutable world
state is `depleted` + buildings. This batch makes the world **writable**, then **alive**, with a
Rust→WebAssembly core (`rust/nightward-core`) doing the heavy lifting. Rust is a deliberate
learning-experience choice — at tile scale JS typed arrays would suffice (honest math in the R0
brief) — so every module is designed "wasm-shaped" and the investment compounds if we later go
sub-tile (falling-sand scale, where Rust genuinely becomes necessary).

### Amended non-negotiables (this batch)
- **Two-language rule:** Rust is *generic machinery only* — the sim engine. ALL content and balance
  stays in TS data rows (`src/game/data/*`), flat-packed and uploaded into the core at init and
  re-uploadable at runtime, so `window.NW.CFG` live-editing keeps working. Adding a material or
  tuning fire spread must NEVER require touching Rust.
- **Boundary style:** batch APIs only. World state lives in wasm linear memory as flat arrays; JS
  reads through zero-copy typed-array views; steady-state boundary crossings are O(1) per frame
  (`tick`, event drain) — never per-tile call loops. Changes flow out via an event ring buffer.
- Determinism stands: base world stays a pure function of seed; sim RNG is a counter-based hash
  seeded from the world seed; wasm float semantics are IEEE-deterministic across machines.
- No persistence stands: overrides and fields die with the tab. On-theme and saves us a save format.
- `src/wasm/pkg/` (wasm-bindgen output) and cargo build dirs are build artifacts — gitignored,
  rebuilt locally via `npm run wasm` and in CI.

### Toolchain decisions (details + steps in the R0 brief)
- rustup with the **`stable-gnu` host toolchain** (avoids the Visual Studio Build Tools install;
  MSVC is the documented fallback) + `wasm32-unknown-unknown` target; **wasm-pack via its npm
  package** (prebuilt binary — never `cargo install` it).
- **Cargo target dir = `node_modules/.cargo-target`** (set in `rust/nightward-core/.cargo/config.toml`):
  OneDrive does not sync `node_modules`, so multi-GB build churn never hits the sync client, and
  git already ignores it. The repo lives inside OneDrive — this is load-bearing, don't skip it.
- deploy.yml gains a Rust toolchain step; `npm run build` runs the wasm build first.

### Re-sequencing the W-queue
- **W5 (zoom/LOD) moves AFTER R2** — R1/R1.5/R2 rewrite chunk rendering (effective materials +
  autotile/depth bake + dynamic field overlay); build the LOD baker once over the final model
  instead of three times. Order within the batch: R1.5 (art) → R2 (fire) → then W5.
- W6 (lifespan/scoreboards) is independent — a fine breather between R-milestones if wanted.
- W7 (loot economy) gets richer inputs from this batch: charcoal/ash (fire), crops (farming).
- W8 (grid inventory) unaffected.

### Brief convention (this batch)
R-briefs are **implementation-grade**: exact file contents/contracts an implementer follows
without inventing APIs, ending in an **Acceptance checklist** that is the post-merge verification
contract (run verbatim — single-eval blocks at a fixed `?seed=`, per the W3 harness lesson).
R1.5–R4 get their briefs written to this standard when they go ACTIVE (after the preceding gate
passes), never earlier — pre-written briefs go stale (W1 lesson; the R1 implementation will
reshape R2's details).

### Milestones (one worktree each, in order)
- **R0 — Rust toolchain + wasm spike.** rustup/wasm-pack install, `nightward-core` crate, `ping()`
  + zero-copy checkerboard demo baked to a debug texture, Vite + deploy.yml integration,
  `window.__nw.core`. No gameplay changes. Brief: `docs/plans/R0-rust-spike.md`.
  *Learn: what wasm, linear memory, and wasm-bindgen actually are.*
  - **Deviation (2026-07-11):** wasm-pack does **not** honour `build.target-dir` from
    `.cargo/config.toml` — it hardcodes `<crate>/target` when locating the compiled `.wasm`, so
    cargo (which builds into `node_modules/.cargo-target`) and wasm-pack disagreed and the build
    failed (fails on CI too, same reason). wasm-pack *does* honour the `CARGO_TARGET_DIR` env var,
    and an absolute value is resolved identically by cargo and wasm-pack. Minimal fix: the `wasm`
    npm script is `node scripts/wasm.mjs`, a tiny wrapper that sets `CARGO_TARGET_DIR` to the
    absolute `node_modules/.cargo-target` and spawns wasm-pack. The `.cargo/config.toml` is kept —
    it still routes bare `cargo test`/`cargo build` to the same dir (so `rust/nightward-core/target`
    never appears). Everything else in the brief is verbatim.
- **R1 — The writable world.** `data/materials.ts` supersedes the biome table (~16 materials: the
  9 existing + dirt, ash, ice, mud, gravel, tilled soil, shallow water); wasm chunk-slot pool with
  a sparse override store; `set_material` + changed-tile events → chunk rebakes; walkability +
  movement speed from material props; god-mode paint brush. Rule: an override REMOVES the procgen
  feature on that tile (the world remembers your touch). Brief: `docs/plans/R1-writable-world.md`.
  **Merged + tagged `v0.13-r1-writable-world` (2026-07-12).** All 9 Rust unit tests pass; typecheck/
  build green (one `.wasm` in dist, 30.48 kB); all 9 live acceptance items verified on main at
  `?seed=1234` (ice-bridge undo, feature kill+return, mud speed ratio 0.55±0.1, persistence across
  chunk deactivate/reactivate, determinism, live `pushMaterials` re-tune, events→rebake counters
  incl. no-dupe-on-same-value, chunk-pool perf/exhaustion sanity via 196-chunk stress test, buildable-
  false on ICE). One caveat found during verification: `window.__nw.step(n)` (the deterministic
  test-advance hook) only calls `sim()` — it does **not** run `ensureAround`/`drainEvents`/
  `rebakeTiles`, which live in the rAF-tied `render()` loop. Scripted movement tests must paint a
  vertically-thick pad (canStand samples a row 8px above the feet — a 1-tile-thick strip causes
  false collisions against the row above) and use real wall-clock waits (not `step()`) to observe
  event/rebake counters. Also: this preview harness does not reliably hold synthetic keydown state
  across a real-time wait (backgrounded-tab throttling/blur), so "sprint across the world" perf
  checks are better done via direct `_activate()` stress than simulated held-key movement.
  **Playtest gate — RESOLVED 2026-07-12.** Automated pass (static review — the playtest agent's
  tool list was stale, since flagged for repair) found no logic bugs and matched the brief
  line-for-line; flags: DIRT vs MUD near-identical art (real gameplay stakes, 1.0× vs 0.55×),
  GRAVEL's −5% likely imperceptible, ICE not actually "risky" until R3, build-rejection toast
  doesn't name the blocking terrain. User verdict: mechanics/speed unchallenged, but the world's
  LOOK is the problem — "kinda looks disappointing currently tbh," asked about triangles and
  "art that makes it look a lil more 3d." Verdict spawns **R1.5** (below); the DIRT/MUD and toast
  flags fold into it. *Learn: sparse overlays — "the world is a database whose default value is a
  function"; zero-copy views.*
- **R1.5 — The Painted World (look & depth pass).** Direct answer
  to the R1 gate verdict: the world reads as a flat checkerboard of colored squares; make it read
  as a *place* — without changing what a tile IS. Brief: `docs/plans/R1.5-painted-world.md`.
  **Merged + tagged `v0.14-r15-painted-world` (2026-07-12).** No Rust changes (pure rendering +
  data, as scoped); typecheck/build green, all 9 Rust tests unaffected. All 9 live acceptance
  checks verified on main at `?seed=1234`: heightClass data row, determinism regression, dual-grid
  feather (border pixel measurably nudged toward the outranking neighbor while the tile interior
  stayed pure), cliff shading (south edge summed-RGB 177 vs north-edge 413 on the same painted HILL
  tile), contact shadow (smooth radial falloff profile around a natural tree, distinct from the
  trunk's hard silhouette), foam presence+animation (shoreline chunk `hasFoam===true`, inland
  `false`, frame-to-frame fleck pixels differ), DIRT/MUD legibility (re-ramped, summed-channel diff
  262, MUD darker as designed), build-rejection toast naming ("Can't build on Ice"), and the
  4-directional rebake dedupe (painting a chunk-west-edge tile rebuilt exactly 2 chunks: own +
  west neighbor). **New harness gotcha, worth its own note:** this session's preview tab ran with
  `document.hidden === true` at the true browser level (not just the JS-visible flag — overriding
  `document.hidden`/`visibilityState` via `defineProperty` did NOT restart it), so `requestAnimationFrame`
  never fired, `__nw.frames` stayed `0` for the whole session, and `main.ts`'s `render()` (chunk
  streaming, event-drain rebakes, foam ticking, UI refresh) never ran on its own — real-time waits
  are useless here. Screenshot/zoom calls hung and timed out (30s) rather than returning a blank
  frame, consistent with the renderer never having composited anything. Worked around it by calling
  the render-side methods directly through the console instead of waiting on rAF:
  `worldCore.ensureAround`/`chunks.ensureAround` to bake chunks on demand, `chunks.rebakeTile`/
  `rebakeTiles` to force a rebake instead of relying on the automatic event-drain path, and
  `chunks.tickFoam(ms)` to step the foam frame explicitly. TS `private` class fields are NOT runtime-
  enforced, so `__nw.chunks.chunks` (the private chunk map) was reachable from the console for deep
  pixel-level assertions when the public `debugPixel` hook (which only reads the base canvas, not
  overlay layers like foam) wasn't enough. Screenshots could not be captured this session — visual
  proof is the quantitative pixel-probe evidence above instead of images.
  **Playtest gate — STOP after tagging, OPEN:** next step is the playtest agent or a structured
  self-playtest, then the user's verdict on the look. Do not start R2 first.
  **Decision recorded — square tiles stay.** Triangles/hexes were considered and rejected: cell
  shape is load-bearing everywhere (16×16 chunk arrays in wasm, CA neighbor math R2 depends on,
  collision feet-box, feature placement, bake layout) — retiling all of it, in two languages,
  buys nothing that *presentation* can't buy cheaper. "Looks 3D" is a rendering property, not a
  topology property (LttP/Stardew are square grids). Revisit only if a future milestone needs
  non-square *gameplay* semantics.
  Scope sketch (implementation-grade brief written at activation, per batch convention):
  1. **Dual-grid autotile transitions** — the render pass samples the 4 nearest tile corners
     (marching-squares/dual-grid) and bakes procgen transition masks between materials: feathered
     grass↔dirt, foam-lipped water edges, blended biome borders. This alone kills the hard-square
     look. Must read through `world.materialAt` (override-aware) and stay compatible with
     `rebakeTiles` (a paint dirties up to 4 render cells around it — the dedupe already handles
     neighbor chunks via the south-border rule; extend it, don't fork it).
  2. **Pseudo-3D height ledges** — each material gets a small `heightClass` (data field: water 0,
     ground 1, hill 2, mountain/snow 3); where height drops toward the viewer (south edge), bake a
     short darker cliff-face strip + a light top-lip highlight. Terraced depth, zero geometry.
  3. **Contact shadows** — soft baked ellipse under trees/rocks; drop shadow under buildings and
     entities (sprite-level, cheap).
  4. **Water life** — 2–3 frame shoreline-foam animation (alternate baked chunk frames or a small
     overlay sprite pass at ≤5 Hz, NOT per-tile sprites; the R2 fire overlay will reuse whichever
     mechanism this builds).
  5. **Material legibility pass** — re-ramp DIRT vs MUD so they're tellable at a glance (playtest
     flag; art is data, `MaterialDef.art`), make TILLED read as furrows, keep the 9 original biome
     hues recognizable.
  6. **Toast fix (rider):** `canPlaceAt` rejection names the blocking material ("can't build on
     Ice") — closes the other playtest flag.
  Constraints: 100% procgen art (non-negotiable stands), everything still per-chunk baked canvases
  (perf), bake cost per chunk stays same order of magnitude (LOD/zoom is W5's problem, don't solve
  it here). **Playtest gate — look milestone, STOP after tagging for the user's verdict.**
  *Learn: dual-grid autotiling, painter's-algorithm depth cues on a flat grid.*
- **R2 — Fire (the living world, part 1).** Per-active-chunk fuel/burn/wet fields, 10 Hz cellular-
  automata tick in Rust: spread driven by material flammability + a slow wind drift, burnout →
  `burnsTo` override (forest → ash + charcoal drops), burn damage to entities standing in it,
  water/wetness extinguishes. New overlay renderer (per-chunk 16×16 RGBA glow texture, ≤20 Hz,
  additive — NOT base-chunk rebakes; a spreading fire must not thrash the baker). **Firemaking
  skill** (data rows): torch tool, campfire building (small light + night-fear radius), controlled
  burns for charcoal. `CFG.fire` uploaded + live re-upload. Brief: `docs/plans/R2-fire.md`.
  **Prereq noted at R1 review (2026-07-12):** `Core::activate_chunk`'s override-drain scans ALL
  overrides (O(world), not O(chunk)) — fine at god-brush scale, but fire will mass-produce standing
  overrides while chunk streaming churns; add a chunk-keyed override index in the core as R2's
  first task. **Merged + tagged `v0.15-r2-fire` (2026-07-12).** Prereq done first as its own commit
  (`overrides_by_chunk` index; cargo test proves 100 chunk activations stay fast with 50k unrelated
  overrides present elsewhere). 20 Rust unit tests pass (11 R1 regression + 9 new fire tests
  covering ignite/burnout, cross-instance spread determinism, wetness extinguish/ignition-refusal,
  wind determinism, inactive-chunk isolation, campfire refuel/die-out, uploaded-stride unpack);
  typecheck/build green (one `.wasm` in dist, 51.39 kB). All 10 live acceptance items verified on
  main at `?seed=1234`: wetness data row + determinism regression, ignite/burn-state, **spread
  determinism** (identical 11×11 override footprint across two independent fresh boots given the
  same seed+ignition+50 ticks — confirms the snapshot-read/collect-deltas/apply-once CA discipline
  actually decouples the result from Rust's randomized HashMap iteration order), burnout→ASH
  override with rebake events, wetness extinguish (a shoreline FOREST tile doused with fuel still
  >0, proving extinguish ≠ natural burnout — this one required activating the WATER neighbor's
  chunk too, not just the ignited tile's, a live harness lesson worth keeping), fire glow overlay
  lazily created/torn-down exactly tracking "does this chunk have any burning tile" (verified a
  wildfire spreading within one chunk correctly keeps the glow alive after the originally-ignited
  tile itself burned out, and tears down only once the whole local fire is out), player + foe burn
  damage (traced exact hp deltas against the shared damage-tick timer and concurrent day regen —
  numbers matched the CFG math precisely once both effects were accounted for), controlled-burn
  charcoal payout, and the campfire fear radius (spawn-rejection distance exact, and an A/B
  same-path speed-multiplier test on a synthetic foe landed the ratio at exactly
  `campfireFearSpeedMult` = 0.5). **New harness note:** this session's preview tab was again
  `document.hidden === true` at the browser level (same R1.5 gotcha) — every check drove
  `worldCore`/`chunks` methods directly via console rather than waiting on rAF; no screenshots
  attempted (would hang) — evidence here is the quantitative traces above.
  **Playtest pass (2026-07-12):** fixed the playtest agent's stale `mcp__Claude_Preview__*` tool
  list first (own commit). The agent itself was granted no browser tools this run (a harness
  issue, not a repo issue) and fell back to a static code trace instead of live play — flagged
  explicitly in its own report as unverified-live. That trace still caught one real **HIGH**
  bug: `main.ts`'s `render()` fed the fire CA a *fixed* `STEP/1000` dt on every rendered frame
  instead of the real elapsed time, so the true wall-clock tick rate scaled with display refresh
  (~2× too fast at 60Hz, ~4.8× at 144Hz) — exactly backwards from "paces itself independent of
  render fps," and invisible to every acceptance-checklist script because those all drive
  `worldCore.tick(dt)` directly with a correct dt, bypassing the buggy call site entirely. Fixed
  (real per-frame elapsed ms, clamped for tab-sleep) + two smaller correctness/UX bugs it also
  found (`ignitedByPlayer` tracking leaked when a tracked ignition was doused rather than burning
  out — a periodic sweep now drops those; `findIgniteTarget` could offer a too-wet tile that
  would then fail with a generic error — now filtered out up front). All three fixes verified
  live at `?seed=1234`. Tagged `v0.15.1-r2-fire-fix`. The agent also raised open **balance
  questions** for the user's verdict, not unilaterally patched: whether the wetness plume's ~3-4
  tile reach from any water body under-eager-extinguishes shoreline fires, whether a lone GRASS
  ignition's spread-vs-2s-fuel race is too tight to read as "spreading," whether buildings should
  take any damage from fire under them (currently immune, though the campfire's flavor text
  implies otherwise), and a fire-farming loophole (a campfire/controlled burn passively kills
  wandering foes for gold+loot with zero player risk, XP suppressed but not the rest).
  **Playtest gate — this is the batch's flagship, STOP after fixes:** awaiting the user's verdict
  on feel + the balance questions above before starting R3 or W5. *Learn: cellular automata,
  active-set simulation, sim↔render decoupling.*
- **R3 — Physical skills.** Entity kinematics in TS: knockback impulses on weapon hits, ice
  slides, mud slows, foes knocked into deep water drown; ground-slam skill (radial impulse +
  scorched crater ring via `set_material`); freeze verb (water→ice with a TTL decay queue in the
  core — ice melts back); Excavation skill (dig for clay/gravel/rare finds). Mostly TS — the core
  only adds TTL decay. **Playtest gate.** *Learn: impulse integration, material-driven movement.*
- **R4 — Water, growth & farming (the living world, part 2).** Wetness spread + rain events
  (`CFG.weather`); dug pits beside water flood into shallow water → **moats that actually block
  night mobs** (tower-defense payoff); growth field regrows grass/saplings over ash/dirt across
  in-game days; Farming skill: till → plant (planted feature-overrides, the replanting half of
  R1's rule) → grow → harvest crops (food/cooking hook, W7 synergy). Candidate: unify `depleted`
  into the override system. **Playtest gate.** *Learn: coupling multiple CA fields.*
- **R5 — stretch, unscheduled.** Port worldgen itself into the core (SINGLE source — delete the TS
  fbm path and batch-generate per chunk; never maintain two implementations) to make more
  octaves/sub-biomes/materials cheap; flow-field pathfinding for big hordes; far-future: sub-tile
  falling sand — the scale where Rust stops being a hobby and becomes the requirement.

### Deferred (old batch-2 back-half — engine/feel work, revisit after W8)
- **Multi-res art + multi-tile resources** (old W4): `SUBPIX` detail factor in `engine/procgen/sprites.ts`;
  `FeatureDef.footprint?:{w,h}` multi-tile nodes across worldgen/world/chunkmap/gather.
  **Sign-off gate (W1 lesson):** bake 2–3 representative sprites at ×2/×4 in a side-by-side debug view
  and get the user's verdict BEFORE migrating the whole pipeline. SUBPIX×4 = 16× the pixels per chunk
  bake — measure bake time + texture memory; coordinate with the LOD baker that W5-zoom will now have
  already touched (both rewrite `chunkmap.ts`).
- **Dream-regen + owned-territory pinning** (rest of old W5): unowned terrain regenerates from a slow
  dream-phase seed, owned territory pinned. Watch: depletion state (`world.isDepleted`) is keyed by
  tile coords, so regenerated terrain must clear it (no ghost stumps), and regen must never visibly
  rewrite terrain near the player mid-run.
- **Action-feedback polish** (old W6): gather/mine/harvest sprite animations (bounce/tint/particle —
  no rig, it's gone) synced to SFX, node shake + depletion poof, log wiring.

## Verification (every milestone)
- `npm run typecheck` clean; `npm run build` green; bundle stays lean (procgen, no assets).
- Live: `preview_start` `nightward-dev`. The harness tab renders hidden (rAF paused) → verify logic via
  `window.__nw.step(n)` + eval and the event log; visual check by foregrounding the preview panel.
- Determinism preserved (same seed → same world/gear rolls). No save/load to roundtrip — a fresh
  `newState()` on every boot is itself the correctness check; don't reintroduce persistence.
