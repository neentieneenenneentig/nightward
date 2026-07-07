# W3 — Weighty combat (re-scoped brief, 2026-07-07)

> Re-scoped after the W1 rig revert. The animation baseline is **4-direction baked frames**
> (`Facing = 'down'|'up'|'left'|'right'`, `FACING_ANGLE` lookup in `combat.ts`). Do NOT
> rebuild rig poses — phases drive tint/scale on the existing sprite plus the existing
> `views.addSlash` effect.

## Where combat is today (read these first)
- `systems/combat.ts` `attack()`: instant hit on keypress — cooldown 0.45s, 150° arc, 40px reach,
  damage applied the same frame the key goes down. No commitment, no dodge window for enemies.
- `systems/hordes.ts` `updateFoe()`: a foe within 24px whose `atkT <= 0` damages the player the
  same tick — no tell, no counterplay. Same shape in `worldbosses.ts` for the boss strike.
- W2's soul machinery (`rules.ts`: `soulStat`, `awardSoulXp`) already gives per-slot levels —
  weapon soul level is the natural `attackSpeed` input.
- Sim is a fixed 30Hz timestep; anything timed must span ≥ ~2–3 ticks (≥ ~0.07–0.1s) to be reliable.

## Spec

### 1. Player attack state machine (`systems/combat.ts`)
- Replace the flat cooldown with `phase: 'idle' | 'windup' | 'active' | 'recovery'` + a phase timer.
  `attack()` starts windup from idle; pressing attack during recovery buffers ONE queued swing
  (keeps it responsive without mashing feeling ignored).
- **Damage resolves once, on the windup → active transition** (same single-hit semantics as today —
  no per-tick re-hits). `views.addSlash` + hit/miss SFX + the existing per-hit log lines fire there too.
- New `CFG.combat` block (all numbers live here): `windupSec ≈ 0.22`, `activeSec ≈ 0.12`,
  `recoverySec ≈ 0.30`, `arcDeg ≈ 110` (narrower than today's 150 — weighty means aimed),
  `moveSlowMult ≈ 0.35` (movement slowed while mid-swing — the commitment), and
  `attackSpeedPerSoulLevel` (envelope duration × `1 / (1 + weaponSoulLevel × k)`, floor ~0.5×).
- Phase visuals with existing machinery only: windup = player sprite tint + slight scale squash;
  active = the slash; recovery = brief desaturate. Distinct windup SFX via the W0 SFX table.

### 2. Enemy telegraphs (`data/enemies.ts`, `hordes.ts`, `worldbosses.ts`, `world/views.ts`)
- Add `telegraphSec` to `EnemyDef` (data-driven, per enemy type; bosses longer than mobs).
- When a foe/boss is in reach and off cooldown, it enters a telegraph state (visible tell — tint
  flash on the foe view + a warning SFX) instead of dealing damage immediately. When the telegraph
  elapses, it hits **only if the player is still within reach (+ small slack)** — stepping out
  during the tell whiffs the attack. This is the counterplay that makes night fights winnable
  on skill, not just stats.

### 3. Spin attack (the 4-direction re-scope of "channeling") — cut-line scope
- Hold attack ≥ `spinHoldSec` (~0.5s), release → full-circle radial burst: hits everything within
  ~melee range at `dmg × spinDmgMult` (~0.75) with linear falloff to the edge, then a doubled
  recovery. No float facing needed — it's radial, not a sweep.
- Needs key-down/up tracking in `engine/input.ts` (currently intent-shaped). **If the input
  plumbing or the feel gets gnarly, ship phases + telegraphs alone and defer spin** — note the
  deferral in ROADMAP.md. Phases and telegraphs are the milestone; spin is the stretch.

## Verify (beyond typecheck/build — live-verify happens on main post-merge, per WORKFLOW.md)
- Damage timing: eval-drive `attack()` next to a foe, `__nw.step(1)` → foe hp unchanged during
  windup ticks; step past `windupSec` → hp drops exactly once. Log shows the hit line.
- Attack speed: raise weapon soul level via `awardSoulXp`, assert phase durations shrink.
- Telegraph: park the player in reach → foe tell fires, damage lands after `telegraphSec`;
  teleport the player away mid-tell → no damage, whiff logged.
- Spin (if shipped): burst hits foes on all sides of the player; falloff verified by hp deltas
  at near vs. edge range.
- **Playtest gate:** combat feel is subjective. After merge + tag, STOP and get the user to play
  before touching W4.
