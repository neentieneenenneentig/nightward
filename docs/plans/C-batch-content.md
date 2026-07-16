# Batch C — The Character (content batch design)

**Status: LOCKED 2026-07-16 — quiz returned (see `C-batch-quiz.md`). Verdicts:
T1 fixed signature echoes (default) · T2 Loom points from NIGHTS SURVIVED (override) ·
T3 all 4 keystones in v1 (default) · T4 waystone destruction = FULL COLLAPSE, disconnected
buildings decay (override) · T5 Cinder Trail ignites the REAL fire CA from day one
(override) · T6 order C1→C2→C3→C4→(G1-P)→C5 (default).** The taste reads: danger-clock
progression, maximum-stakes territory, real fire. Sections below are amended in place to
match. Drafted overnight 2026-07-16→17 by the chief-of-staff session per "start planning";
grounded in the shipped v0.18 tree. Individual milestone briefs get written to
implementation grade AT ACTIVATION (anti-staleness, W1 lesson) — C1's brief is
`docs/plans/C1-echoes.md` (written + built the night the verdicts landed).

## The thesis

The user's words: **"scaling is the joy — this is like playing a level-1 character over
and over."** NIGHTWARD has no persistence, ever. That constraint is the design gift of
this batch: every run starts naked, so *all* progression systems are per-run, which means
they are **build-identity systems** (roguelite), not chore-trees (MMO). The four pillars
must each answer one question: *what makes THIS run's level-30 different from last run's
level-30?*

- **Echoes** (VS-style boss abilities) — what your combat *does* automatically.
- **The Loom** (PoE-style passives) — what your character *is* (keystone tradeoffs).
- **Gear** (Terraria-style accessories) — what your loot *changed* about the rules.
- **The Watch** (Legion-TD towers + waystones) — what your *land* is becoming.

One loop feeds them all: kill lords → echoes; do anything → skill xp → Loom points;
fight/gather → gear mats; build → territory → income AND bigger nights → need all four.

## The inventory of what exists (verified in-tree, v0.18)

- 3 regular mobs (Gnawer/Brute/Wisp), 5 world bosses with strong elemental identities
  (Thornwarden/nature, Cindermaw/fire, Rimewraith/frost, Tideculler/tide, Nullmaw/void).
  Bosses already **revive stronger** (`level += levelPerRevive`) — a built-in farming loop.
- Boss-kill hook: `worldbosses.ts hurt()` death branch (gold/loot/xp/charm feed) — echoes
  attach here.
- No character level: 8 skills (RS curve) + soul-gear levels. A passive tree needs a
  point source (decision T2).
- Gear: 5 equip slots (weapon/armor/ring/amulet/charm) + 2 soul tool slots; all items are
  flat stats (`weaponDmg`/`armor`/`regen`) — no behavior effects yet.
- Buildings: 5 defs, ONE tower type (Watchtower), `maxDistFromHall: 18` caps sprawl.
- The fire CA (R2) is live — burning ground is a real world system, not vfx.
- D5 damage roll + mob birth records + Veil/Lens law are in force. Gauntlet (34 tests) +
  definition-of-done rule are the shipping standard: **every C milestone adds Gauntlet
  tests for its system.**

---

## C1 — Echoes of the Slain (VS abilities from boss kills)

**The pitch:** each domain lord, slain, leaves its echo clinging to you — an auto-firing
ability in that lord's element. Kill the SAME lord again (it re-forms stronger, existing
mechanic) and its echo levels up. The revive loop becomes the ability-farming loop:
the boss gets stronger each time, and so does what it gives you. Risk scales with reward
with zero new systems.

Signature echoes (fixed per lord — decision T1):

| Lord | Echo | Behavior (VS analog) |
|------|------|----------------------|
| The Thornwarden | **Thornring** | pulse of damage around you every N s (Garlic) |
| The Cindermaw | **Cinder Trail** | moving leaves burning ground patches (Trail) |
| The Rimewraith | **Rime Nova** | periodic frost burst that SLOWS foes (unique CC) |
| The Tideculler | **Tide Lash** | projectile volley at the nearest foe (Knife/Axe) |
| The Nullmaw | **Null Orb** | orbiting void orb(s), contact damage (King Bible) |

Design notes:
- All 5 holdable at once — no draft/slot pressure at 5 echoes; drafting is a later-batch
  idea when the pool is bigger.
- Echo damage uses the **D5 roll** (echoes are lightning too — one damage law everywhere).
- Levels: +1 per re-kill of that lord; each level = per-echo scaling row (dmg, radius,
  projectile count, cadence). Cap ~8.
- Cinder Trail: **T5 verdict — REAL fire-CA ignition from day one.** Patches deal the
  echo's damage (reliable on any ground), AND each patch attempts to ignite the actual
  fire CA at its tile (`worldCore.ignite`) — on flammable ground your footsteps genuinely
  set the world alight, base included. The `CFG.echoes.cinderIgnitesCA` flag still exists
  but ships **TRUE** (kill-switch if playtests prove it miserable, not a someday-toggle).
- Data-driven: `data/echoes.ts` rows; `systems/echoes.ts` generic tick (cooldowns live in
  the system, levels live in `state.player.echoes: Record<echoId, level>`).
- Veil: Chronicle says "The Thornwarden's echo clings to you." Lens feed logs the
  technical line. HUD gets echo chips (icon + level).
- Gauntlet adds: testEchoGrantAndLevel (kill lord → echo; re-kill → level 2),
  testEchoDamage (each echo type kills an adjacent dummy foe within its cadence),
  testEchoBounds (echo rolls respect D5 clamps).

**Why first:** cheapest joy-per-line in the whole batch. It changes every fight from
minute one, uses only existing hooks, and makes bosses THE content instead of a wall-chewing
nuisance.

## C2 — Waystones (territory extension — the infinite-map unlock)

**The pitch:** one new building, `waystone`. Buildings may be placed within
`maxDistFromHall` tiles of the Hearthstone **or any waystone**; a waystone itself must be
placed inside the existing radius network — so territory grows in connected chains, outward
forever. This is the smallest possible version of "a vast map covered in buildings."

- Expensive (iron bars + runestone + gold), high territory score → placing one genuinely
  escalates the nights. Frontier-pushing is a declaration of war, as it should be.
- **T4 verdict — FULL COLLAPSE.** Destroying a waystone disconnects everything that
  chained through it: disconnected buildings start decaying (hp drain per second until
  reconnected or dead), and new placement out there is blocked. Maximum stakes — the
  chain is a lifeline, defending it is the game. (C2's brief must spec the decay rate,
  a Chronicle warning when a segment goes dark, and a Gauntlet test for disconnect→decay
  →reconnect-stops-decay.)
- Night waves / boss pathing already target territory+hall; waystones are just buildings —
  they can be chewed. Defending the chain is the new strategic layer.
- Gauntlet adds: testWaystoneExtension (placement beyond 18 tiles rejected → place
  waystone → now accepted; chain rule enforced).

**Why second:** ~1 data row + 1 placement-rule change + art. It unlocks the endgame map
fantasy months before the buildings rework, and C5 gets to design towers for a world where
territory actually sprawls.

## C3 — The Loom (the passive tree)

**The pitch:** a per-run passive tree — "the Loom," where your thread is woven (the death
screen already says THE THREAD IS CUT; this is that fiction's home). PoE-flavored:
small nodes are stat food, **keystones warp the run's rules**. No respec — a run IS its
weave (and no persistence means every run re-picks anyway).

- **Point source — T2 verdict: NIGHTS SURVIVED.** Loom points come from the danger
  clock, not the grind: surviving a night = Loom point(s). The tree is what the nights
  make of you. (C3's brief decides the exact rate — flat 1/night vs. escalating — and
  must make the death-screen fiction "THE THREAD IS CUT" land: the weave is what your
  survived nights wove. Skilling stays its own reward track; the Long Thread keystone
  needs redesigning since it referenced the total-level rate.)
- v1 scope: 3 branches × ~12 small nodes + 4 keystones (~40 nodes). Branches:
  - **War** — melee dmg %, swing envelope speed, arc width, roll-floor nudges.
  - **Field** — gather speed, double-yield chance, craft cost reduction, move speed.
  - **Ward** — armor, regen, building hp, tower dmg/range, territory income.
- Keystone drafts (the PoE taste — decision T3):
  - *Glass Echo* — your damage rolls only use the TOP half of the D5 band; max hp halved.
  - *Deep Roots* — buildings +50% hp and towers +1 range; you move 12% slower.
  - *Night Market* — gold rate +40%; gold rouses bosses at half the threshold.
  - *The Long Thread* — +1 Loom point per 4 total levels instead of 5; skills cap at 80.
- UI v1: an RPGUI panel (3 columns, click-to-allocate), NOT a radial graph — graph art is
  polish, allocation is the game.
- Data-driven: `data/loom.ts` node rows with `effect` keys consumed by existing systems
  (same pattern as NET_GAME_MAP: modifiers are data).
- Gauntlet adds: testLoomAllocation (points accrue at thresholds, spend applies stat,
  illegal spends rejected), testKeystoneEffects (each keystone's rule change observable).

**Why third:** it's the scaling spine, but it lands best when there's already variety to
scale (echoes from C1) — a tree over bare auto-attacks is spreadsheet, not build.

## C4 — The Armory (Terraria-style gear + bestiary expansion)

**The pitch:** gear stops being flat stat sticks. Accessories carry *rule effects*, boss
uniques carry identity, and material tiers extend outward with the domains.

- `ItemDef.effect` hooks (data-driven behavior keys, e.g. `onKill: moveBurst`,
  `gatherNoConsumeChance: 0.1`, `echoDmgMul: 1.15`) — systems consult a small
  `effects.ts` registry.
- Each lord drops a signature **relic** (new 6th equip slot) — Terraria boss identity:
  e.g. Thornwarden's Bramble Heart (thorns reflect), Nullmaw's Hollow Eye (see foes'
  hp/soak through the Veil… a Lens crossover).
- New tiers past iron (silver, star-metal), ore access gated by domain ring — reaching
  out (via C2 waystones) is gearing up.
- **+3 night mobs** (bestiary is thin at 3): a ranged spitter, a wall-burrower, a
  tower-hunter — each drops the new tier mats. This is also where the mob-birth bands
  (N2a C2) finally WIDEN, per the P1 note "widen when mob variety exists to absorb it."
- Gauntlet adds: testEffectHooks (each effect key observable), testRelicDrop,
  per-new-mob duels fold into the existing testFightEveryMob automatically.

## C5 — The Watch (Legion TD 2 buildings rework) — LAST, and gated

**The pitch:** the full buildings rework the user asked for ("current buildings are
shit"). Tower ROLES + A/B upgrade paths (LTD2's shape), own procgen art style.

- Roles: Splash (Emberkiln), Slow (Frostspire), Sniper (Longeye), aura buffer
  (Warbanner), plus the existing Watchtower as the T1 root.
- `BuildingDef.upgradesTo: [idA, idB]` — click a placed tower → choose a path (LTD2's
  A/B commitment). Upgrades cost the C4 tiers.
- **Deliberately last:** it's the art-heaviest milestone, and the G1-P painterly-filter
  prototype (Kuwahara pass — parked in ROADMAP) should get its verdict FIRST so the new
  tower art is authored under whatever look wins. Doing C5 before G1-P risks authoring a
  building set twice.
- This milestone RESTORES the feel gate (it's a look milestone) + gets a playtest-agent
  run before the user verdict.

---

## Sequencing & effort (recommendation)

**C1 → C2 → C3 → C4 → (G1-P verdict) → C5.**
C1 small/hot, C2 tiny, C3 medium, C4 medium, C5 large+gated. Each ships per WORKFLOW:
worktree → static trio → merge → FULL Gauntlet + new tests → live acceptance → tag
(`v0.19-c1-echoes` onward). Feel gates stay RELAXED until C5 per the user's platform-era
call — but the playtest agent runs after each merge anyway (cheap regression sanity).

## The taste-decision menu — VERDICTS IN (quiz, 2026-07-16)

| # | Decision | Verdict | Was default? |
|---|----------|---------|--------------|
| T1 | Echo acquisition | **Fixed signature echo per lord** | yes |
| T2 | Loom point source | **Nights survived** — the danger clock, not the grind | **override** |
| T3 | Keystones in v1 | **Yes — all 4 build-warping keystones** | yes |
| T4 | Waystone loss | **Full collapse — disconnected buildings decay** | **override** |
| T5 | Cinder Trail | **Real fire-CA ignition from day one** (flag ships TRUE as kill-switch) | **override** |
| T6 | Batch order | **C1 echoes first** | yes |

## Non-negotiables carried forward

Veil & Lens law (echo/loom/gear names are pure fantasy; the Lens shows the numbers).
Everything data-driven (`data/echoes.ts`, `data/loom.ts`, effect keys — content is rows,
never engine code). No persistence — all of this is per-run, by design. Gauntlet
definition-of-done applies to every milestone. D5 is the single damage law: new damage
sources roll, they don't flat-add.
