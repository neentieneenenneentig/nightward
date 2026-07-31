# NIGHTWARD — Game Design Document

**This is the source of truth for what the game IS.** Last updated 2026-07-31 (post-L1
"The Lifespan"). When this document and any other doc disagree, this one wins — file a
correction here, don't let the disagreement stand.

**Document map** — four docs, four jobs, don't blend them:
- **This file (`docs/GDD.md`)** — what the game is, right now. Design, systems, numbers.
  No dates, no "who built what when." If it's true today, it's in here; if it changes, this
  file changes with it.
- **`docs/plans/ROADMAP.md`** — the build log. Chronological, dated, "what shipped when and
  why," playtest verdicts, deviations, bugs found and fixed. Read it for history; don't read
  it for current truth (parts of it are stale the moment a later session changes course —
  this file is what supersedes it).
- **`docs/plans/WORKFLOW.md`** — how we work. Branching, verification, the Gauntlet, known
  pitfalls, harness gotchas.
- **`docs/plans/<ID>-*.md`** — individual milestone briefs, written while a milestone is in
  flight. Once it ships, its facts get folded into this doc and its history into ROADMAP.md,
  and the brief itself gets deleted — don't let these pile up indefinitely (they did, once;
  30-odd of them got cleared out on 2026-07-31 for exactly this reason).

---

## 1. Vision

**Your internet connection is the world you're dreaming, and you only get one dream.**

NIGHTWARD is a browser-based survival-RPG played in a single sitting of roughly fifteen
minutes. You wake into an infinite, procedurally generated world shaped by your actual
network connection — a good connection means a hard, bright, fast game; a bad one means a
slower, stranger, more forgiving one. You gather, craft, build a small fortified hold,
and fight off hordes that grow with every night you survive and every scrap of territory
you claim. Roaming domain lords hunt you. You get stronger — skills, soul-bound gear,
boss echoes, a passive tree — inside the one life you're given.

That life is short on purpose. You age in real time, and your years run out whether or
not anything kills you first. There is no save, no login, no persistent character —
closing the tab ends the dream, and even surviving to old age ends it too, just more
gently. What persists is a scorecard: how far did you get, this time, before the years
caught up? The game is built to be replayed for a **better run**, not extended into an
endless one. NIGHTWARD is a **roguelike sprint** in the shape of a survival-RPG: RuneScape's
skill-grind satisfaction and Vampire Survivors' escalating-horde tension, compressed into
one finite, high-stakes sitting, with your real internet connection as the dungeon seed.

---

## 2. Design pillars (non-negotiables)

These are load-bearing. A change to any of these is a conversation, not a commit.

1. **100% procedurally generated.** No hosted image or audio assets. Every sprite, tile,
   sound, and UI surface is generated from a seed + parameters at runtime. (Historically
   the UI chrome was a documented exception — RPGUI, a bundled zlib-licensed asset pack.
   That exception no longer applies: U1 removed RPGUI entirely in favor of pure-CSS
   styling, and U2 re-skinned it again, still pure CSS. The rule is now unconditional.)
2. **Data-driven, always.** Content is a row in `src/game/data/*`. Systems in
   `src/game/systems/*` are generic functions over one `GameState`. Adding an item, enemy,
   building, echo, or network mapping is a data edit, never new engine code. `window.NW.CFG`
   is the live, runtime-editable balance file — tune it in the console, no reload.
3. **No persistence, except finished-run outcomes.** No save/load, no login, no resuming a
   character. The world exists only in the open tab. The one carve-out: a **finished run's
   scorecard** (stats + legacy score, never live state) may persist to `localStorage`, so a
   "best run" leaderboard can exist without contradicting "you only get one life."
4. **Determinism from seed.** The same `?seed=` always generates the same world. Two
   players on the same seed diverge only because their *live* inputs (network conditions,
   real clock, their own choices) differ — never because of hidden randomness in worldgen.
5. **Browser-native network data only, with graceful degradation.** All network signal
   comes from `navigator.connection`, the Performance API, `fetch()` timing, and the real
   clock — no native binaries, no backend, no required permissions. Every metric has a
   documented neutral fallback so an unsupported browser (Firefox, Safari) still gets a
   complete, balanced, playable game — just without the live variance.
6. **Two-language rule.** The Rust/wasm core (`nightward-core`) is *generic simulation
   machinery only* — the writable-world store, the fire cellular automaton, batch upload
   plumbing. It has zero opinions about game content or balance. Every number a player can
   feel — damage, spawn rates, item stats, network→game mappings — lives in TypeScript data
   tables, uploaded to the core, never hardcoded in Rust.
7. **The Veil and the Lens.** Two layers, one bridge, never mixed. **The Veil** is the
   fiction — everything the player reads in the log, in toasts, in names — and it is pure
   fantasy: no network jargon, ever. Allowed mystical vocabulary: beacon, echo, resonance,
   pulse/flow/flux, thread, rift, realm. **The Lens** (the `O`-key observatory panel) is the
   opposite: every raw number JavaScript can actually read, honestly labeled, including
   browser limitations ("RTT quantized to 25ms by browser"). **The bridge** is that live
   network data silently drives fiction-layer outcomes (realm choice, enemy naming
   epithets, damage rolls, spawn pacing) without ever being *named* in the fiction. If a
   design change would put a network term in player-facing text, it's wrong; if a Lens
   number doesn't honestly reflect what the browser actually reports, it's wrong.
8. **The Lifespan — a hard run, not an idle sim.** A run is bounded to roughly fifteen real
   minutes by an in-fiction character lifespan that ages in real wall-clock time and ends
   the run in death of natural causes, independent of combat. This cap cannot be extended
   by skill or bypassed by cheats (see §11) — it can only be *shortened* by playing badly.
   The game is won by what you accomplish inside the window, not by surviving longer than
   it.

---

## 3. The core loop

### 3.1 Moment to moment
Move with WASD/touch. **Gather** (`E`) wood, stone, ore, and herbs from world features.
**Craft** (`C`) tools, weapons, armor, and consumables at three skill tracks. **Build**
(`B`, a cycling placement carousel — no popup menu) a hall, walls, and towers, anchored to
your hall or chained outward through waystones. **Attack** (`Space`/click) with a weighty
windup→active→recovery swing, not an instant hit. **Ignite** (`F`) flammable ground with
the real fire simulation. Check your **Bag** (`I`), **Skills** (`K`), and event **Log**
(`L`); open the **Lens** (`O`) to see the raw network truth driving everything; check the
**Leaderboard** (`;`) to see how your run stacks up.

### 3.2 The day/night rhythm
A day/night cycle is 340 seconds (240s day + 100s night — a bit over five and a half
minutes), so a full ~15-minute run spans roughly **two to three cycles**. Daytime is safe
build-and-gather time, with sparse daytime prey mobs roaming for loot. At dusk, night
hordes spawn and converge on your hall; towers and your own melee are the defense. Hordes
scale with night number, your territory score, and your hoarded gold (greed draws danger) —
by the second or third night of a run this is a real siege, not a formality.

### 3.3 The run: age, death, and the score
This is the structural layer everything else sits inside — see §11 for full detail. In
short: your character ages in real time toward a seeded ~15-minute target. When the years
run out, the run ends peacefully ("THE DREAM FADES"). If your hall falls to a horde or
lord first, the run ends violently ("THE THREAD IS CUT"). Either way, a scorecard is
computed — a **Legacy Score** weighing nights survived, kills, bosses, buildings, Loom
points, gold, and years lived — and saved to a local leaderboard. Reload for a new seed,
new connection-driven world, new attempt at a better run.

---

## 4. The world

### 4.1 The overworld
An infinite, seeded, tile-based (32px tiles) world generated by noise + domain warping.
**24 materials** exist (ids 0–23): 9 base biome-style terrains (Deep water, Water, Sand,
Grass, Meadow, Forest, Hill, Mountain, Snow), 7 writable ground materials the world engine
can turn tiles into at runtime (Dirt, Ash, Ice, Mud, Gravel, Tilled Soil, Shallows — via
fire burnout, farming, god-brush, etc.), and 8 "realm-warped" exotic materials (Fading
Zone, Flux Crystal, Verdant Bloom, Dead Zone, Scorch Wall, Azure Vein, Warp Rift, Ley
Bloom) that carry real gameplay effects — damage-per-second, regen multipliers, stun on
entry, xp/soul-xp multipliers, build-speed changes, blocked gathering, a speed burst on
exit. Every material has a `heightClass` (0 water / 1 ground / 2 hill / 3 mountain-snow)
that drives dual-grid autotile blending and cliff-ledge rendering. Terrain features
(trees, rocks, herb patches, berry bushes) can merge into big **mega clusters** — a
deterministic root lottery that upscales a 2×5-tile square into one giant chunky sprite,
scaling harvest time and loot rolls with area.

The world engine is a Rust/wasm core: a sparse override store lets any tile be permanently
changed (fire burnout, farming, the debug god-brush), a per-chunk cellular automaton runs
real fire (fuel/burn/wet fields, wind-driven spread, glow overlay), and everything crosses
the JS/wasm boundary as batched, zero-copy typed-array uploads — never per-tile calls.

### 4.2 The Wire: your connection is the physics
Live browser network metrics don't just flavor the game — they parameterize it. **19
tracked metrics** (RTT, downlink, jitter, an internally-computed "echo jitter," connection
effective-type/type, online state, time-of-day, CPU cores, device memory, endpoint
latency, page DNS/TLS/TTFB timing, battery level/charging, locale, timezone, JS heap used)
feed **22 game-facing mappings**: sim speed, gold rate, enemy scale, day-phase pacing,
realm selection, damage roll, move speed, gather speed, xp rate, every vigor/resolve
decay-and-restore rate, resource yield, and regen rate. Every mapping is a data row
(`src/game/data/network.ts`), transform function included, editable live via
`window.NW.NET.mappings` — never hardcoded logic. Time-feel multipliers (sim speed, move
speed) are deliberately clamped tight (0.85–1.15×) because wide swings there read as lag,
not gameplay; outcome multipliers (damage, most economy/vitals rates) are allowed a much
wider band (roughly 0.3–1.5×) because that reads as *the world responding to you*.

Every metric has a neutral fallback default so unsupported browsers (Firefox, Safari lack
`navigator.connection` entirely) still play a complete, balanced game.

### 4.3 Domains & lords
The world is divided into 40×40-tile regions, each deterministically assigned one of five
**Domain Lords** (plus a safe origin region, "The Hollow," with no hunting lord) and given
a procedural two-word name (e.g. "The Whispering Reach"):

| Lord | Domain | Boss | Mood tint |
|---|---|---|---|
| — | the Verdant Reach | Thornwarden | soft green |
| — | the Ashen Weald | Cindermaw | ember orange |
| — | the Pale Rampart | Rimewraith | ice blue |
| — | the Drowned Deep | Tideculler | teal |
| — | the Sunken Deep | Nullmaw | void violet |

A region's `danger` rating is its ring-distance from the origin. Each lord's namesake is
also the **world boss** that roams that domain and converges on your territory once it
notices you (territory score or hoarded gold above a threshold) — see §10.3.

### 4.4 Realms, rifts, and the Lens
The *realm* your connection currently resembles (its visual/mechanical "biome" flavor) is
derived from your beacon-echo latency **profile** (median + variance across probed
endpoints), not raw `connection.type` — desktop browsers hide that field entirely, so
deriving realm from it would leave desktop players permanently stuck on one realm. A large
profile shift is a **rift**: a screen flash, a toast, and (mechanically) a fresh realm
assignment. Identity data (IP, ISP, city, ASN) is never probed automatically — it fires
only after the player's first `explore` action ("scrying reveals who you are"), and the
Lens UI accurately reflects "unrevealed" until then.

The **Lens** (`O` key) is the truth panel: eight sections — Connection, Realm Profile,
Routes, Identity, Vessel (hardware), Threads (every live game-mapping row, with `dormant`
rows dimmed if a system hasn't wired them yet), Feed (recent truth-kind log entries), and
an **inspect mode** — hover or tap any row to see its SOURCE (which browser API), ACTION
(what triggers it), and FLOWS INTO (what game values it feeds). This is deliberately
"teach the player real network monitoring while they play," not just flavor.

---

## 5. The player

### 5.1 Core stats
- **HP** (100 max): regenerates during daylight only (`+1.5/s` base, boosted by charm
  trinkets and the network `regenRate` mapping). Losing all HP in combat scatters you
  (drops a fraction of gold, teleports you 40–110 tiles from your hall, resets Vigor/
  Resolve to half) — it does **not** end the run. Only the hall falling, or old age, ends
  a run.
- **Vigor** (0–100): a hunger/action meter. Decays constantly (full→empty in ~4 minutes at
  baseline), restored by killing, gathering, and standing near a lit campfire. At zero,
  you take ongoing starvation damage.
- **Resolve** (0–100): a morale/dread meter. Decays faster at night, near a hunting world
  boss, or while idle; restored by fighting, building, and surviving nights, and passively
  near your hall. At zero: −30% move speed, +50% damage taken, and a pulsing red vignette.
- **Age** (years, starts at 16): see §11 — the run's hard clock.

### 5.2 Skills (8 total)
Gathering: **Woodcutting, Mining, Foraging.** Crafting: **Crafting, Smithing, Alchemy.**
Plus **Combat** and **Firemaking.** RuneScape-style leveling — xp to next level scales as
`base × growth^(level−1)` (`400 × 1.32^(L-1)`, cap 50). Combat level grants a small flat
damage bonus every 5 levels.

### 5.3 Movement & presentation
4-direction baked sprite frames (not a 360° rig — that was built once, shipped, and
explicitly reverted after a playtest verdict; do not rebuild it without being asked
again). `aimAngle` (a true continuous input angle, independent of the 4-way facing) drives
where swings and aim actually point, so diagonal combat doesn't feel snapped to a grid even
though the sprite itself only has four poses.

---

## 6. Combat

Melee is a committed **windup → active → recovery** state machine, not a flat-cooldown
tap: `0.22s windup → 0.12s active (damage resolves once, here) → 0.30s recovery`, shrinking
with weapon soul level down to a floor of 0.5× the base envelope. Movement slows to 0.35×
mid-swing — attacking is a real commitment, not a free action while strafing.

**Damage is a per-swing seeded roll**, not a flat number: base damage (fists + weapon +
combat-level bonus) is multiplied by a roll in roughly the 0.30–1.50× band (config-driven,
"lightning bands" — width widens with connection jitter), plus a possible **resonance
crit** (a fast beacon-echo probe resolving during windup grants a bonus multiplier). The
Loom's Glass Echo keystone remaps this to the top half of the band at the cost of half max
HP — a real glass-cannon choice.

**Pressing attack again mid-swing restarts it** — dealing damage immediately and resetting
to windup — rate-capped at a minimum interval so it can't be turned into unbounded
autoclicker DPS. This is intentional, requested design: spam-clicking trades *reaching
recovery* (and its implicit defensive reset) for rapid single-target bursts. It is not a
bug and should not be "fixed" into something safer without being asked.

**Enemies telegraph.** Instead of hitting the instant they're in range and off cooldown,
foes commit to a visibly-tinted, blinking wind-up that only lands if you're still in reach
when it resolves — stepping out during the tell whiffs it. This is the primary combat
counterplay layer; night fights are winnable on reaction, not just stat checks.

**25 enemy types exist, 5 of them world bosses** (never spawn in ordinary hordes). Regular
enemies carry data-driven behavior flags: `ranged` (fires sim-tick projectiles with a
spark trail — not real-time `setTimeout`, so they respect pause/slow-mo), `siege`
(multiplied damage vs. structures), `exploder` (detonates on death), `buffer` (boosts
nearby allies), `healer`, `summoner` (spawns more foes), `swarm` (numerous, individually
weak). **Towers** fight autonomously with 7 distinct roles — splash, slow, sniper
(highest-HP-priority targeting; the Deadeye ultimate executes below 30% HP), aura (buffs
nearby towers), chain (arcing lightning with falloff), poison (stacking DoT that can spread
on a kill), and stun.

---

## 7. Gathering, crafting & items

**67 items total**: 6 tools (flint/copper/iron tiers for axe and pick — no silver/star
tools), 8 weapons (a linear copper→iron→silver→star blade progression plus four X1
elemental sidegrades — Fire Brand, Frost Edge, Void Blade, Storm Caller — that trade the
linear power curve for on-hit effects), 5 armors, 18 trinkets across ring/amulet/charm
slots, 23 raw materials/resources, 2 healing consumables, and 5 unique boss relics (§9.4).

**45 recipes** across three crafting skills: 10 general crafting, 29 smithing, 6 alchemy.
The metal progression is **copper → iron → silver → star**, unlocked by smithing level;
the four elemental weapons sit alongside iron/silver as a sidegrade, not a strict upgrade.

**Soul-feeding**: any feedable material (raw resources, not finished gear) can be consumed
directly into a soul-gear slot's xp instead of used for crafting. Each material can carry a
`soulAffinity` toward one specific slot — feeding it there is a 1.5× xp bonus, feeding an
*opposed* slot is a 0.5× penalty, anything else is neutral. This gives every resource a
second use once you have more of it than you need to craft.

---

## 8. Buildings & territory

**32 building types.** The **Hall** (Hearthstone) is unique and the anchor of everything —
lose it and the run ends. **Walls** (Palisade, with Stone Rampart and thorned Iron Bulwark
upgrades) auto-connect into a 16-case neighbor-bitmask rendering. **Huts** grow population;
population and territory score both come from what you've built. Three **traps** (spike,
tar-slow, flame-AoE). Three **utility buildings** — Workshop (craft-speed aura), Granary
(forage-yield boost), Shrine (buffs towers standing in its radius). Fifteen **towers**,
tiered T1→T2→T3 in Legion-TD-style upgrade paths (e.g. the base Watchtower forks into an
Ember/splash line and a Frost/slow line, each culminating in an ultimate — Inferno/Forge or
Glacier/Hail).

**Placement is anchor-chained, not just hall-radius.** You may build within
`CFG.build.maxDistFromHall` (18 tiles) of the Hall *or* of any placed **Waystone** — and
waystones themselves must be placed in range of the Hall or another waystone. This lets a
player push the buildable frontier outward link by link, at the cost of a fragile supply
line: destroy an anchor and everything beyond it that's no longer in range of a surviving
anchor starts **decaying** (8 HP/sec — a waystone lasts ~50s under decay, a wall ~32s)
until a new anchor comes back in range or it's destroyed, and losing a decaying waystone
can cascade the collapse further outward. Losing the Hall itself is the other terminal
condition for a run.

---

## 9. Progression systems

Four systems layer on top of skills/gear, all scoped to a single run — there is no
persistence, so every system here is designed to be worth investing in even inside fifteen
minutes.

### 9.1 Soul Gear
Every equip slot (**weapon, armor, tool_axe, tool_pick, ring, amulet, charm** — 7 slots) is
itself a leveling entity, independent of whatever physical item currently fills it: the
slot's `level`/`xp` persist across every gear upgrade forever, only the item's *base* stat
changes when you swap gear. Leveling curve: `250 × 1.085^(level-1)` xp per level, cap 100 —
retuned in L1 from a much steeper original curve so the *first* few levels are reachable
inside one run's combat budget, while the long tail still stretches toward "hundreds of
actions to max," RuneScape-style. Xp sources: landed swings (weapon/ring), hits taken while
worn (armor/amulet), successful gathers (tools), kills while worn (charm, ×10 on a boss
kill) — plus direct soul-feeding (§7).

### 9.2 Echoes of the Slain
Exactly **5 signature echoes**, one per domain lord, granted automatically the first time
you (or anything else) kill that lord and leveled further (cap 8) on every re-kill:

| Echo | Granting lord | Effect |
|---|---|---|
| Thornring | Thornwarden | a thorn ring erupts around you when foes press close |
| Cinder Trail | Cindermaw | your footprints smoulder and burn (ignites the real fire CA) |
| Rime Nova | Rimewraith | cold blooms outward, damaging and slowing everything it touches |
| Tide Lash | Tideculler | strikes the nearest foe at range |
| Null Orb | Nullmaw | a void orb orbits you, damaging what it grazes |

These are auto-abilities — always active once granted, no activation input.

### 9.3 The Loom
A per-run passive tree, 40 nodes total: 36 small nodes across three 12-node branches — 
**War** (melee damage/swing-speed/arc-width/crit-floor), **Field** (gather speed,
double-yield chance, cheaper crafting, move speed), **Ward** (building HP, armor, tower
damage/range, territory income) — plus 4 keystones, one per late branch node, each a real
tradeoff:

| Keystone | Branch | Effect |
|---|---|---|
| Glass Echo | War | damage rolls use only the top half of the D5 band; max HP halved |
| Deep Roots | Ward | buildings +50% HP, towers +1 range; move speed −12% |
| Night Market | Field | gold rate +40%; gold rouses world bosses at half the usual threshold |
| The Long Thread | Field | +1 Loom point per 4 total skill levels; skill level cap raised to 80 |

Points come from **surviving a night** (flat 1/night) and, as of L1, **slaying a boss**
(+2) — the second source exists specifically because 1/night alone barely samples a
40-node tree inside a 15-minute run. There is no respec: a run *is* its weave.

### 9.4 The Armory (relics & item effects)
Items can declare data-driven `effects` hooks (thorns_reflect, fire_aura, chill_aura,
regen_boost, move_burst_on_kill, see_foe_hp, resonance_boost, lifesteal, chain_on_kill,
dodge, gold_find, xp_boost, night_vision). Five of these are **unique boss relics** — a
guaranteed drop from its lord, occupying its own 6th equip slot (separate from the normal
weapon/armor/trinket slots):

| Relic | Lord | Effect(s) |
|---|---|---|
| Thornwarden's Bramble Heart | Thornwarden | thorns_reflect |
| Cindermaw's Ember Core | Cindermaw | fire_aura |
| Rimewraith's Frost Shard | Rimewraith | chill_aura |
| Tideculler's Ebb Pendant | Tideculler | regen_boost, move_burst_on_kill |
| Nullmaw's Hollow Eye | Nullmaw | see_foe_hp, resonance_boost |

---

## 10. Enemies & threats

### 10.1 Night hordes
Spawn at dusk, scale with night number, current territory score, and hoarded gold
(greed = danger — a wealth threshold both increases horde size and starts admitting
boss-tier enemy types into ordinary waves). Base wave ~25 enemies, escalating hard per
night; walls meaningfully break under sustained pressure rather than tanking forever.
Survivors flee at dawn.

### 10.2 Day prey
A sparser, roaming population of daytime enemies (never targeting the hall) that exist to
give you something to hunt for loot between nights, rather than idling until dusk.

### 10.3 World bosses (domain lords)
Each of the 5 lords roams its home domain and only turns hostile toward *you* once
provoked — by your territory score crossing a threshold, your gold crossing another, or by
actually landing a hit on it (which forces aggression for a fixed window regardless of
anything else). Slain lords revive stronger after a cooldown, deeper in their domain. They
collide with and chew through palisades (the hall alone stays untouchable short of the
hall's own destruction condition), so a walled-in turtle strategy is not a way to ignore
them.

---

## 11. The Lifespan & Legacy Score

*(Shipped 2026-07-31, "L1." The newest and currently most structurally important system —
everything above happens **inside** this.)*

### 11.1 Why this exists
Before L1, nothing ever ended a run except the hall being destroyed — and the leaderboard
ranked by how long the tab had been open. That made turtling behind walls, doing nothing,
the objectively optimal play: the dominant "high score" strategy was to survive combat and
otherwise idle. L1 replaces that with a bounded, replayable structure: a fixed-ish real-time
window, and a score that rewards what you *do* inside it.

### 11.2 Aging
Your character starts at **age 16** and ages via **real wall-clock time** (not sim time —
this has to hold regardless of `simSpeed` drift from network conditions, and must never
fire mid-test during a synchronous headless test run). Base pace: **10 years per real
minute.** Each run seeds a target lifespan of `15 ± 1.5` real minutes (deterministic per
`?seed=`, so the same seed always targets the same length — a 14–16.5 minute window, not
robotically identical every time). Current vigor and resolve modulate the pace: full vitals
age at exactly the seeded baseline; neglected vitals (starving, broken resolve) accelerate
aging up to 12% faster. **Aging never slows below baseline — nothing extends a run past its
seeded target, including god mode.** Neglect can only cut a run short, never lengthen it.

Warning UX: inside the final 1.5 minutes, a one-time toast and an amber HUD tint; inside
the final 0.4 minutes, a slow heartbeat vignette. The HUD carries a permanent age chip and
a draining lifespan bar so the clock is always visible — a hard timer only creates good
pressure if the player can see it.

### 11.3 Death
Two distinct, mutually exclusive endings:
- **Hall destroyed → "THE THREAD IS CUT."** A violent ending; the existing gold-loss/
  scatter mechanics on player death still apply during the run, though the hall falling
  itself is what actually ends it.
- **Old age → "THE DREAM FADES."** A peaceful ending, no penalty — reaching it is the
  intended way most runs conclude, not a failure state. Distinct flavor text, obeys the
  Veil law (no network jargon).

`GameState.gameOverCause` records which. Both save a scorecard and show the leaderboard.

### 11.4 Legacy Score & the leaderboard
A transparent weighted sum, weights held in `CFG.legacy.weights` (data, tunable live, and
shown broken down in the UI rather than as a black-box number — matching the Lens's
legibility law):

`legacyScore = nights×500 + kills×8 + bossKills×300 + buildings×40 + loomPoints×150
+ gold×0.5 + yearsLived×4 + (oldAgeBonus 1000 if the run ended naturally)`

The board (`;` key, or the death screen's "Leaderboard" button) shows your **current run's**
live score alongside the top 50 historical runs from this browser, ranked by legacy score.
Finished-run scorecards are the one thing allowed to persist to `localStorage` — never live
state, consistent with pillar 3.

**God-mode integrity:** toggling god mode on (currently a dev-only debug hotkey — see §14)
sets a sticky `state.everGod` flag for the rest of that run. Flagged runs are still
recorded, but always sort below every legit run regardless of score — a cheated run can
never look like, or displace, a real top finish. Known accepted gap: this only catches the
keyboard-hotkey path; directly poking `window.__nw.state.god` via devtools, or hand-editing
the `nw.leaderboard` localStorage key, would bypass it. There's no backend to enforce
against on a local, single-player leaderboard, so this is treated the same as
`window.NW.CFG` being globally live-tweakable — an accepted tradeoff, not an oversight.

---

## 12. UI/UX

DOM-overlay UI (not in-canvas), one injected stylesheet, CSS custom properties for theming
and responsive scale (`--scale`, touch/narrow device detection). Top bar: title, HP,
Vigor, Resolve, gold, **age chip + lifespan bar**, day/night clock, combat/territory
readout, echo chips, current domain name + danger rating, mute/leaderboard/new-world
buttons. Bottom action bar: context-sensitive Interact, Attack, Ignite, Build, and panel
toggles (Bag/Craft/Skills/Log), Diablo-style ~44px icon sockets with keybind corner tags.
Panels (Bag, Craft, Skills, Log, Leaderboard) are centered, scrim-backed, viewport-clamped
overlays — keyboard-navigable (Tab/arrows/Enter/Escape). Building placement is a
press-to-aim, release-to-place carousel banner (no popup menu; Tab/wheel/arrows cycle
blueprints), with hold-drag wall painting.

**The Lens** (`O`) is deliberately visually distinct from the rest of the chrome —
clinical dark monospace, zero CSS-variable coupling to the main theme — because it's a
diegetic instrument (raw truth), not game chrome (fiction), and should never be mistaken
for one.

---

## 13. Art, audio & feel

**Visuals**: dual-grid autotile terrain blending with pseudo-3D cliff ledges and contact
shadows; directional drop shadows (top-left light by day, omnidirectional at night); a
pooled particle system (poof/ember/slash/spark/wisp/rift/death/heal/crit — 9 kinds, 500-
particle pool, capped and gracefully degraded under the WebGL fallback); post-processing
(bloom on fire/beacon glow, biome-driven color grading, day/night vignette). An
experimental Kuwahara-filter "oil painting" pass exists as a prototype toggle (`V` key /
`?painterly`) — not on by default, not yet promoted past prototype status.

**UI skin**: "Grimdark Chrome" (U2) — warm near-black iron surfaces, brass box-shadow-ring
plaque frames (not border-image, to keep border-radius working), corner brackets, a
blood-gradient HP bar, serif small-caps display type over a sans body. Entirely CSS
gradients/shadows, zero image assets, consistent with pillar 1.

**Audio**: procedural WebAudio synthesis (`src/engine/audio.ts`), a data-driven SFX recipe
table, and mood-based ambient tracks that crossfade by context — `day | night | combat |
boss | dead`, plus a distinct musical mood per named boss/lord (e.g. Thornwarden's own
theme). No hosted audio files.

---

## 14. Technical architecture

- **Rendering**: PixiJS v8, WebGPU by default with a WebGL fallback (`?gl` forces it).
  Chunk-baked terrain, entity sprites in a sortable container, DOM overlay for UI.
- **Simulation**: fixed 30Hz timestep (`sim(dt)`), decoupled from rendering (render
  interpolates between sim steps for smoothness at any refresh rate). The render loop
  additionally drives real-time-paced systems (ScoreboardSystem, LifespanSystem) off
  `performance.now()`, independent of sim dt.
- **World engine**: Rust compiled to wasm (`nightward-core`) — the writable-world override
  store, materials table, and fire cellular automaton. TypeScript owns all content/balance
  and uploads it as batched, zero-copy typed arrays (never per-tile/per-entity calls across
  the boundary).
- **State**: one plain `GameState` object (`src/game/state.ts`), mutated by generic system
  functions. `window.__nw` exposes it (plus every system instance, a `step(n)` deterministic
  test hook, and the Gauntlet runner) — this stays live in production builds, unlike the
  debug hotkeys, because it's both the documented live-tuning surface and the whole test
  harness's only way to drive the game.
- **Testing**: an in-game regression suite ("the Gauntlet," `src/game/systems/regression.ts`)
  — 70+ behavioral test functions exercising every system from the inside via `window.__nw`,
  run via `?test` or `__nw.regression.run()`. Verified live via a headless-Chrome + raw-CDP
  driver script (no test framework dependency), never trusted from a hand-written claim
  alone — a past project failure mode was implementers reporting fabricated or tautological
  "all green" results, so a from-scratch verification pass is standard practice now.
- **Debug/dev tooling**: hotkeys for god mode, instant resources, time-skips, and a god-brush
  are gated behind `import.meta.env.DEV` (dev-server only, stripped from `npm run build`) as
  of L1 — they used to ship live in production with no gate. `window.NW`/`window.__nw`
  themselves are NOT gated (see above).
- **Deployment**: static Vite build, zero backend, hostable anywhere (GitHub Pages
  configured). `npm run wasm` (builds the Rust core) must precede `typecheck`/`build` on any
  fresh clone — `src/wasm/pkg/` is gitignored.

---

## 15. Known gaps & deferred systems

Honest inventory — don't describe these as live if you're extending the game:
- **Biome hazards and biome-exclusive spawn weighting**: fields exist on `BiomeDef` but no
  system currently reads them.
- **A local agent** (`nightward-agent`, a native binary exposing OS-level metrics no
  browser can see — ICMP ping, WiFi RSSI, ARP table) is a documented stretch goal, never
  built. The game must remain complete and fun without it, permanently.
- **Action-specific gathering animations** (a distinct mining swing / chop / kneel pose per
  skill) don't exist — gathering uses one generic progress-bar interaction regardless of
  skill. Deferred, unscheduled.
- **Spin/channel attack** (a hold-to-charge radial burst) was scoped, then explicitly cut
  from the weighty-combat brief as legitimately ambiguous with the tap-only phase machine.
  Never built.
- **`everGod` leaderboard-legit tracking** only catches the keyboard hotkey path — see
  §11.4's accepted-gap note.
- **Network-driven cellular-automaton mappings beyond fire** (wetness diffusion speed from
  bandwidth, packet-loss "dead zones," a "data storm" weather event) were speculatively
  scoped in early planning but never implemented; only jitter→fire-spread and realm→wind
  actually exist.

---

## 16. Where things live (quick index)

| What | Where |
|---|---|
| Master balance file (every tunable number) | `src/game/data/config.ts` |
| Game state shape | `src/game/state.ts` |
| Content tables (items/recipes/buildings/enemies/echoes/loom/materials/skills/domains/network) | `src/game/data/*.ts` |
| Systems (one file per major mechanic) | `src/game/systems/*.ts` |
| Boot + game loop | `src/main.ts` |
| UI | `src/game/ui/*.ts` |
| Rust/wasm world engine | `rust/nightward-core/` |
| Regression suite ("the Gauntlet") | `src/game/systems/regression.ts` |
| Build log / history | `docs/plans/ROADMAP.md` |
| Dev process | `docs/plans/WORKFLOW.md` |
