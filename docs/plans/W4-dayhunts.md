# W4 — Day hunts & the balance pass (brief, 2026-07-07)

> First milestone of the content-first pivot (see ROADMAP.md). Three strands, all small,
> all playtest-facing: something to hunt by day, nights that actually threaten, and xp
> curves stretched ×10. No new engine machinery — this is data + one spawn path.

## Where things are today (read these first)
- `systems/hordes.ts` owns ALL foe plumbing: `Foe` interface, `spawn()` (night waves around the
  hall), `updateFoe()` (march/aggro/telegraphed bite — W3), `hurt()` (death/loot/xp/log), and the
  views wiring. Night-only: spawning is gated on `isNight()` in `update()`.
- `data/enemies.ts` `EnemyDef` rows drive everything (hp/dmg/telegraphSec/loot/fromNight/weight).
- `config.horde` has the night knobs; `config.xp` + `config.soulgear` hold both leveling curves
  (`need(L→L+1) = base × growth^(L-1)`, so ×10 on `base` = ×10 across the whole curve).
- `hurt()` already handles loot rolls, gold, combat xp, log lines — day mobs get all of it for free.
- Dawn (`onDawn` + `dawnFlee`) clears every foe; dusk (`onDusk`) queues the night wave.

## Spec

### 1. Daytime roaming mobs (`hordes.ts` + `data/enemies.ts` + `config.ts`)
- **Extend HordeSystem — do not fork a second foe system.** One `foes` array, one `updateFoe`,
  one `hurt`. Add a `dayMob?: boolean` (and `homeX/homeY` wander anchor) to `Foe`.
- New `EnemyDef.daytime?: boolean` flag — start with gnawer + wisp; brute stays night muscle.
  Adding a day critter later = flipping a data flag, per the non-negotiables.
- New `CFG.dayspawn` block (starting points, tune live): `maxAlive: 5`, `spawnIntervalSec: 9`,
  `minRadiusTiles: 8`, `maxRadiusTiles: 16`, `despawnTiles: 28`.
- Spawn **around the player** (not the hall), during day only, trickle up to the cap. Weighted
  pick among `daytime` rows (reuse the existing weighted-pool code shape).
- Behavior: wander lazily near `homeX/homeY` until the player enters `aggroRangePx`, then exactly
  the normal foe behavior (chase + W3 telegraphed bite). Day mobs never beeline the hall —
  they're prey/hazard, not a siege.
- Despawn (with `views.removeFoe`) when the player gets `despawnTiles` away — the world shouldn't
  fill with abandoned critters. Night-wave foes are exempt (they have a job).
- At dusk, surviving day mobs just keep living (free flavor); `dawnFlee` already wipes the board
  at dawn and the day spawner repopulates.
- Kills flow through `hurt()` unchanged: loot, gold, combat xp, log, SFX all work day one.

### 2. Harder nights (`config.horde` retune — numbers only, no code)
Playtest verdict: post-W3 telegraphs made nights too comfortable. Starting points (verify by
playing, that's the gate): `baseCount 6→9`, `perNight 3.5→5`, `spawnIntervalSec 1.5→1.1`,
`hpGrowth 1.14→1.18`, `dmgGrowth 1.09→1.12`. Keep `maxAlive` 90 (perf cap).

### 3. XP ×10 (`config.xp` + `config.soulgear` — numbers only)
- `CFG.xp.base 40 → 400`; `CFG.soulgear.xpBase 90 → 900`. User asked for "everything" ×10;
  both curves are pure functions of `base`, so this is the whole change. All live-tunable
  via `window.NW.CFG` if the grind lands wrong.

## Verify (static in worktree; live on main post-merge, per WORKFLOW.md)
- Day spawns: eval-drive daytime, `step(n)` → foes appear near the player, count clamps at
  `maxAlive`, all have `dayMob: true` and `daytime` defs only.
- Despawn: teleport the player 40 tiles → day mobs (and only day mobs) vanish, views cleaned.
- No hall aggro: park a day mob out of aggro range near the hall → it wanders, never attacks
  buildings.
- Kill one → loot/gold/xp/log land (existing `hurt()` path).
- Night counts: force dusk on night 3 → wave size matches the new formula.
- XP: `levelFromXp(400) === 2` (was 40); soul level thresholds ×10 likewise.
- **Playtest gate: STOP after tag.** Balance feel is the whole point of this milestone —
  get the user's verdict on day-hunt density, night pressure, and grind speed before W5.
