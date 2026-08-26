# NIGHTWARD — Game Design Document

**This is the source of truth for what the game IS.** Last updated 2026-08-26 (post-Batch SR
"The Reckoning"). When this document and any other doc disagree, this one wins — file a
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
   minutes by an in-fiction character lifespan that ages in real wall-clock time. This cap
   cannot be extended by skill or bypassed by cheats (see §11) — it can only be *shortened*
   by playing badly. The game is won by what you accomplish inside the window, not by
   surviving longer than it.

   *Batch SR amended how the window ENDS.* Until SR3, the lifespan running out **was** the
   ending: the run stopped rather than finished, and the optimal line was to be alive when
   it did. The window now has a finish line inside it — the last act summons a domain lord,
   and killing it before the years run out is the win (§3.3, §11.3). The clock itself is
   unchanged and still cannot be extended. What changed is that reaching the end of it is no
   longer the best thing that can happen to you.

---

## 3. The core loop

### 3.1 Moment to moment
**The game is played entirely from the keyboard** (SR0). Move with WASD — or touch, on a
phone, which has no keyboard. **Gather** (`E`) wood, stone, ore, and herbs from world
features. **Craft** (`C`) tools, weapons, armor, and consumables at three skill tracks.
**Build** (`B`, a cycling placement carousel — no popup menu) a hall, walls, and towers,
anchored to your hall or chained outward through waystones; the ghost sits at your facing
and the arrow keys nudge it. **Attack** (`Space`) with a weighty windup→active→recovery
swing, not an instant hit. **Ignite** (`F`) flammable ground with the real fire simulation.
Check your **Bag** (`I`), **Skills** (`K`), and event **Log** (`L`); open the **Lens**
(`O`) to see the raw network truth driving everything; check the **Leaderboard** (`;`) to
see how your run stacks up. On a level-up the **draft** (§9.3) stops the game and offers
three cards, taken with `1`/`2`/`3`.

**The mouse has exactly one gameplay job left, and it is to stop the game** — a click opens
the pause menu. Everything else it used to do is a key. Aiming was the reason to keep it,
and aiming was always driven by `aimAngle` (§5.3), which is movement-derived: pointing with
the mouse meant aiming with a second, worse device that disagreed with the one the swing
already used. What SR0 deleted is that disagreement, not a verb.

### 3.2 The day/night rhythm
A day/night cycle is 340 seconds (240s day + 100s night — a bit over five and a half
minutes), so a full ~15-minute run spans roughly **two to three cycles**. Daytime is safe
build-and-gather time, with sparse daytime prey mobs roaming for loot. At dusk, night
hordes spawn and converge on your hall; towers and your own melee are the defense. Hordes
scale with night number, your territory score, and your hoarded gold (greed draws danger) —
by the second or third night of a run this is a real siege, not a formality.

### 3.3 The run: three acts, the Reckoning, and the score
This is the structural layer everything else sits inside — see §11 for full detail. Your
character ages in real time toward a seeded ~15-minute target, and since SR1 the window has
a deliberate shape inside it (`CFG.sr.actCurve`):

| act | roughly | what it is |
|---|---|---|
| **The Gathering** | 0–5 min | fewer and slower foes, no elites — room to gather, build, and reach a real weapon |
| **The Swelling** | 5–12 min | count and spawn rate climb hard; elites and champions arrive |
| **The Reckoning** | 12–15 min | ordinary spawns fall away almost entirely, and a domain lord is summoned |

The current act is named in the HUD. The lord is the finish line: **killing it is the win**,
and the run has four endings rather than two (§11.3). Every ending computes a **Legacy
Score** — nights survived, kills, bosses, buildings, Loom points, gold, years lived, and a
bonus for how it ended — and saves a scorecard to a local leaderboard. Reload for a new seed,
a new connection-driven world, a new attempt at a better run.

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
Live browser network metrics don't just flavor the game — they parameterize it. **Two dozen
tracked metrics** (RTT, throughput, jitter, an internally-computed "echo jitter," connection
effective-type/type, online state, time-of-day, CPU cores, device memory, endpoint
latency, page DNS/TLS/TTFB timing, battery level/charging, locale, timezone, JS heap used)
feed **game-facing mappings**: sim speed, gold rate, enemy scale, day-phase pacing,
realm selection, damage roll, move speed, gather speed, xp rate, every vigor/resolve
decay-and-restore rate, resource yield, and regen rate. Every mapping is a data row
(`src/game/data/network.ts`), transform function included, editable live via
`window.NW.NET.mappings` — never hardcoded logic. Time-feel multipliers (sim speed, move
speed) are deliberately clamped tight (0.85–1.15×) because wide swings there read as lag,
not gameplay; outcome multipliers (damage, most economy/vitals rates) are allowed a much
wider band (roughly 0.3–1.5×) because that reads as *the world responding to you*.

Every metric has a neutral fallback default so unsupported browsers (Firefox, Safari lack
`navigator.connection` entirely) still play a complete, balanced game.

**The Deep Wire (N4.1).** Until 2026-08-19 every one of those numbers was an *inference*.
`connection.rtt` is quantised to 25 ms buckets, `connection.downlink` is capped at 10 Mbps
and absent outside Chromium, and packet loss was believed unreadable from a browser at all.
It is not: a Cloudflare edge that terminates our TCP connection returns its own kernel
socket statistics in a `Server-Timing: cfL4` header — `min_rtt`, `rtt_var`, `lost`,
`retrans`, `delivery_rate`, `cwnd`, in microseconds, for our own socket. Measured live, the
browser's own estimate was off by roughly 40× (reported 100 ms / 1.6 Mbps against a real
2.5 ms / 13.9 Mbps). The deep readings drive **Pulse** (sim speed), **Flow** (gold rate,
gather speed), **Fray** (horde aggression), **Silt** (movement drag) and **Aperture**
(carrying capacity), and each falls back to the browser estimate when the edge is
unreachable — a filtered network plays a balanced game, never an accidentally easy one.

**Scrying (N4.4): how far you can see is how fast you resolve.** Every beacon the game
discovers is resolved through DoH rather than fetched, and each of those resolutions is timed.
The **median** — not the mean, so one slow answer cannot permanently dim the world — sets the
radius of the corner radar: a sharp resolver folds more map into the same disc, a crawling one
narrows it, across a 0.75×–1.5× band. It is the only mapping in the game whose effect is
*spatial*, which is why the radar is the honest target for it: a measurement about how far the
network reaches should change how far the player can see. The reading is passive — no new
request, no new host — and holds its neutral value until three resolutions have landed, because
one cold-cache lookup measures a cache miss and not a network. The same answers reveal whether
the connection carries **IPv6**, without the host being contacted at all.

**Omens (N4.3): the level and the step are different things.** The mappings above describe
your connection's *steady state* — a permanently lossy link plays a permanently harder
game. An **Omen** is the moment it *changes*. A session-long time series (the Chronicle)
compares a short window against a longer baseline that excludes it, in standard deviations
rather than percent, so a link that always wobbles does not cry wolf and a steady one
reports a small step. A step that clears its threshold raises a named, temporary world
state with a real multiplier, a toast, a HUD chip and a countdown:

| the wire | Omen | the world |
|---|---|---|
| packet loss steps up | **Surge** | the horde presses (×1.25) and the screen frays |
| throughput collapses | **Famine** | the land gives less (×0.65), tribute included |
| throughput surges | **Bounty** | the land gives freely (×1.30) |
| latency shortens | **Quickening** | the world quickens (move ×1.10) |
| buffers fill | **Miring** | the ground thickens (move ×0.88) |
| latency lengthens hard | **Rift** | the realm tears (see 4.4) |

Omens deliberately go **both ways**: a mapping that can only punish teaches a player to
resent their own connection. And a bad omen **lifts when the reading recovers**, measured
against the baseline it fell from — the player's route out of a Famine is their network
coming back, and they can watch it happen in the Lens. The duration cap is a safety valve
for a permanently degraded link, not the primary exit.

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
assignment. A hard latency step-change also tears one (see 4.2) — until N4.3 the rift's
only trigger was a `connection.type` transition, which desktop browsers never report, so on
desktop the whole mechanic was unreachable. A rift is never *claimed* unless the realm
actually changed; the panel does not lie about its own events. Identity data (IP, ISP, city, ASN) is never probed automatically — it fires
only after the player's first `explore` action ("scrying reveals who you are"), and the
Lens UI accurately reflects "unrevealed" until then.

The **Lens** (`O` key) is the truth panel. It is a **right-edge drawer**, not a modal: the
game keeps rendering and stays playable beside it, because the whole premise is that these
numbers are driving the world in front of you and you could not watch the world react while
the panel sat on top of it. Five tabs — PULSE, PATHS, IDENTITY, VESSEL, THREADS — over a
persistent Chronicle strip of session-long sparklines, plus an **inspect mode**: hover or
tap any row for its SOURCE (which browser API), ACTION (what triggers it), and FLOWS INTO
(what game values it feeds). THREADS leads with active Omens, then the full game-mapping
decoder ring, then detected changes, then the Feed.

Every reading carries an **honesty tag** — `measured`, `reported`, `derived` or
`unavailable` — because the difference between a kernel's `min_rtt` and a browser's
25 ms-bucketed guess is the difference between this panel being an instrument and being
decoration. An `unavailable` row still renders and says *why*: a missing row teaches
nothing, and "unavailable" with no reason is indistinguishable from a bug. The whole series
store exports to JSON, provenance included. This is deliberately "teach the player real
network monitoring while they play," not just flavor.

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

**Rarity & rolled affixes (A1).** Those 67 rows are *bases*, not items. Any piece of gear
that drops or is forged rolls on a six-rung ladder — **Plain · Touched · Woven · Hallowed ·
Sovereign · Riftborn** — and everything above Plain carries 1–5 rolled affixes, so two Iron
Blades are genuinely different blades. Affixes are a prefix and a suffix in Diablo grammar
(*"Keen Iron Blade of the Ember"*): prefixes write to the stat columns an item already has
plus six named multipliers (move speed, swing speed, hunger, dread, building health, soul
xp), and suffixes are the fifteen item-effect hooks from §9.4.

A **Plain** roll returns the authored item unchanged — the ladder stays invisible until
something actually rolls, and ordinary materials never roll at all, so the bag still stacks.

Two rules here are ours rather than the genre's:

- **The ladder is climbable inside one run.** Pillar 8 caps a run at ~15 minutes, and
  Diablo-style drop rates in that window would ship four tiers no player ever sees. Weights
  are tuned to a measured target: a competent run ends holding **2–4 Woven and about one
  Hallowed**, and a slain lord is a **~24% shot at a Sovereign**. There is no persistence
  (pillar 3) — what survives the run is a **trophy line on the scorecard** naming your best
  find, which is the carve-out pillar 3 already allows.
- **Riftborn always costs something.** One of its five affixes is a curse. A tier that is
  strictly better than the one beneath it is a number, not a decision.

Where a drop can reach on the ladder is decided by its source: ordinary kills and gathering
top out at Hallowed, a **domain lord** is the only ordinary route to a Sovereign, a **forge**
tops out at Touched (crafting has to stay worth doing), and **Riftborn exists only in the 60
seconds after a rift** — which is what finally makes a rift something to chase. The wire
tilts the whole ladder through the **Fortune** mapping: a wide, clean path (high cwnd, low
loss) makes the top rungs reachable, a frayed one drops *more* items of *worse* quality.

**Cairns and the Hoarder (A8).** Two sources sit above the ordinary band, and both cost
something other than time. A **Cairn** is a stack of pale stones you meet roughly once a
run: opening one is a five-second dig that yields a guaranteed **Hallowed-or-better** piece
— and *wakes what was buried under it*, a pack scaled to the current night, which will march
on your hall if you walk away from it. The **Hoarder** is the other: a rare daytime runner
that flees on sight, outpaces you by a hair, and is gone for good past twenty-one tiles. Kill
it and it bursts a **Woven-or-better** hoard; lose it and you watch your Sovereign leave.
Neither can drop nothing — both tables use a pick-one group, because a guarantee that fires
four times in five is not a guarantee.

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

**The Hall is a hub (A6).** Two `unique` counters are raised beside it, and they are the only
buildings in the game that take **gold** rather than materials — which is also the only thing
gold is for beyond a death penalty and one horde-thinning button. Walk up to either and the
interact key opens it instead of gathering.

- **The Reliquary** sells **sealed relics**: you choose the shape (blade, armour, ring,
  amulet, charm, tool) and the **seal**, and the seal decides both the rarity band and how far
  down that shape's base ladder it will reach — a Lord's Seal at 1,400 gold cannot hand you
  the blade you started the run with. What is inside is never bought. The roll is the same one
  a corpse makes, reading the same **Fortune** off the wire (§4.2), and **no seal reaches
  Riftborn**: gold buys odds, the rift still has to be walked into.
- **The Forge-Warden** reworks **one line** on one carried piece for gold plus materials, and
  the new line can be worse than the old one. Each rework of the same piece costs 1.8× the
  last, which is what keeps it a repair for a near-miss rather than a machine you feed until
  every line is perfect. A Riftborn's curse rerolls into *another curse* — you may change
  which price you pay, never that you pay one.

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
A per-run passive tree of **15 nodes** across three branches — **War** (4: melee damage,
swing speed, arc width, crit floor), **Field** (7: gather speed, double-yield chance,
cheaper crafting, move speed), **Ward** (4: building HP, armor, tower damage/range,
territory income). Four of the fifteen are keystones, two of them in Field, each a real
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

**The draft (SR2).** Points are not spent from a panel. At the grant moment the game stops
and offers `CFG.sr.draftCards` (3) still-eligible nodes, weighted toward depth; you take one
with `1`/`2`/`3` or a click, or pay `CFG.sr.draftRerollGold` (40 gold) for a fresh offer.
A Long Thread grant worth several points calls again rather than leaving them sitting
unspent. The tree is the same 40 nodes it always was — what changed is that you are handed a
decision under pressure instead of a menu to browse.

### 9.4 The Armory (relics & item effects)
Items can declare data-driven `effects` hooks (thorns_reflect, fire_aura, chill_aura,
regen_boost, move_burst_on_kill, see_foe_hp, resonance_boost, fire_on_hit, chill_on_hit,
lifesteal, chain_on_kill, dodge, gold_find, xp_boost, night_vision — fifteen in total).
Until A1 these were reachable almost exclusively through the five relics below; they are now
also the **suffix pool for rolled affixes** (§7), which is what made that milestone mostly a
data edit.

> **Corrected 2026-08-21.** That paragraph was true of the *vocabulary* and false of the
> *game*. Seven of the fifteen hooks — thorns_reflect, fire_aura, chill_aura, regen_boost,
> move_burst_on_kill, see_foe_hp, resonance_boost — had a registered handler and **no
> consumer anywhere**, because `registerEffect()` builds a registry that nothing dispatches
> from: every live hook is read as `activeEffects(state).has(key)` at the site that cares.
> The bill was that **all five relics below did nothing at all**, and 350 of the 750 suffix
> weight in the affix table was placebo. All seven now have a real consumer and a
> matched-pair test. The registry is documented as a vocabulary, not a dispatch table.

Five of them are **unique boss relics** — a
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

**The Hoarder (A8)** is the exception among them, and the only enemy in the bestiary you can
lose to without taking a point of damage. It never attacks; it runs. At 108 × 1.5 = 162 px/s
against your 160 it pulls away by about half a tile every eight seconds, so a straight sprint
loses — narrowly. The counterplay is everything that is not running faster: a chill or a
tower slow drops it under you, an echo or a bow reaches it without closing, and it has no
pathfinding, so trees, water and cliffs corner it. Past 21 tiles it is gone, and the Chronicle
says so.

### 10.2b Wardstones — the world's other verb
Standing violet monoliths, a handful per run, marked with something still lit. Touching one
grants a **Boon**: a named, timed blessing drawn by weight from a table of twelve. What makes
this cheap rather than a whole new system is that a boon is *a timed entry into the item-effect
vocabulary* — the same fifteen hooks §9.4 lists. An Ember Ward is `fire_aura` for 75 seconds,
read at the same site the Cindermaw relic is read at, so nothing downstream knows or needs to
know where the fire came from. Three can be live at once; touching a fourth displaces the
oldest and names it. A Wardstone drops no loot, because a blessing that also pays in silver
reads as a node with a bonus rather than as a blessing.

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

### 11.3 Death — and, since SR3, victory
Four terminal outcomes, recorded on `GameState.outcome`:

| outcome | when | screen |
|---|---|---|
| **Reckoned** | you killed the summoned lord | "THE RECKONING IS YOURS" |
| **Outlasted** | the years ran out with the lord still standing | "THE CLOCK RUNS OUT" |
| **Fallen** | the lord struck you down (or your hall fell mid-fight) | "THE LORD'S RECKONING" |
| **Unmet** | the run ended before a lord was ever summoned | "THE THREAD IS CUT" / "THE DREAM FADES" |

**Unmet** is the pre-SR3 pair, unchanged and still reachable — a hall destroyed is a violent
ending (the gold-loss/scatter mechanics on player death still apply during the run, though
the hall falling is what actually ends it); old age is a peaceful one, no penalty. Distinct
flavor text for each, both obeying the Veil law (no network jargon).

`GameState.gameOverCause` still records what *killed* you, and still means exactly what it
meant before SR3 — which is why it is `null` on a Reckoned run. **Nothing kills you when you
win.** Anything asking "how did this run end" must read `outcome`; `gameOverCause` answers
the narrower question it was written for. (§11.4 records what happens when that distinction
is missed.)

All four save a scorecard and show the leaderboard.

### 11.4 Legacy Score & the leaderboard
A transparent weighted sum, weights held in `CFG.legacy.weights` (data, tunable live, and
shown broken down in the UI rather than as a black-box number — matching the Lens's
legibility law):

`legacyScore = nights×500 + kills×8 + bossKills×300 + buildings×40 + loomPoints×150
+ gold×0.5 + yearsLived×4 + endingBonus`

...all multiplied by the covenant weighting (§11.5). `endingBonus` is **2500 for a Reckoned
run** (you killed the lord) and **1000 when the years ran out** (Outlasted, or an Unmet
old-age ending). A Fallen run gets neither.

**The ending bonus is keyed to `outcome`, not to `causeOfDeath`** — and that is worth
stating in the design doc because getting it wrong shipped. Reading the win off
`causeOfDeath` paid the 1000 to the player who let the clock run out on the lord and nothing
to the player who killed it, which made winning worth ~700 points *less* than losing, in the
board's headline category. No cause-of-death field can ever describe a victory; see §11.3.

**Categories.** The board (`;` key, or the death screen's "Leaderboard" button) shows your
**current run's** live score alongside the top 50 historical runs from this browser, under
four axes:

| axis | ranks by | over |
|---|---|---|
| **Legacy** | legacy score, descending | every run |
| **Fastest Reckoning** | `reckoningSec`, ascending | won runs only |
| **Lowest Gear, Won** | `gearScore`, ascending | won runs only |
| **Adjusted Legacy** | `legacyScore / assistance` | every run |

**The assistance index (SR10).** The Wire (§4.2) makes every run's numbers
connection-dependent, which means a raw board partly ranks your ISP. `computeAssistIndex()`
takes a weighted geometric mean, in log space, of the score-affecting mapping outputs against
their declared pillar-5 neutral values, and **Adjusted Legacy** divides by it. It is
recomputed at rank time from the stored `wire` block rather than trusting the number written
into the record, so revising the formula re-ranks the whole back catalogue instead of
stranding it; the formula version is stamped on every record (`ASSIST_FORMULA`). It is an
honest correction, not a complete one — see §15.

**The run record.** Scorecards are `v: 3` and carry the seed, the engine version, the outcome
and its Reckoning axes (gear score, seconds elapsed, biggest single hit, best 10-second
burst, damage dealt to the lord), the covenant, the best item the run found, and a
privacy-allowlisted `wire` block of run conditions — enforced by a test, not a comment.
Finished-run scorecards are the one thing allowed to persist to `localStorage` — never live
state, consistent with pillar 3. Under storage pressure the `wire` block is stripped from the
oldest half of the board before any whole record is dropped.

**God-mode integrity:** toggling god mode on (currently a dev-only debug hotkey — see §14)
sets a sticky `state.everGod` flag for the rest of that run. Flagged runs are still
recorded, but always sort below every legit run regardless of score — a cheated run can
never look like, or displace, a real top finish. Known accepted gap: this only catches the
keyboard-hotkey path; directly poking `window.__nw.state.god` via devtools, or hand-editing
the `nw.leaderboard` localStorage key, would bypass it. There's no backend to enforce
against on a local, single-player leaderboard, so this is treated the same as
`window.NW.CFG` being globally live-tweakable — an accepted tradeoff, not an oversight.

### 11.5 Covenants — one selector, two vocabularies
*(N4.5 + A7.)* Five tiers — **quiet, listening, deep, drowning, abyssal** — sworn at the
Sounding Stone. The Veil calls a tier a covenant you swear; the Lens calls it a data budget
you consent to, stated in megabytes, in the panel, before you pick. They are the same row of
the same table, deliberately: a second, independent difficulty axis is exactly what ships
when two plans get written by the same person on different days, and it leaves both of them
unbalanceable.

`quiet` is the default and is byte-for-byte the game that shipped — every multiplier exactly
1.0, budget 0, and the Sounding Stone refuses to fire. A player who never opens the panel
spends nothing and plays at the difficulty they started at. Raising a covenant raises the
horde, raises the rarity **floor**, gates Riftborn to the top two tiers, and multiplies Legacy
Score.

Two rules keep it honest. **Tiers are raise-only within a run**, and the score weighting is by
nights spent at each covenant, so swearing `abyssal` in the last thirty seconds does not
retroactively pay for a quiet run. And **the budget is a hard ceiling for the whole run, not a
rate**: spend it and the stone goes quiet until the run ends, because a budget you can exceed
by playing longer is not a budget.

A throughput sounding spends *the player's* data — possibly metered, possibly roaming. That
is why it is the one thing in this project that cannot be a default.

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

**Orbs, tooltips and the radar (A4).** Two globes flank the action bar — **HP** bottom-left
with **Vigor** as a ring around it (a rate, not a pool), **Resolve** bottom-right — as pure
radial gradients and a clipped fill. They *add to* the top-bar numbers rather than replacing
them: a number answers "how much", an orb answers "how bad is this" without moving your eye
off the middle of the screen, which is where a night fight happens.

Hovering or focusing any item shows a **comparison tooltip**: the name in its rarity colour,
each rolled affix in plain language ("*of the Ember — burns what stands near you*"), and a
green or red delta against whatever occupies that slot right now. This is the loot loop —
before A4 the game had no tooltips of any kind, and a rolled item would have been a
differently-coloured name with no way to interrogate it. Ground drops at Woven and above
throw a rarity-coloured **light beam** with the item's name floating above it, and a
corner **minimap** shows the Hall (with a rim arrow when it is off the edge), your
territory, live drops in their tier colours, and everything hunting you. Its *radius* is not
fixed — **Scrying** (4.2) widens or narrows it with your DNS resolution speed, which is the one
place in the HUD where the Wire changes what you can physically see.

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
- **Per-pixel lighting.** SR5 was spec'd as a height buffer in `Pix`, Sobel normals baked
  with each sprite, and a light buffer the world is lit through. What shipped is a
  screen-space light **mask** (`PostProcess.lightMask`) rendered from the glow layer — it
  decides where darkness is, and it is what SR8's fog and grading are built on, but no
  surface responds to a light's *direction*. Batch SR's own §4 measurement ("nothing is lit
  — no per-pixel response to any light source") therefore still stands. SR8's light shafts
  and ground specular are blocked behind it. See `docs/plans/S-speedrun.md` §7.1 for the
  ruling and what has to be measured before it is picked back up.
- **The fifth leaderboard axis.** A covenant-weighted (`pact`) category was scoped alongside
  the four in §11.4 and never shipped.
- **Run verification.** Batch SR §2 argued for storing seed + an input log + a checksum, so a
  record could be re-simulated and checked. Only the **seed** shipped, deliberately and with
  its reasoning recorded in `scoreboard.ts` — a real input-replay hash needs one capture
  point for every input surface, and a movement-only hash would have lied about what it
  proved. The consequence is honest but real: a `v: 3` record proves the world it was played
  in, not the play. Every record accumulating now is unverifiable after the fact.
- **The assistance index is a correction, not a solution.** §11.4's index divides out the
  average *magnitude* of the Wire's help. It cannot correct `simSpeed`, which changes how
  many actions fit inside a fixed wall clock rather than scaling any single number — a
  scalar divide has nothing to divide. And the two ideas above are mutually exclusive at the
  limit: re-simulating a run from seed + inputs cannot reproduce the live network conditions
  that drove its damage rolls and spawn pacing. A board that is comparable across
  *connections* rather than across *runs on one connection* needs a design decision, not a
  better formula.
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
| Content tables (items/rarity/affixes/recipes/buildings/enemies/echoes/loom/materials/skills/domains/network) | `src/game/data/*.ts` |
| Systems (one file per major mechanic) | `src/game/systems/*.ts` |
| Boot + game loop | `src/main.ts` |
| UI | `src/game/ui/*.ts` |
| Rust/wasm world engine | `rust/nightward-core/` |
| Regression suite ("the Gauntlet") | `src/game/systems/regression.ts` |
| Build log / history | `docs/plans/ROADMAP.md` |
| Dev process | `docs/plans/WORKFLOW.md` |
