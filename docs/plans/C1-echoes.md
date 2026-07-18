# C1 — Echoes of the Slain (implementation brief)

**Written to implementation grade 2026-07-16 (overnight), same night the quiz verdicts
landed. Built immediately on branch `c1-echoes` by the same session — this brief is the
spec the code was written against. Verdicts applied: T1 fixed signature echo per lord;
T5 Cinder Trail ignites the REAL fire CA from day one (`CFG.echoes.cinderIgnitesCA`
ships TRUE — it is a kill-switch, not a someday-toggle).**

## What ships

Each domain lord, slain, grants its signature echo — an auto-firing ability in that
lord's element. Killing the SAME lord again (bosses already revive stronger via
`level += levelPerRevive`) levels the echo, cap 8. All 5 echoes holdable at once.
Echo damage obeys D5: every echo damage number is `round(echoBaseDmg(level) × roll)`
where `roll` comes from `net.rollDamageMul(rng)` — the one damage law.

| Lord (defId) | Echo (id) | Kind | Behavior |
|---|---|---|---|
| thornwarden | Thornring (`thornring`) | pulse | damage burst around you every ~3s when foes are in radius (Garlic) |
| cindermaw | Cinder Trail (`cinder_trail`) | trail | walking drops burning patches on the tile you LEAVE; patches hurt foes AND attempt real fire-CA ignition |
| rimewraith | Rime Nova (`rime_nova`) | nova | periodic frost burst that damages + SLOWS foes (chill) |
| tideculler | Tide Lash (`tide_lash`) | volley | hitscan lash(es) at the nearest foe(s) in range, projectile count scales |
| nullmaw | Null Orb (`null_orb`) | orbit | orb(s) circling you; contact damage with per-foe immunity window |

## Files

- **`src/game/data/echoes.ts`** (NEW) — `EchoDef` rows: id, bossId, name, icon, color,
  kind, desc (fiction line), `base` + `perLevel` numeric stat objects, and
  `statsFor(def, level)` = `base[k] + (perLevel[k] ?? 0) × (level−1)` with cooldown
  floored at `CFG.echoes.minCooldownSec` and counts floored ≥1. Content is rows.
- **`src/game/systems/echoes.ts`** (NEW) — `EchoSystem`:
  - `onBossSlain(b)` — grant/level. Called from `worldbosses.hurt()` death branch for
    ANY killer (player, tower, another echo): the echo clings to the run, not the blow.
  - `update(dt)` — per-echo cooldowns, firing logic, patch lifecycle, orb orbit,
    seeded rng per fire: `(state.seed ^ (fireCount × 0x9e3779b9))` mulberry32, same
    scheme as combat swings.
  - Damage application: mobs via `hordes.hurt(f, dmg, /*awardXp*/ false)` — tower rule:
    auto-damage never trains combat. Bosses via `worldbosses.hurt(b, dmg, /*fromPlayer*/
    true)` — a boss kill is never AFK; it provokes and pays like yours.
- **`src/game/state.ts`** — `player.echoes: Record<string, number>` (echoId → level),
  `{}` in `newState`.
- **`src/game/data/config.ts`** — `CFG.echoes: { maxLevel: 8, minCooldownSec: 0.6,
  cinderIgnitesCA: true, orbitRadPerSec, orbContactImmunitySec, trailSelfIgniteSafety }`.
- **`src/game/systems/worldbosses.ts`** — one line in `hurt()` death branch:
  `this.ctx.echoes?.onBossSlain?.(b)`.
- **`src/main.ts`** — construct after worldbosses (`ctx.echoes = echoes`), tick in
  `sim()` with `effectiveDt`, expose in `__nw.sys.echoes`.
- **`src/game/world/views.ts`** — two transient helpers: `addPulseRing(x, y, r, color)`
  (expanding ring, used by pulse + nova) and `addBurnPatch(x, y, sec)` (fading ground
  glow). Volley reuses `addShot`. Orbs are a persistent `Graphics` the system owns,
  parented to `player.cont` (orbits follow the interpolated player for free).
- **`src/game/ui/ui.ts`** — echo chip badge in the top bar (`#nw-echoes`), rebuilt in
  `refresh()` only when the composed string changes. Chip = icon + level, title =
  fantasy name + desc (Veil-clean).
- **`src/game/systems/network.ts`** — `rollDamageMul(rng, opts?)` gains
  `{ label?: string; stash?: boolean; quiet?: boolean }`. Echoes pass their own label,
  `stash: false` (an echo roll must NEVER overwrite `lastSwingDmgMul` mid-windup),
  and trail-patch rolls pass `quiet: true` (no Lens spam at 2 rolls/s while walking).
  Default behavior unchanged — combat's call sites untouched.

## Cinder Trail — the real-fire verdict, precisely

- Trail triggers on TILE CHANGE: when the player's foot tile changes, the patch drops on
  the tile just LEFT (never the current one — walking your own trail forward must not
  self-immolate; backtracking through it can, and that's yours to learn).
- Each patch: damages foes within its tile every 0.5s for its lifetime (echo damage,
  rolled once at patch birth — the patch's potency is the roll). Patch damage skips the
  player (the echo is yours).
- Each patch ALSO calls `worldCore.ignite(tx, ty)` once when `CFG.echoes.cinderIgnitesCA`
  (direct core call — `fire.ignite()` would toast "That won't catch" on every stone tile
  and mark it a controlled burn; trail fires are wild, no charcoal). If the ground
  catches, the R2 CA takes over: real spread, real burnout, real burn damage to
  EVERYONE including you (fire.ts:102) and your base. That's the verdict.

## Fiction / Veil & Lens

- Chronicle ('boss' kind): "The Thornwarden's echo clings to you." / level-up:
  "The Thornwarden's echo deepens — level 2." Numbers-as-levels are Veil-legal
  (skills already speak in levels). No net/tech words in fiction, ever.
- Lens ('resonance' kind): `echo grant: thornring L2 ← thornwarden slain (boss level 3)`
  plus per-fire roll lines from `rollDamageMul` labeled `thornring roll 1.12× ← …`.
- HUD chips speak icon + level only.

## Gauntlet additions (definition-of-done)

1. **testEchoGrantAndLevel** — reset `player.echoes`; kill a synthetic thornwarden via
   `sys.worldbosses.hurt()` (fake boss MUST carry `level: 1` — `hurt()` computes
   `b.level * 20` gold; `testBossFight`'s fake omits it and transiently NaNs the gold,
   pre-existing, masked by `testDeathAndScatter` overwriting gold) → `echoes.thornring
   === 1`; kill another → `=== 2`; grant 10 more → capped at `CFG.echoes.maxLevel`.
2. **testEchoDamage** — for each of the 5 kinds: hold exactly that echo, plant a dummy
   foe in its trigger geometry, step the sim its cadence, assert the foe took damage;
   nova additionally asserts the chill field, trail asserts a patch exists on the exited
   tile.
3. **testEchoBounds** — `statsFor` monotonic in level (dmg up, cooldown down but
   ≥ minCooldownSec, counts ≥1), level cap enforced, and rolled echo damage over N
   fires stays within `[base×dmgRow.min, base×dmgRow.max]`.

Suite count goes 34 → 37. All existing tests must stay green — echo side effects on
other tests are bounded because echoes only fire when a target is inside their small
radius (foes in other tests spawn ≥14 tiles out, except melee-range dummies which the
tests themselves own).

## Explicitly out of scope (and why)

- Echo movement of `echoMoveMul` into foe marching — **pre-existing N2a gap found
  during grounding: `hordes.updateFoe` never applies `echoMoveMul`** (birth stat is
  attached, never read). Reported to the user, not silently fixed: it's a balance
  change belonging to its own commit after sign-off.
- Draft/slot pressure, echo respec, per-echo gear synergies → C4.
- Echo art beyond procgen primitives — G1-P painterly verdict comes first.

## Acceptance (live, at `?seed=1234`)

1. `y`-summon a boss, kill it → toast + Chronicle grant line + HUD chip appears.
2. Kill the re-formed same lord → chip shows L2, Lens shows the grant line with levels.
3. With Thornring held, stand in a night wave → pulse rings + foe damage without input.
4. With Cinder Trail held, walk through grass → patches + REAL ignition, CA spread,
   embers; walk through your base → it burns. (Verdict witnessed.)
5. `?seed=1234&test` → 37/37 green.

## Verification record (2026-07-17, overnight build session)

Run headlessly (system Chrome via raw CDP — scratchpad `gauntlet-cdp.mjs`, vite on
:5199, `?gl`) because the playtest agent spawned without browser tools this session.

- **Gauntlet `?seed=1234&test`: ✅ ALL 37 test functions / 165 assertions PASSED
  (1396ms), zero page errors.** All 21 new echo assertions green (grant L1→L2→cap 8,
  every kind dealt damage: pulse 7, nova 10 + chill 0.55, volley 5, orbit 24, patch 10;
  10/10 rolled pulse hits inside the D5 band [1,10] for base 6).
- **First headless run caught P1's `testMobBirthStats` being NONDETERMINISTIC**
  (36/37): the Shelled-vs-Blinker branch reads live `computeRealmProfile().variance`,
  and jittery first-contact probes birthed a Blinker. Fixed by pinning the profile in
  the fixture (`20c6996`); echo dummies also frozen via telegraphT so orbit/trail
  geometry can't pass by luck. Lesson recorded: a behavioral test must pin EVERY input
  the exercised path reads.
- **Live probe (`?seed=1234&gl`, no `&test`)**: `cinderIgnitesCA === true` live;
  grant → thornring L1 with "echo clings" Chronicle line → L2 with "deepens"; HUD chip
  visible (`🌿2` with Veil-clean tooltip); Thornring dealt 10 dmg to an adjacent foe
  with zero input; Cinder Trail walking 5 tiles dropped 5 patches on the exited tiles
  and **all 5 grass tiles were genuinely burning in the fire CA** (`core.isBurning`
  true ×5). Zero page errors.
- Static: `tsc --noEmit` clean, `vite build` green. Rust untouched (cargo 23/23 stands
  from P1).
- Branch `c1-echoes` pushed (commits `bb42c01` feat, `20c6996` test fix). **NOT merged,
  NOT tagged — awaiting the user's sign-off per WORKFLOW.** Visual feel (pulse rings,
  orb orbit, patch flicker) is untested by eye — headless session; feel gates are
  relaxed this era, but look for yourself before sign-off.
