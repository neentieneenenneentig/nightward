# W0 — Foundations & fixes

Branch: `feat/w0-foundations`. Five independent pieces; land them as separate commits.
Read `ROADMAP.md` for context and `WORKFLOW.md` for the loop. Optional wall `orient` field
(see §2) is fine to add to `GameState` — there is no save file to migrate (see §0).

---

## 0. Rip out persistence  `feat:`
**New decision:** no save/load, ever. The game exists only in the currently-open tab; closing,
reloading, or a reboot loses the character — that's intentional (permadeath-per-session, and it
keeps a future highscore board honest since no run can be save-scummed).

**Do:**
- Delete `src/game/save.ts`.
- `src/main.ts`: remove the `loadFor`/`saveNow` import; `boot()` always does
  `const state: GameState = newState(seed, spawn);` (drop the `loadFor(seed) ?? ` part). Remove the
  `saveT` accumulator and the autosave block in `sim()`. Remove the `saveNow(state)` call in
  `triggerGameOver()` (the game-over screen's "reload" button already yields a fresh character since
  nothing persists — that's correct, leave it).
- `src/game/data/config.ts`: delete the `save: { autosaveSec, keyPrefix }` block.
- Leave the roguelike in-run respawn system (`respawnMinTiles/MaxTiles`) alone — that's unrelated,
  it's what happens when you merely *die*, not when you close the tab.

**Accept:** no references to `save.ts`/`localStorage` remain in `src/`; reloading the page (same
`#s=` hash or not) always yields a brand-new character at spawn.

---

## 1. Fix: build menu traps input / can't attack  `fix:`
**Symptom (reported):** after opening Build and placing, you get stuck — clicks keep placing and you
can't attack. **Cause:** in `src/main.ts` the canvas `pointerdown` sends *every* click to
`build.place()` while `build.mode` is set, and wall-chaining (`systems/build.ts` `place()` keeps
`this.mode` alive while materials last) leaves you in build mode with only the Cancel banner / Esc to
exit — easy to miss, and there's no right-click/`B` escape and nothing on touch beyond the banner.

**Do:**
- `src/main.ts` canvas handlers: only **left** button places; add a `contextmenu` listener on the
  canvas → `preventDefault()` + `build.cancel()` when `build.mode`. Add a `keydown` for `b`/`B` and
  `Escape` that calls `build.cancel()` when `build.mode` is set (guard against typing in inputs).
- `src/game/ui/ui.ts`: pressing **B** while placement is active should cancel placement (not just
  toggle the panel). The existing `hidePanel()` vs `close()` split is correct — keep it; just make sure
  `Escape`/`✕`/scrim and the Cancel banner all reach `build.cancel()`.
- `src/game/ui/styles.ts`: make `.nw-buildbar` **pulse** (CSS keyframe on `box-shadow`/opacity) so the
  "you are placing" state is unmissable.
- Guarantee invariant: `build.mode` is truthy **iff** the banner is `.on`. `build.enter()` shows it,
  `build.cancel()` hides it; verify `place()` keeps it while chaining and clears it when it drops out.

**Accept:** during placement, right-click **or** Esc **or** B cancels; immediately after, attack works;
banner pulses; no way to get stuck. Attack still fires on left-click when not in build mode.

---

## 2. Wall orientation / auto-connect  `feat:`
Palisades should visually connect into runs, corners, T- and cross-junctions instead of identical posts.

**Do:**
- `src/engine/procgen/sprites.ts`: add `makeWall(mask, seed)` where `mask` is a 4-bit
  N=1,E=2,S=4,W=8 neighbor bitmask; draw a central post plus rails toward each connected side (16 cases,
  reuse the existing block/roof helpers and the current palisade palette). Cache by mask.
- `src/game/world/views.ts` `BuildingView`: for `type === 'wall'`, choose the texture by the live
  neighbor mask (query `world.buildingAt(tx±1,ty)` / `(tx,ty±1)` for walls). Add a `refresh()` that
  re-picks the texture.
- `src/game/systems/build.ts` `place()` (and horde `damageBuilding` removal in `systems/hordes.ts`):
  after a wall is added/destroyed, refresh the 4 neighboring wall views so runs re-connect.
- **Optional manual override:** add `orient?: 'h'|'v'` to `Building` (`state.ts`) and rotate the ghost
  with **R** in build mode; auto-connect is the default and is enough on its own — do it first.

**Accept:** placing adjacent palisades connects them; destroying one updates its neighbors' art.

---

## 3. Event log  `feat:`
An in-game activity/combat log — also our dev-visibility tool. Build this early; later pieces emit to it.

**Do:**
- New `src/game/systems/log.ts`:
  ```ts
  export type LogKind = 'gather'|'craft'|'build'|'combat'|'boss'|'level'|'death'|'region'|'economy'|'system';
  export interface LogEntry { t: number; kind: LogKind; msg: string; }
  export class GameLog {
    entries: LogEntry[] = [];
    constructor(private cap = 200) {}
    push(kind: LogKind, msg: string, clock = 0) {
      this.entries.push({ t: clock, kind, msg });
      if (this.entries.length > this.cap) this.entries.shift();
    }
    recent(n = 50) { return this.entries.slice(-n).reverse(); }
  }
  ```
- `src/main.ts`: `ctx.log = new GameLog()`; expose on the test hook: `window.__nw.log = ctx.log.entries`.
- Emit `ctx.log.push(kind, msg, state.clock)` alongside existing toasts in: `systems/gather.ts`
  (gather + level), `systems/crafting.ts` (craft + level), `systems/build.ts` (place/destroy),
  `systems/combat.ts` (player hit/kill, death), `systems/hordes.ts` (dusk/dawn, kills),
  `systems/worldbosses.ts` (warn/slain/revive), `systems/economy.ts` (tribute), and the region-crossing
  in `main.ts`. Keep messages one line; don't spam per-frame.
- `src/game/ui/ui.ts` + `styles.ts`: a new **Log** panel (key **L**, add to the action bar) rendering
  `log.recent()`, newest first, color-coded per kind (reuse the panel/scroll infra already there).

**Accept:** actions populate the log; **L** opens a scrollable color-coded panel; `window.__nw.log` grows.

---

## 4. Data-driven SFX table  `refactor:`
Turn the hardcoded `switch(name)` in `engine/audio.ts` `play()` into a small recipe table so new sounds
are data, and add distinct gather sounds.

**Do:**
- `src/engine/audio.ts`: define `type SfxStep = { type: 'tone'|'burst'|'blip'|'kick'|'roar'; ... }` and
  `const SFX: Record<string, SfxStep[]>`. Move each existing case into a recipe; `play(name)` looks up
  `SFX[name]` and runs a generic `render(step, t)` that dispatches to the existing private voices
  (`tone`/`burst`/`blip`/`kick`/`roar`). Keep every current sound identical.
- Optionally lift the table into `src/game/data/sfx.ts` (keep the synth primitives in `audio.ts`).
- Add variants: `chop` (layered wood thunks), `harvest`/`forage` (leafy pluck), `mine` (already), plus a
  couple of alternates the gather system can pick from for variety.

**Accept:** all existing sounds still play; adding a sound = adding a table row; new chop/harvest
variants exist and are used by `systems/gather.ts`.

---

## Verification (whole worktree)
- `npm run typecheck` clean; `npm run build` green.
- `preview_start nightward-dev`; via eval: `window.__nw.step(30)` then read `window.__nw.log` — entries
  present. Enter build mode via `__nw.sys.build.enter('hut')`, confirm `build.cancel()` clears
  `build.mode` and the banner; confirm right-click/Esc/B paths in the foregrounded panel.
- Foreground the preview and eyeball connected walls + the Log panel. SFX audible after a click gesture.
- Confirm no persistence: reload the preview, character/state is fresh every time.
