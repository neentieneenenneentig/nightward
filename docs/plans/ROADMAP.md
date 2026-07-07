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
  the active window; `attackSpeed` scales the envelope. Phases are rig poses. Spin/channel AoE-with-
  falloff falls out once facing is a float. Numbers in `config.ts`.
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
- **W3 — Weighty combat + channeling** *(re-scope needed — no longer "needs W1")*: attack state machine
  in `systems/combat.ts`, `attackSpeed` from equipped weapon soul-level, spin/channel AoE with falloff,
  enemy telegraphs. Phases should drive the *existing* 4-direction frame swap (a windup/recovery tint or
  brief scale-pulse, say) rather than rig poses, since the rig is gone.
- **W4 — Multi-res art + multi-tile resources**: `SUBPIX` detail factor in `engine/procgen/sprites.ts`;
  `FeatureDef.footprint?:{w,h}` multi-tile nodes across worldgen/world/chunkmap/gather.
- **W5 — Zoom + LOD + dream-regen**: wheel/pinch zoom, LOD chunk baking, dream-phase regen with owned-
  territory pinning.
- **W6 — Action-feedback polish**: gather/mine/harvest rig animations synced to SFX, particles, log wiring.

## Verification (every milestone)
- `npm run typecheck` clean; `npm run build` green; bundle stays lean (procgen, no assets).
- Live: `preview_start` `nightward-dev`. The harness tab renders hidden (rAF paused) → verify logic via
  `window.__nw.step(n)` + eval and the event log; visual check by foregrounding the preview panel.
- Determinism preserved (same seed → same world/gear rolls). No save/load to roundtrip — a fresh
  `newState()` on every boot is itself the correctness check; don't reintroduce persistence.
