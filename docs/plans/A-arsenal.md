# A — The Arsenal (the Hero Siege yoink)

> **Status:** **A1 + A4 + A3 + A5 SHIPPED 2026-08-21** (branch `dev/night-build`, unmerged).
> A2/A6–A8 planned, not implemented. Written 2026-08-21.
> **Supersedes nothing.** Additive to everything shipped through N4.3.
> **Touches:** `data/items.ts`, `data/enemies.ts`, `data/echoes.ts`, `ui/ui.ts`,
> `systems/drops.ts`, `systems/combat.ts`, `systems/hordes.ts`, plus new files
> (`data/affixes.ts`, `data/rarity.ts`, `data/weaves.ts`, `systems/loot.ts`,
> `systems/abilities.ts`, `systems/weaves.ts`, `ui/tooltip.ts`).
> **Does not touch** the N4 file set (`data/network.ts`, `systems/network.ts`,
> `systems/deepwire.ts`, `ui/lens/*`), so it can run in parallel with N4.4+.
> **Collides with N4.5 on exactly one thing** — the difficulty selector. See §5.7.

---

## 0. The ask

User direction, verbatim (2026-08-21):

> *"update our plan to yoink all the UI, gameplay, etc from hero siege!"*

---

## 1. What we take, and what we don't

We take **systems and interaction patterns**: rarity ladders, rolled affixes, elite packs,
an ability bar, orbs, comparison tooltips, loot beams, sockets, a gambler, difficulty
tiers. None of that is ownable — it is genre vocabulary, most of it older than Hero Siege
and inherited by it from Diablo II.

We do not take art, names, story, item text, or class identities. For this project that
costs us nothing: **pillar 1 means we have no asset pipeline to put borrowed art into.**
Every rarity colour is a hex value, every icon is already a procgen recipe, every affix is
a data row. The yoink is 100% mechanics, which is the only half that was ever worth having.

---

## 2. Honest audit — we already have most of Hero Siege

This is the part worth reading before scoping anything. NIGHTWARD is much closer to an ARPG
than its own docs let on, and roughly two thirds of what "yoink Hero Siege" implies is
already shipped under different names.

| Hero Siege system | NIGHTWARD today | Verdict |
|---|---|---|
| Top-down hack-and-slash combat | `systems/combat.ts` — windup→active→recovery, per-swing damage roll, enemy telegraphs | ✅ **ours is deeper** |
| Talent / skill tree | The Loom — 40 nodes, 3 branches, 4 keystones with real tradeoffs (GDD §9.3) | ✅ shipped |
| Waves of enemies | Night hordes, per-night scaling, 25 enemy types | ✅ shipped |
| Enemy variety / AI archetypes | 8 data-driven `EnemyBehavior` kinds — ranged, siege, exploder, buffer, healer, summoner, swarm | ✅ shipped |
| Act bosses | 5 world bosses / domain lords, each with a mood, a theme and a guaranteed relic | ✅ shipped |
| Relics / unique items | The Armory — 5 boss relics on a dedicated 6th slot (GDD §9.4) | ✅ shipped |
| Item effect hooks | **15 registered effect hooks** — see §3.1 | ✅ shipped, badly under-used |
| Loot on the floor, walk to collect | B5 — Ground Drops, all three sources, with toss/rest/collect beats | ✅ shipped |
| Floating damage numbers | `ui/floaters.ts` | ✅ shipped |
| Gear slots + equip | 7 soul-gear slots, each an independently levelling entity | ✅ **ours is stranger and better** |
| Potions / consumables | 2 healing consumables | ✅ thin but present |
| Town hub | The Hall is the run anchor | ~ exists, **does nothing but exist** |
| Permadeath / hardcore | The Lifespan — a hard ~15-minute clock (pillar 8) | ✅ **ours is the whole game** |
| Difficulty tiers | none — N4.5 plans one axis | ❌ **see §5.7** |
| **Rarity tiers** | **none. 67 hand-authored items, zero rolls** | ❌ **the big one** |
| **Rolled affixes / prefixes / suffixes** | **none** | ❌ **the big one** |
| **Elite / champion packs** | behaviour is per *type*, never rolled per *spawn* | ❌ |
| **Active ability bar** | Echoes are auto-firing only, "no activation input" (GDD §9.2) | ❌ |
| **Item tooltips / stat comparison** | **zero tooltips anywhere in the codebase** | ❌ |
| Health / mana orbs | thin top-bar HP/Vigor/Resolve bars | ~ wrong shape |
| Sockets / runes / runewords | none | ❌ |
| Vendors / gambler / blacksmith | none. **Gold has one sink in the entire game** | ❌ |
| Chests / shrines / loot goblin | none | ❌ |
| Minimap | `state.explored` exists with a `// future minimap` comment | ❌ |
| Classes | one archetype | ❌ — **and we should not add them, see §4.3** |
| Paragon / infinite levels | forbidden by pillar 3 | ❌ — **and stays forbidden** |
| Co-op multiplayer | no backend, out of scope permanently | ❌ |

---

## 3. The five gaps that actually matter

Ranked by how much play they add per unit of work, not by how big they sound.

### 3.1 There is no reason to pick up a second sword — and the fix is already built

This is the single defect this whole plan exists to fix. NIGHTWARD's 67 items form a
**strictly linear ladder**: copper → iron → silver → star. Once you know the ladder, every
drop is either an upgrade or litter, decided at a glance, forever. Hero Siege's actual
innovation over that — inherited from Diablo — is that **two items of the same base can be
wildly different**, so the ladder becomes a space and looking at loot becomes a decision.

The reason this is cheap for us: `grep registerEffect` returns **fifteen live, working,
already-consumed effect hooks**:

```
thorns_reflect  fire_aura      chill_aura    regen_boost  move_burst_on_kill
see_foe_hp      resonance_boost fire_on_hit  chill_on_hit lifesteal
chain_on_kill   dodge          gold_find     xp_boost     night_vision
```

They were built in C4 to serve **five relics**. Fourteen of the fifteen are reachable from
exactly one item each. The entire suffix half of an affix system — *"of the Ember", "of the
Leech", "of the Wisp"* — is a data table over hooks that already work, already have
consumers, and are already Gauntlet-covered. **A1 is mostly a `data/` edit.**

### 3.2 Every skeleton on night 6 is the same skeleton

`EnemyBehavior` is per-type and static: a Charger is a Charger in every spawn of every run.
Hero Siege's elite/champion packs are the thing that makes a wave *readable* — you scan the
field, you see the gold nameplate, you change your plan. We have the render hooks (nameplate
text, tint, aura rings from the tower/shrine work) and a spawn site that already rolls per
enemy. What is missing is the roll.

### 3.3 The bottom bar is verbs, not powers

GDD §12 already describes *"Diablo-style ~44px icon sockets with keybind corner tags"* —
the visual language is shipped. But the sockets hold **Interact, Attack, Ignite, Build**:
verbs, not abilities. Meanwhile five Echoes fire themselves with no input, which means the
most fantasy-flavoured system in the game is something the player watches rather than uses.

### 3.4 You cannot compare two items

No tooltips exist. In an ARPG the tooltip *is* the loot loop — the green `+4` and the red
`−2` are the entire dopamine payload, and picking up an item currently delivers none of it.

### 3.5 Gold is a number that goes up

One sink in the whole game (`hordes.ts:730`, scatter-cache to thin an incoming wave) plus a
death penalty. Gold is worth `×0.5` on the leaderboard and otherwise inert. Hero Siege's
gambler exists precisely to convert gold into loot anticipation, and we have a Hall sitting
there doing nothing but being destructible.

---

## 4. The collision — Hero Siege is a forever-character game and we are not

**This is the one decision in this plan that is not mine to make, so it is stated before any
design that depends on it.**

Hero Siege's meta-loop is: play a run, keep the character, keep the loot, get slightly
stronger, unlock a class, repeat for hundreds of hours. NIGHTWARD's pillar 3 says *"no
save/load, no login, no resuming a character"* and pillar 8 caps a run at **~15 real
minutes**. Those are not compatible, and the incompatibility bites hardest on exactly the
system we most want (§3.1): a rarity ladder is only exciting if you can climb it, and Hero
Siege gives you a hundred hours to climb it.

### 4.1 What breaks if we ignore this

Diablo-style drop rates inside a 15-minute window produce a ladder whose top four rungs no
player will ever see. We would ship six rarity tiers, and every run would be Plain and
Touched with a rare Woven. The tiers above would be content that exists only in the data
file — which is precisely the "dormant row" failure mode the Lens work spent two milestones
stamping out.

### 4.2 The three ways out
>
> **DECIDED 2026-08-21 — the user chose (a) + (b), as recommended.** Drop rates are
> tuned so the ladder is traversable inside one run, and a finished run's scorecard
> carries its best find as a trophy. Pillar 3 stands. Option (c) was not taken.

| | Approach | Cost | Keeps pillar 3? |
|---|---|---|---|
| **(a)** | **Compress the ladder into one run.** Tune drop rates so a competent 15-minute run reliably sees 2–4 Woven, ~1 Hallowed, and has a real (~25%) shot at a Sovereign off a lord. The ladder is traversable *because the run is short*, not despite it. | tuning only | ✅ yes |
| **(b)** | **Trophies on the scorecard.** The finished-run scorecard already persists. It records your best item — name, rarity, rolled affixes — as a trophy on the leaderboard. Nothing carries into the next run; the *memory* does. | small | ✅ yes — scorecards are the explicit carve-out |
| **(c)** | **A persistent stash / paragon.** True Hero Siege. Breaks pillar 3 outright. | large | ❌ **a conversation, not a commit** |

**Recommendation: (a) + (b).** Together they deliver the Hero Siege *feeling* — a ladder you
climb, a trophy you remember — inside the run structure that is this game's actual identity.
(c) is available and I will build it if asked, but it should be asked for explicitly, out
loud, because it changes what NIGHTWARD is.

Everything in §5 is written assuming (a) + (b). If you pick (c), A1's drop rates and A7's
tier structure change and nothing else does.

### 4.3 Classes: the one Hero Siege system we should decline
>
> **DECIDED 2026-08-21 — declined, as recommended.** No classes. Build identity
> continues to come from the Loom.

Hero Siege's classes are a *retention* mechanism — each unlock is a reason to start over
with a different kit. NIGHTWARD already has a per-run build system that does the same job
better inside our constraints: **the Loom**, whose four keystones are genuine identity
choices (Glass Echo is a glass cannon, Deep Roots is a turtle, Night Market is a greed
build). Adding classes on top would mean picking your identity *before* you know what the
wire is doing that run — which is backwards for a game whose premise is that the run's
character is decided by live conditions.

**Do not build classes. Build the Loom out instead** if we want more build identity — it is
the same fantasy, already shipped, and it composes with everything in §5.

---

## 5. The designs

### 5.1 A1 — Rarity & rolled affixes *(the one that matters)*

**New:** `data/rarity.ts`, `data/affixes.ts`, `systems/loot.ts`.
**Changed:** `ItemDef` gains nothing; a rolled item is a new `RolledItem` wrapper so the 67
authored rows stay exactly as they are.

Six tiers. Colours are chosen against the Grimdark Chrome palette (warm near-black iron,
brass), not against Hero Siege's, and every name is Veil-legal (pillar 7 permits *echo,
resonance, thread, rift, realm*):

| Tier | Colour | Affixes | Where it comes from |
|---|---|---|---|
| **Plain** | `#b9b2a4` bone | 0 | crafting, ordinary kills, gathering |
| **Touched** | `#6fa8dc` cold blue | 1 | night kills, common drops |
| **Woven** | `#e8c34a` brass | 2–3 | elites, night 3+ |
| **Hallowed** | `#b47ae0` violet | 3–4 | champions, cairns |
| **Sovereign** | `#f08a3c` ember | 4 + one unique | domain lords only |
| **Riftborn** | `#e0413e` blood | 5, **one of them cursed** | rift-realm drops only |

**Riftborn always carries a drawback.** A tier that is strictly better than the one below it
is a number, not a decision; the Loom's keystones already establish that the best things in
this game cost something, and the top rarity should be the loudest example of that rule
rather than an exception to it.

**Affixes** are prefix + suffix, Diablo-grammar, so an item reads as a sentence:
*"Keen Iron Blade of the Ember"*.

Prefixes roll onto existing `ItemDef` stat columns — `weaponDmg`, `armor`, `regen`,
`toolPower` — so nothing downstream needs to learn a new stat:

| Prefix | Rolls | Slots |
|---|---|---|
| Keen | +8–22% `weaponDmg` | weapon, ring |
| Heavy | +2–6 flat `weaponDmg`, −4% swing speed | weapon |
| Warded | +1–4 `armor` | armor, amulet |
| Deep | +0.4–1.2 `regen` | charm, armor |
| Swift | +3–8% move speed | armor, charm |
| Tireless | −10–25% Vigor decay | charm, amulet |
| Steady | −10–25% Resolve decay | amulet |
| Rooted | +10–30% building HP while worn | any |
| Hungering | +12–30% soul xp to this slot | any |

Suffixes are **the fifteen existing hooks**, one row each — zero new engine code:

| Suffix | Hook | Suffix | Hook |
|---|---|---|---|
| of the Ember | `fire_aura` | of the Leech | `lifesteal` |
| of the Rime | `chill_aura` | of the Chain | `chain_on_kill` |
| of the Thorn | `thorns_reflect` | of the Wisp | `dodge` |
| of the Tide | `regen_boost` | of Plenty | `gold_find` |
| of the Hollow | `see_foe_hp` | of the Scholar | `xp_boost` |
| of the Nightseer | `night_vision` | of the Quickening | `move_burst_on_kill` |
| of Kindling | `fire_on_hit` | of Hoarfrost | `chill_on_hit` |
| of Resonance | `resonance_boost` | | |

**The network hook — this is what stops it being a copy.** One new `NET_GAME_MAP` row:

```
Fortune (Aperture + Fray) → target 'fortune', clamp 0.75–1.35
```

A wide, clean wire (high `cwnd`, low `fray`) shifts the rarity roll upward; a frayed wire
shifts it down but **raises drop *quantity*** — a hostile network buries you in Plain items,
a clean one hands you fewer and better ones. That is a legible tradeoff, it uses N4.1's
genuinely measured kernel signals, and it means two players on `?seed=1234` open different
loot. Nothing in the fiction ever says the word "network" (pillar 7).

**Determinism note:** pillar 4 governs *worldgen*, not live rolls — the D5 per-swing damage
roll is already live-random. Loot rolls join it. `?seed=` still produces the same world,
the same nodes, the same spawns; what drops from them is live. State this in the GDD so
nobody later reports it as a determinism bug.

**Tuning target (per §4.2a):** a competent 15-minute run should end holding 2–4 Woven, ~1
Hallowed, with a ~25% shot at a Sovereign if a lord dies. **Write the drop-rate test first**
— a Gauntlet probe that runs 500 simulated drops and asserts the tier histogram, because
this is the number most likely to be silently wrong and least likely to be noticed.

⚠️ **The B5 trap applies here verbatim.** The gather tests famously never asserted inventory
gain. A rarity system can be entirely stubbed out — always roll Plain, never apply an affix —
and every existing test stays green. **Every A1 assertion must read the rolled item back and
check a stat actually changed on the player**, not that a roll function returned an object.

---

### 5.2 A2 — Elites & champions

**Changed:** `data/enemies.ts` (+`ENEMY_AFFIXES`), `systems/hordes.ts` (roll at spawn).

Rolled per *spawn*, not per type:

| Affix | Effect |
|---|---|
| Vigorous | ×2.2 HP |
| Swift | ×1.35 speed |
| Warded | flat 3 damage reduction |
| Kindled | fire aura (reuses `fire_aura`) |
| Venomous | stacking DoT on hit (reuses the poison-tower DoT) |
| Leeching | heals for 30% of damage dealt |
| Splitting | spawns 2 lesser copies on death |
| Anchored | ×3 damage to structures (reuses `siege`) |
| Unseen | 55% alpha beyond 6 tiles |

- **Elite** = 1 affix · brass nameplate · aura ring · guaranteed **Touched+** drop
- **Champion** = 3 affixes · violet nameplate · a pack of 3 minions sharing one affix ·
  guaranteed **Woven+** drop

Elite chance scales with night number, so night 7 reads as a siege rather than as a longer
night 1. Epithets come from `data/lexicon.ts`, which already exists for exactly this.

**Balance guard:** Vigorous + Warded + Leeching on a night-8 charger is an unkillable wall
inside a 15-minute clock. Affixes need a **conflict table** (no more than one of
{Vigorous, Warded}) and a per-night power ceiling. This is where A2 will actually go wrong.

---

### 5.3 A3 — The Echoes become an ability bar

**New:** `systems/abilities.ts`. **Changed:** `data/echoes.ts`, `ui/ui.ts`.

Four slots, keys `1`–`4`, in the existing 44px socket idiom with the existing keybind
corner tags. Cooldown sweep is a CSS `conic-gradient` — no assets, pillar 1 clean.

**Resolve is the resource.** We have no mana and should not invent one: Resolve is a morale
meter that already decays at night, near a boss, and while idle, and it already punishes you
at zero (−30% move, +50% damage taken). Spending it on heroics is exactly what a morale
meter is for, and it turns a passive dread meter into the most interesting number on screen.

The kit is **the five Echoes, promoted**. Each keeps its current auto-fire at base strength
and gains an *empowered* active form:

| Echo | Auto (today) | Active (A3) | Resolve |
|---|---|---|---|
| Thornring | thorns when foes press close | 360° burst, 3× damage, brief knockback | 18 |
| Cinder Trail | footprints smoulder | ignite a 5-tile line ahead | 15 |
| Rime Nova | cold blooms outward | freeze everything in 4 tiles for 1.5 s | 22 |
| Tide Lash | strikes the nearest foe | chained lash, 4 targets | 14 |
| Null Orb | one orb, grazing damage | three orbs, 8 s, doubled damage | 20 |

You hold up to 5 Echoes and the bar has 4 slots, so the last lord's echo forces a choice —
a build decision at the exact moment the run peaks.

---

### 5.4 A4 — The UI yoink

**New:** `ui/tooltip.ts`. **Changed:** `ui/ui.ts`, `ui/styles.ts`, `systems/drops.ts`.

Everything below is CSS gradients, `clip-path`, and Pixi sprites we already pool.

1. **Orbs.** HP as a bottom-left globe, Resolve bottom-right, Vigor as a ring around the HP
   globe. Pure radial-gradient + a `clip-path` liquid fill that sloshes on change. This is
   the single highest-impact visual change in the plan and it is roughly 80 lines of CSS.
2. **Comparison tooltips** *(the loot loop)*. Hover any item — bag, ground drop, vendor —
   and get: name in its rarity colour, base line, each rolled affix on its own line, and a
   **green/red delta against whatever occupies that slot right now**. Without this, A1 is
   invisible to the player.
3. **Loot beams.** Rarity-coloured vertical light shaft on Woven+ ground drops, with the
   item name floating above it. Additive sprite, reuses the existing particle textures. B5
   already put the item on the floor; this is what makes you *want* to walk to it.
4. **Rarity colour everywhere** — bag, floaters, log lines, the death scorecard.
5. **A minimap.** `state.explored` has carried a `// future minimap` comment long enough.
   Corner canvas, chunk-resolution, showing the Hall, drops, and lords.

---

### 5.5 A5 — Sockets & Weaves *(Hero Siege's runewords)*

**New:** `data/weaves.ts`. Deliberately phased late — it multiplies A1's state space.

Gear rolls **0–3 sockets** by tier. **Threads** drop from elites (Veil-legal: "thread" is
Loom vocabulary and the Loom is already about weaving a run). Slotting threads in a
recognised *order* completes a **Weave** with a named bonus:

| Weave | Sequence | Bonus |
|---|---|---|
| The Long Night | Rime · Rime · Ember | +25% damage while it is night |
| Hollow Song | Null · Tide | kills restore 4 Resolve |
| Ironwake | Thorn · Thorn | reflected damage also stuns |

Threads are removable but **the weave breaks when reordered** — the same no-respec logic as
the Loom, for the same reason: a run is its weave.

---

### 5.6 A6 — The Hall becomes a hub

**Changed:** `data/buildings.ts`, `systems/economy.ts`.

Two buildable Hall-adjacent structures, giving gold its first real sink (§3.5):

- **The Reliquary** *(the gambler)* — pay gold for an **unidentified** item: you buy the
  slot and the tier weighting, never the roll. Price scales with the tier floor you pay for.
  This is the purest loop in Hero Siege and it costs us one panel.
- **The Forge-Warden** *(the blacksmith)* — reroll **one** affix on one item for gold +
  materials. One affix, not all, so it is a repair for a near-miss rather than a slot
  machine that deletes the drop loop.

**Open balance question in §9:** tribute income is currently tuned against a world where
gold does nothing. Adding two sinks changes what the `goldRate` mapping and the Night Market
keystone are worth, and the leaderboard's `gold×0.5` weight starts competing with spending
it. Expect a retune, and do it *after* the playtest, not before.

---

### 5.7 A7 — Difficulty tiers ⚠️ **collides with N4.5**

Hero Siege has Normal → Nightmare → Hell → Inferno. **N4.5 already plans a difficulty axis**
— the data-budget opt-in, where the tier you pick is both your bandwidth consent and your
difficulty (ROADMAP, N4 §8 Q1, user-directed).

**Do not build a second difficulty axis. They must be the same selector.** Two independent
difficulty systems is the kind of thing that ships because two plans were written by the
same person on different days, and it makes both unbalanceable.

Concretely: N4.5's tier picker gains ARPG-shaped consequences — enemy HP/damage scaling,
a rarity-weight floor that rises per tier, and a Riftborn drop that is **tier-gated to the
top two**. One control, two vocabularies: the Veil calls it a covenant, the Lens calls it a
data budget.

---

### 5.8 A8 — Chests, shrines, and the Hoarder

Cheap, high-flavour, all reusing shipped systems:

- **Cairns** *(chests)* — a `features.ts` row, opened with the existing gather interaction,
  guaranteed **Hallowed+**. Rare, visible from range, worth crossing the map for.
- **Shrines** — a world feature granting a timed buff. `effects.ts` already has the timed
  buff machinery (Nightseer Charm). A shrine is a data row plus a toast.
- **The Hoarder** *(the loot goblin)* — a rare `daytime` enemy that flees on sight and
  bursts loot on death, despawning if it escapes. Needs one new `EnemyBehavior.kind: 'flee'`
  — the only genuinely new engine code in A8, and it is small.

---

## 6. Where the borrowed ideas have to change

| Hero Siege does | We must instead | Why |
|---|---|---|
| Keeps your character forever | Compress the ladder into 15 minutes (§4.2a) | pillar 3, pillar 8 |
| Names tiers Satanic / Angelic / Heroic | Plain / Touched / Woven / Hallowed / Sovereign / Riftborn | pillar 7 — the Veil is our fiction, not a borrowed one |
| Ships item art per rarity | Recolour + emboss the existing procgen icon recipe | pillar 1 — there is no asset pipeline |
| Mana bar for abilities | Resolve (§5.3) | we already have a morale meter that punishes you at zero |
| Classes for build identity | Build out the Loom (§4.3) | identity should follow the run, not precede it |
| Flat RNG loot | Rarity weights ride a `NET_GAME_MAP` row (§5.1) | it is the premise of the entire game |
| Separate difficulty ladder | One selector shared with N4.5 (§5.7) | two difficulty axes cannot both be balanced |

---

## 7. Risks

1. **Balance surface explodes.** 6 tiers × 9 prefixes × 15 suffixes × 7 slots is a bigger
   number-space than everything shipped to date combined, landing on a 15-minute clock. The
   histogram test in §5.1 is not optional.
2. **A2 makes nights unwinnable.** Rolled enemy affixes multiply against per-night scaling
   *and* the Fray mapping *and* a Surge omen. Fray and Surge already compound to ×1.81 horde
   speed (flagged in the N4.3 verdict, still un-adjudicated). Elite affixes stack on top of
   that. **A2 must not ship before the N4.3 balance verdict is in.**
3. **Tooltips are the whole loop and are easy to under-build.** A tooltip that lists stats
   but does not *compare* delivers none of the payload. Build the delta first.
4. **The green-Gauntlet trap, third time.** B5's gather tests never asserted inventory gain;
   the Lens CHANGES panel never displayed anything and nothing went red; the wall-collision
   test passed on a player that never moved. A rarity system stubbed to always-Plain is
   invisible to every existing assertion. Assert **through to a player stat**.
5. **Scope.** A1 + A4 alone is a large milestone. A5–A8 are genuinely optional and should be
   allowed to not happen.

---

## 8. Phasing

Each phase independently shippable, in dependency order. **A1 + A4 together are the yoink**;
everything after is depth.

| Phase | Contents | Why here |
|---|---|---|
| **A1 — The Roll** ✅ | `rarity.ts`, `affixes.ts`, `systems/loot.ts`, the `fortune` mapping row, drop-histogram tests | Everything else decorates this. Mostly data, because the 15 effect hooks already work. **Shipped 2026-08-21.** |
| **A2 — Elites** | `ENEMY_AFFIXES`, spawn-time roll, nameplates, aura rings, conflict table | Needs A1 to have something to drop. **Gated on the N4.3 balance verdict.** |
| **A3 — The Bar** ✅ | `systems/abilities.ts`, Echoes promoted to actives, Resolve as the cost, cooldown sweeps | Independent of A1/A2; ran in parallel. **Shipped 2026-08-21.** |
| **A4 — The Face** ✅ | orbs, comparison tooltips, loot beams, rarity colour everywhere, minimap | Makes A1 visible. **Shipping A1 without A4 ships an invisible feature.** **Shipped 2026-08-21.** |
| **A5 — Weaves** ✅ | sockets, threads, `weaves.ts` | Multiplies A1's space; wants A1 tuned first. **Shipped 2026-08-21.** |
| **A6 — The Hub** | Reliquary, Forge-Warden, gold retune | Wants A1's tier weights settled. |
| **A7 — Covenants** | merge with N4.5's data-budget tier selector | **Blocked on N4.5.** Do not start early. |
| **A8 — Cairns & the Hoarder** | chests, shrines, loot goblin, `flee` behaviour | Pure flavour. Slot anywhere after A1. |

**First cut A1 + A4 — shipped 2026-08-21.** That is the Hero Siege loop: kill, see a
coloured beam, walk over, read a tooltip, feel the upgrade. Gauntlet 1744/1744 across 107
tests, 20 consecutive green runs, typecheck clean on both configs. See the ROADMAP entry
for what the build actually found.

**Next in this batch: A2 (Elites).** A2 remains gated on the N4.3 balance verdict. A5 shipped
2026-08-21 — see the ROADMAP entry.

---

## 9. Open questions

**Answered 2026-08-21** (user: *"i agree!!! gogogo!"*):

1. ~~§4.2~~ — **(a) + (b).** Ladder compressed into one run; trophy on the scorecard.
   Pillar 3 stands.
2. ~~§4.3~~ — **classes declined.** Build the Loom out instead.
3. ~~§5.7~~ — **A7 merges into N4.5's selector.** One control, two vocabularies.
4. ~~§8~~ — **first cut A1 + A4**, both shipped.

**Closed by the C4 repair, 2026-08-21:**

0. **A1's premise was half false and is now true.** The brief said the suffix half of the
   affix system was "a data table over hooks that already work". Seven of the fifteen hooks
   did not work — they had a registered handler and no consumer — so all five relics and
   ~47% of suffix weight were placebo. All seven now have a live consumer and a matched-pair
   test. See the ROADMAP entry for the full audit.

**Still open:**

5. **§5.3 — is Resolve the right ability cost?** Built on Resolve 2026-08-21 (A3 shipped).
   It makes a currently-passive meter the most active number on screen, but it also means a
   bad Resolve run has no abilities at all, which may read as a punishment stacked on a
   punishment. This is now a playtest verdict, not a blocker — the alternative would have
   been inventing a mana bar the game has never had.
6. Two N4.3 balance items still await a verdict and **A2 is gated on them**:
   `CFG.omens.surgeFxStrength` (0.5 may be too strong) and Fray × Surge compounding to
   ×1.81 horde speed.
7. **New, from the A1 build:** `heavy` can roll `+2–6` flat damage at Touched, so a lucky
   blue copper blade can beat a plain iron one. That is the Diablo experience working as
   intended — it is what makes a low-tier drop worth reading — but it is a deliberate
   inversion of the copper→iron→silver→star ladder and worth a look in the playtest.
8. **New:** a Riftborn weapon measured ×2.23 base damage (9 → 20.08) in the smoke probe.
   It is ~0.35% of rift-band drops, it always carries a curse, and rift-band drops only
   happen for 60 s after a rift — but it is the largest single number A1 can produce.
9. **New, from the A5 build:** threads drop from domain lords (2 per kill, matching the
   lord's element), not from elites — A2's elites do not exist yet, so the lord is the
   interim source and the plan's "threads drop from elites" stays on the A2 ticket.
   A full clear of five lords is ten threads: enough for Long Night (3) plus Ironwake (2),
   or Hollow Song (2) plus spares. Worth a look in the playtest, alongside A5's socket
   economy — a 3-socket vessel only exists on Hallowed-and-up, so The Long Night is gated
   behind both the threads AND the vessel.
