# P1 — Platform Hardening ("level one down")

**Status: ACTIVE — the next implementation session.** Written 2026-07-16 from the user's
direction after N2a shipped. Goal: a solid, self-verifying platform to build the content
batch on. No new player-facing systems beyond closing N2a's gaps — this is foundations.

## The direction (user, 2026-07-16)

1. Current feel is OK — **the joy of the game will be scaling.** We are "playing a level-1
   character over and over"; game-feel polish can chill until there are Vampire-Survivors-
   style boss abilities / PoE-like passives / Terraria-like gear / Legion-TD building
   variety. (Content batch — design session AFTER P1, see ROADMAP.)
2. Network modifiers: **make it a bit crazy — 0.3×–1.5×, like lightning damage in PoE.**
3. Implementation sessions shipping with gaps → **the answer is a stronger QA suite.** Does
   it fight a boss? Fight mobs? Walk into stuff? Interact with the world?
4. Priority: game in good working state as a content platform. (Also parked for the content
   batch: buildings rework — "current buildings are shit", Legion TD 2 variety in our own
   art style; painterly filter investigation lives in G1's prototype gate.)

**No feel-gate on P1** (per point 1). The gate is: the Gauntlet is green and the acceptance
evidence is pasted. Feel verdicts resume when content lands.

---

## Part 1 — Close the N2a gaps (verified findings, 2026-07-16)

One commit each, directly on main (cleanup of main's own tree, no worktree needed):

1. **fix(n2a): cold-route inversion.** `src/game/systems/network.ts:722` reads
   `const cold = rtt > 100 && wasWarm;` — backwards. Cold = first contact that paid the
   DNS+TCP+TLS handshake: `const cold = !wasWarm;` (capture BEFORE `warmedRoutes.add`).
   This is the trigger for Pale/Shelled foes (brief N2a Part C2) — currently fires on
   exactly the wrong condition.
2. **refactor(n2a): make moveSpeed/xpRate NET_GAME_MAP rows real.** In
   `src/game/data/network.ts` the moveSpeed transform returns constant `1.06` and xpRate
   returns `1.0` with a wrong `netKey`, while the real formulas live inline at
   `src/main.ts:359` and `src/game/rules.ts:67`. Violates "mappings are data, not code":
   the transforms must compute the real values (extend the mapping input to carry
   `echoJitter` / `distinctRegionsProbed` — e.g. transform receives the snapshot, not one
   float), and the wire points must READ the mapping. Console-editing `NW.NET.mappings`
   must change the live value within one tick. Threads panel must show true sources.
3. **feat(n2a): Lens inspect mode** exactly per N2a brief Part B §8 — hover/tap any Lens
   row → SOURCE / ACTION / FLOWS INTO detail box; `inspect` fields on `NET_METRICS` rows
   and `BeaconTarget`s + one static table for identity/vessel rows.
4. **fix(n2a): style the Lens feed** with `NET_LOG_LABELS` / `styleNetworkMsg` (currently
   raw kind strings).

## Part 2 — D5: lightning bands (recorded design decision)

**D5 (user, 2026-07-16): OUTCOME modifiers go wide and wild; TIME-FEEL modifiers stay
tight.** Wide swings in damage/gold/xp are exciting (PoE lightning); wide swings in sim
speed or movement read as lag/brokenness, not excitement — D4's rationale stands for those.

**Damage becomes a per-swing ROLL, not a static multiplier** (this is what "lightning"
means): replace the stepped `rttToDamageMul` tiers with, per swing:

```
center = clamp(1.45 − bestEchoMs / 250, 0.55, 1.30)   // fast route → high center
half   = 0.15 + clamp(echoJitter / 60, 0, 1) × 0.45   // calm ≈ ±0.17, stormy ≈ ±0.60
roll   = clamp(center + (rng()×2 − 1) × half, 0.30, 1.50)
```

- Use the seeded game rng (determinism for the Gauntlet), not `Math.random()`.
- Resonance crit (×1.5, warmed routes) applies AFTER the roll — max spike 2.25×, intended.
- The roll must be FELT: damage floater shows the swing's damage as now (fiction-clean),
  the Lens feed logs the technical line ('swing roll 1.32× ← echo 48 ms, center 1.26 ± 0.34').
- Keep it data-driven: the damage NET_GAME_MAP row carries min 0.30 / max 1.50 and the
  center curve; roll logic reads the row's clamps.

**New clamps** (all as NET_GAME_MAP row min/max — tunable live):

| modifier | was | becomes |
|----------|-----|---------|
| damage (per-swing roll) | 0.7–1.4 stepped | **0.30–1.50 rolled** |
| goldRate | 0.5–1.25 | **0.30–1.50** |
| gatherSpeed | 0.85–1.25 | **0.50–1.50** |
| xpRate | 1.0–1.30 | **0.75–1.50** (never punishes below −25% — scaling is the joy) |
| enemyScale | current | **0.50–1.60** |
| simSpeed | 0.85–1.15 | unchanged (D4) |
| moveSpeed | 0.92–1.06 | unchanged (D4 rationale) |

Mob-birth bands (N2a C2) stay as shipped for now — widen in the content batch when mob
variety exists to absorb it.

## Part 3 — Q1: the Gauntlet (behavioral QA suite)

Extend `src/game/systems/regression.ts` (currently 20 mostly single-verb tests) with
behavioral coverage. Same harness (`?seed=1234&test`, `__nw.regression.run()`), same
single-eval discipline. Respect the known gotchas (WORKFLOW.md): drive systems directly
(no rAF), paint 3-row strips for collision tests, hold-key + `step(n)` in one eval,
read/write `__nw.player.x/y` not the state mirror.

New tests:

1. **testCollisionWalls** — walk into a placed Palisade, into water, into a blocking
   feature: position must not advance; no throw.
2. **testLongWalk** — walk ~150 tiles in one direction via held key + step loop: chunks
   stream in, expected displacement within tolerance, no errors, not stuck.
3. **testGatherEveryFeature** — for each `FeatureDef`: locate/paint one, gather it,
   verify loot + xp + depletion + respawn timer set.
4. **testCraftEveryRecipe** — grant materials, craft every recipe, verify outputs land.
5. **testBuildEveryBuilding** — place each building type; verify all rejection reasons
   fire correctly (no hall / too far / blocked / unaffordable).
6. **testFightEveryMob** — for each `EnemyDef`: spawn it, duel it with sim-stepped swings
   to the kill; verify its telegraph fires, it damages the player, loot/xp awarded.
7. **testBossFight** — spawn a world boss, hit it (verify `hunting` engages via
   `provokedUntil`), let it chew a wall, kill it, verify death toast + revive-stronger.
8. **testNightWave** — force night; wave spawns with count matching the formula; towers
   fire; survive to dawn; counts/scaling within clamps.
9. **testDeathAndScatter** — `damagePlayer` to 0: respawn distance within
   `[respawnMinTiles, respawnMaxTiles]`, gold loss pct correct.
10. **testGameOver** — destroy the hall: `gameOver` set, death screen DOM contains
    'THE THREAD IS CUT'.
11. **testMobBirthStats** — fixture `net.lastEcho` (incl. a cold route), spawn wave foe:
    hp/dmg/soak/speed within C2 clamps, epithet matches lexicon, Shelled triggers on cold.
12. **testDamageRollBounds** — ≥200 rolls under calm vs stormy jitter fixtures: all in
    [0.30, 1.50]; stormy variance strictly greater than calm (the lightning is real).
13. **testNetworkFallbacks** — offline snapshot fixture: realm = The Hollow, every
    modifier at fallback, no throw.
14. **testUISmoke** — open every panel (bag/craft/skills/log/Lens): DOM renders, all Lens
    sections present, inspect box appears on a row, no throw.

**Process rule (add to WORKFLOW.md as the definition of done):** an implementation session
may not declare a milestone complete without (1) static trio green, (2) full Gauntlet green
at `?seed=1234&test` with the output pasted, (3) the brief's acceptance checklist run live
with evidence, (4) tag pushed. "Known gaps" require the user's explicit sign-off BEFORE
merge, not disclosure after.

---

## Acceptance (run verbatim on main)

1. Static trio green; full Gauntlet (old 20 + new 14) green at `?seed=1234&test`, output pasted.
2. `NW.NET.mappings` console-edit of moveSpeed/xpRate changes live values within a tick;
   Threads shows true sources for all 7 modifiers.
3. Inspect box renders for a metric row, a route row, and an identity row.
4. 20-swing sample logged: damage rolls spread within [0.30, 1.50] and visibly vary
   swing-to-swing (paste the numbers).
5. Cold-route foe (first-contact fixture) spawns Shelled with 'Pale' prefix.
6. Tag **`v0.18-p1-platform`**, push. No feel gate — proceed to the content-batch design
   session (with the user) as the next step.
