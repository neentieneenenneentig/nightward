# NIGHTWARD — Batch 2 roadmap: The Living World & Soul Gear

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
- **W4.5 — Pixel UI skin** *(active next — user verdict 2026-07-10: "awesome polished feel", DOM
  UI clashes with the game art)*: re-skin the existing DOM overlay with **procgen 9-slice pixel
  chrome** (seeded canvas panels/buttons → CSS `border-image` data-URIs, palette sampled from the
  game's own art) instead of adopting an off-the-shelf pixel CSS kit. No layout or logic changes —
  `styles.ts` + a new `engine/procgen/uiskin.ts`. Brief: `docs/plans/W4.5-uiskin.md`.
  **Playtest gate** — pure look milestone, user verdict before W5.
- **W5 — Zoom & the wide view**: mouse-wheel (+ pinch) zoom, pulled forward from the old
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
