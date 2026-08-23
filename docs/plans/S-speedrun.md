# Batch SR — The Reckoning

*A fifteen-minute speedrun ARPG that ends in a boss, and a look that stops apologising.*

**Status:** in progress, updated 2026-08-23. Written 2026-08-22, the day `dev/night-build` merged
nineteen milestones to `main` and both previous live plans were retired. All eleven phases have
now landed at least a first cut — see the status column on the [phasing table](#7-phasing) for
what each one actually shipped versus what it deliberately scoped down or dropped.

Phases are prefixed `SR` because `S1`, `D4`, `R0–R5`, `B*`, `G*`, `N*`, `A*`, `C*`, `L1`, `U*`
and `W*` are all taken by shipped work and a collision in a config comment is a bug waiting for
someone to trust the wrong letter.

---

## 0. The ask

Verbatim, because the whole plan hangs off it:

> turn it into a like speed run arpg with d4/poe/terraria/herosiege/vampire survivors mechanics.
> more or less 15 min of gameplay to progress through, then final boss fight for leaderboard
> stats (damage vs time vs item level of character vs other options and more and more yada yada)
>
> also need to up the ante with the graphics, atleast its gotta be similar level to vampire
> survivors or hero siege, preferably a bit more […] i dont want it to feel like a 1990's pixel
> game lol, it should feel like 2025 pixel game at the minimum, preferably some elements to push
> look and feel up to diablo 1,2,3,4 vibes.

Two halves, and they are genuinely independent — **the run** and **the look**. Either can ship
without the other. They are in one document because they are one intention: the game should be
worth speedrunning *and* worth looking at while you do.

---

## 0.1 Decisions — 2026-08-22

Six questions were put and six came back before a line was written. Recorded in full, because a
verdict of "as proposed" is a decision too and deserves the same record as a reversal.

| # | question | verdict | what it costs |
|---|---|---|---|
| **Q4** | how far up the graphics ladder? | **the whole ladder, SR4 → SR8.** Shader floor, real light, palette, feel, and the Diablo pass | roughly doubles the graphics track. It is now the larger half of the batch |
| **Q2** | how hard is the finale? | **a wall you train against.** Most runs will not beat it | reshapes SR3 — see below. A boss most runs lose to changes what the scorecard has to reward |
| **Q3** | does the Gathering survive? | **keep it at ~5 minutes.** It is the identity of the game | nothing — SR1 as written, shipped instrumented |
| **Q5** | auto-attack? | **no. Keyboard-only, and movement stays the aim.** Mouse click defaults to pause/menu. Weapons are the core damage; elements are enchanted onto them; some auto from abilities is fine | a new phase, **SR0**, and it goes first |
| **Q6** | how does building work without a mouse? | **ghost at your facing, hold and walk to paint** | part of SR0 |
| **Q1** | the leaderboard's shape | **local board**, built so a global one can be added later | SR9, plus one cheap piece of insurance — see §2 |

**Q5 is the answer that moved the most**, and most of it is already built. The user's words were
*"i like that your movement affects how you do damage with current default attack"* — and going
keyboard-only does not weaken that, it **sharpens** it. `combat.ts` already reads
`player.aimAngle ?? FACING_ANGLE[player.facing]`, so deleting the mouse aim makes movement the
*only* aiming verb in the game. That is a stronger version of the property that was asked to be
kept, and it is a deletion rather than a feature.

Likewise the elemental half. Echoes are **already** auto-firing abilities in a lord's element
(C1, with an A3 active on top), and X1 already shipped four elemental weapons —
`sword_fire`, `sword_frost`, `sword_void`, `sword_storm`, each carrying an `effects` row. What is
missing is not the concept but the **generality**: today only four fixed swords have an element.
SR2 makes it an affix any weapon can roll.

---

## 1. Honest audit — three of the four games are already in here

This project has a habit of writing plans for things it already owns. So, first, what actually
exists on `main` as of the merge:

| borrowed from | what we already have | shipped in |
|---|---|---|
| **Terraria** | gather → craft → build → defend, biomes, day/night, a writable world with a Rust core, buildings with HP and territory | Batches 4/5, R0–R2, W6 |
| **Hero Siege** | rarity ladder, rolled affixes, elites and champions with a conflict table and a power budget, sockets and weaves, an ability bar, a gold hub with two counters, Cairns and the Hoarder | Batch A, all eight phases |
| **D2 / PoE** | six-rung rarity ladder to Riftborn, prefix/suffix affix rolls, socketed threads and completed weaves, a **per-run passive tree** (the Loom — 15 nodes, 47 ranks, four keystones at depth 4), a currency hub that rerolls a line | A1, A5, A6, C3/B3.b |
| **Vampire Survivors** | `CFG.horde.maxAlive` is already **250**. And essentially nothing else | — |

And the run itself:

- **The fifteen-minute cap already exists and is a pillar.** `LifespanSystem` ages the character
  on *real wall-clock time* so network jank cannot stretch it, and pillar 8 says in as many
  words that the game "is won by what you accomplish inside the window".
- **The scorecard already exists.** `RunScorecard` v2 carries nineteen fields including
  `bossesSlain`, `elitesFelled`, `pact`, `trophy` and a composite `legacyScore` whose weights
  live in `CFG.legacy.weights`.
- **World bosses already exist.** `WorldBossSystem` runs domain lords that stalk the overworld,
  converge on your hall when your territory gets loud, and re-form deeper and stronger when
  slain — the file's own comment says "Diablo-GR style".

So the honest gap list is much shorter than the ask makes it sound. **Two things are missing.**

### Gap 1 — the run does not *end*, it *stops*

At the target age the run terminates in "death of natural causes". That is a deliberate,
well-built anticlimax, and it was correct for the game this was: a network-survival sim where
the point was the world, not the fight. It is wrong for a speedrun ARPG. A speedrun needs a
**finish line you cross**, not a timer you run out.

Everything needed to build one is standing. `WorldBossSystem` knows how to make a lord walk at
your hall. `LifespanSystem` knows what time it is. Nothing knows how to make those two facts
into a finale.

### Gap 2 — there is no Vampire Survivors half at all

Not the swarm — `maxAlive: 250` is already generous. What is missing is the **pressure curve**
and the **power curve** that make a swarm a game instead of a crowd:

- No level-up draft. The Loom is a panel you open when you remember to. VS's entire feel is
  that power arrives *at you*, mid-fight, as a decision you make in three seconds.
- No weapon evolution. A5's weaves are the closest thing and they are a crafting verb, not a
  reward.
- No escalation shape. Night 3 is night 1 with bigger numbers.

---

## 2. The collision — what the pivot costs

Three pillars get touched. Two survive intact; the third was ruled on before a line was written.

**Pillar 8 (the Lifespan) survives, reworded.** The run stays ~15 real minutes and stays
un-extendable. What changes is what the clock *does* at the end: instead of ending the run, it
**summons the thing that ends the run**. That is a stronger reading of the same pillar — "won by
what you accomplish inside the window" is more true when the window closes on a fight.

**Pillar 1 (100% procgen) survives, and is not the problem.** See §4. A normal map generated
from a seed is exactly as procedural as the sprite it belongs to.

**Pillar 3 (no persistence except finished-run outcomes) — ruled, Q1.** A leaderboard is, by
definition, *many* finished-run outcomes kept across sessions.

**Verdict: a local board in `localStorage` — your own last ~50 runs, sorted by category.** That
is the existing pillar-3 carve-out in the plural, and it persists nothing a finished scorecard
did not already persist. A hosted global board is explicitly a *later* thing, not a never thing.

### The one piece of insurance that has to be taken now

The question asked alongside the verdict was *"we can then easily setup the global rankings later
right?"* — and the honest answer is **yes, provided one thing is done now, because it is nearly
free today and expensive to retrofit.**

Shipping stored records to a server later is a POST. `RunScorecard` is already versioned (`v: 2`)
and already migrates. Transport is not the problem.

**Verification is the problem, and waiting does not make it smaller.** A global board must tell a
real run from a fabricated one, and this game deliberately hands every player `window.NW.CFG` to
retune balance from the console at runtime. The scorecard's existing `legit` flag catches god
mode and nothing else. A board built on trust gets gamed on day one.

**Pillar 4 is the way out, and it is why this is cheap.** The world is deterministic from seed —
"the same `?seed=` always generates the same world" — so a run is fully described by its seed
plus its input stream. If every local record carries **seed + input log + a checksum** from the
first version, a server can later re-simulate the run and confirm the score without trusting the
client at all. Nothing has to check it now. It just has to be *recorded* now, because adding it
to a record format that has already shipped means either a migration or a permanently
unverifiable back-catalogue.

Cost today: a bounded input ring buffer and four more fields on the record. Cost later: the
difference between a leaderboard and a suggestion.

---

## 3. The run — SR0, SR1, SR2, SR3

*Design here; file paths, signatures and data shapes in [§11](#11-implementation-detail).*

### SR0 — Keyboard only *(Q5, Q6 — and it goes first)*

Small, cheap, and it changes the control model every phase after it is built on. It is also
mostly **deletion**, which is the best kind of phase.

**Attack aiming: nothing to do — it was never a mouse.** Reading the seams for §11 overturned
this half of the phase. `player.aimAngle` is set at
[player.ts:56](../../src/game/world/player.ts#L56) as `Math.atan2(ay, ax)` **from the movement
axis**, and `Space` has been the attack key all along
([ui.ts:478](../../src/game/ui/ui.ts#L478)). The mouse never aimed anything; the pointer handler
at [main.ts:555](../../src/main.ts#L555) is a *redundant second way* to call `combat.attack()`.

So "movement is the aim" is not a change this phase makes — **it is a property the game already
has, and this phase's job is to stop anything competing with it.** `aimAngle` is load-bearing
and is not going anywhere; it gains a test instead. That is a better outcome than the one this
section originally proposed, and it is written down rather than quietly enjoyed.

It does still buy the leaderboard something real: a keyboard-only run has a small, discrete,
exactly replayable input stream, which is what §2's verification insurance needs. SR0 and SR9
turn out to be the same decision seen twice.

**Building: ghost at your facing, hold and walk to paint (Q6).** The blueprint sits on the tile
you face. `Enter` places. **Hold `Enter` and walk** to lay a wall line, which is faster than
dragging a pointer ever was and reads instantly in a replay. Nudge keys offset the ghost for the
cases you cannot stand next to. `BuildSystem.hover(sx, sy)` and `place(sx, sy)` currently take
*screen* coordinates and call `cam.toWorld()`; they gain a tile-space entry point and the
pointer handlers in `main.ts` stop being the only way in.

**Mouse click becomes pause / main menu.** Not disabled — repurposed. A player who clicks gets a
menu, not a swing and not nothing.

**Everything else the pointer touches** — the Lens drawer, panels, the ability bar — keeps
working with a mouse, because those are UI and this decision is about *the game*. Touch controls
(the existing virtual stick in `input.ts`) are unaffected.

**Why first:** SR1's acts, SR2's draft and SR3's boss all assume a control model. Building them
against the mouse and then removing it is doing the work twice.

### SR1 — The Three Acts

The fifteen minutes stop being flat. One curve, three named acts, driven off the clock that
already exists.

| act | window | what it is | what drives it |
|---|---|---|---|
| **The Gathering** | 0–5 min | the Terraria half. Gather, craft, raise the hall, survive the first night. Density low, elites off | today's game, unchanged |
| **The Swelling** | 5–12 min | the Vampire Survivors half. Density climbs toward `maxAlive`, elites from minute 6, champions from minute 9, drafts arrive fast | `CFG.sr.actCurve` — a data table |
| **The Reckoning** | 12–15 min | the boss. The overworld empties. One thing walks at you | SR3 |

Everything here is a **data table plus a clock read**. `HordeSystem` already scales on night
index; it gains an act multiplier from the same shape. The acts are named in the HUD because a
player who cannot feel the curve cannot plan against it, and planning against it is the entire
skill of a speedrun.

**The one real risk:** the Gathering is five minutes of a *different game* than the other ten.
That is either the best thing about the run (a build-up phase gives the finale stakes) or a
five-minute tutorial the speedrunner learns to rush. §7 says measure it before defending it.

### SR2 — The Quickening (the Vampire Survivors half)

Four mechanics, ranked by feel-per-unit-of-work.

**1. The draft.** On level-up, the game **stops** and offers three cards. This is the single
highest-return change in the entire plan and it is nearly free: **the Loom's 15 nodes are
already data rows with a working modifier map.** The draft does not need new powers — it needs
to stop being a panel. Three nodes offered, one taken, weighted by depth and what you already
hold. A reroll costs gold (the A6 hub already prices things).

**2. Weapon evolution.** A5 already has sockets, threads and completed weaves. Evolution is the
same table read backwards: a blade at or above a rarity floor, carrying a completed weave,
becomes a **named** weapon with a new active. Data rows, one new field on the weave table, and
it gives the rarity ladder somewhere to point.

**3. Pickup radius.** Drops already exist and already despawn. A growing vacuum radius is a
`gearMod` key plus a Loom node — and it is the thing that makes a swarm feel like income
instead of chores.

**4. Elements become an affix, not four fixed swords.** X1 shipped `sword_fire`, `sword_frost`,
`sword_void` and `sword_storm`, each hard-coding an `effects` row. That is the concept without
the generality: exactly four weapons in the game can carry an element, and none of them can roll
one you wanted. Q5 asked for elements *enchanted onto* weapons, so A1's affix table gains an
**elemental damage** family — fire, cold, lightning, chaos, physical — with tiered rolls, which
is the PoE shape and is a data edit on a system that already rolls prefixes and suffixes. The
four X1 swords stay as authored bases that start with theirs.

This also gives A5's weaves and A6's Forge-Warden somewhere better to point: a thread that
converts an element, a reroll that is chasing a specific one.

**5. Auto-attack — declined (Q5), and it was the right call for a reason nobody guessed.** Not
because the swing is precious, but because **movement is the aim**. Auto-attack in a game where
facing decides what you hit does not free your hands — it takes the decision away and leaves the
movement, which is the wrong half. Weapons stay the core damage. Echoes keep their C1 autofire
(they already have it) and their A3 active, so "some auto stuff from abilities" is already true
and shipped. No new switches.

### SR3 — The Reckoning (the finale and the score)

**The summons.** At `CFG.sr.reckoningAtSec` (≈ minute 12) the Lifespan stops being a countdown
to nothing. The horde thins, the sky changes, and one lord — the deepest one you have provoked —
walks at your hall from the edge of the map. This uses `WorldBossSystem`'s existing converge
behaviour with a new trigger. The run now has an **antagonist** rather than an expiry date.

**It is a wall you train against (Q2).** Not scaled to meet you. Its difficulty is a function of
the **pact** you swore and the **act curve**, not of how well you personally geared up — so
outgearing it genuinely helps, and a first run will lose. Most runs will lose.

That verdict costs something and the cost has to be paid deliberately: **if most runs end in a
loss, the scorecard cannot only reward winning.** A board whose only category is "did you kill
it" is a board with three entries on it. So the axes below are not decoration — they are what
makes a lost run still a *run*, with a damage number to beat and a time-to-death to push. The
four outcomes exist for the same reason.

This is also where the covenants earn their second life. A wall at the Quiet Pact and a wall at
the Abyssal Pact are different walls, and the pact is already a raise-only five-tier selector
that the player chose in advance. Difficulty classes, for free, from a system built for a data
budget.

**Four outcomes, all scored, none of them "you lose":**

| outcome | when |
|---|---|
| **Reckoned** | you killed it inside the window |
| **Outlasted** | the clock ran out mid-fight — scored on damage dealt |
| **Fallen** | it killed you |
| **Unmet** | you died or the hall fell before minute 12 — today's game over, still scored |

**The scorecard becomes a certificate with axes, not one number.** This is the direct answer to
*"damage vs time vs item level of character vs other options"*. `legacyScore` stays as one axis;
it does not stay as *the* axis.

| axis | what it measures | the category it creates |
|---|---|---|
| **Time** | seconds from the summons to the kill | fastest Reckoning |
| **Damage** | biggest single hit, and best 10-second window | highest burst |
| **Gear Score** | a derived item level over every worn piece — rarity rung × affix count × affix tiers | best-geared victory |
| **Purity** | *inverse* gear score on a win — the lowest-geared kill | the category speedrunners actually love |
| **Pact** | the covenant held, weighted by nights (N4.5/A7, already built) | difficulty class |
| **Legacy** | today's composite | the all-rounder |
| **Adjusted** | Legacy divided by the run's **assistance index** — how much the wire helped | the only axis that compares two different networks (SR9/SR10) |

The pact axis is the quiet win here: **the covenant system is already a difficulty selector with
five tiers and a raise-only rule, which is exactly the shape a speedrun leaderboard wants.** It
was built for a data budget and it turns out to be a category system.

### SR9 + SR10 — The board, and what the wire did to it

> **The problem this fixes, stated plainly: the leaderboard currently ranks your ISP.**
>
> `NET_GAME_MAP` has roughly thirty-two live targets, and a large share of them move the score
> directly — `simSpeed` (how fast the world runs), `goldRate`, `xpRate`, `fortune` (drop
> rarity), `enemyScale`, `damage`, `moveSpeed`, `gatherSpeed`, `mercy` (dodge forgiveness),
> `homeward` (walk home after a death), `dropMemory`, `wardedGate` (wall HP), `swiftRoad`
> (cooldowns), `resourceYield`, `regenRate`, `scrying`. That is the entire premise of the game
> working exactly as designed — **and it means two runs on two networks were never comparable.**
>
> A board that records only the outcome is a board that quietly credits a good connection to the
> player holding it. Recording the wire is what makes the board legible, and eventually
> normalisable.

**And there is a second thing it creates, which is worth more than the first.** Pillar 3 forbids
persistence, so the Chronicle — N4.3's tiered store of network readings — **dies at the end of
every session**. It has never been able to answer "is my connection worse this week than last".
The leaderboard is the one structure in this game that legitimately survives a run. Putting the
wire on it means **the leaderboard becomes the game's first long-term network history**, at
one-sample-per-run granularity, entirely inside the existing pillar-3 carve-out. That is a
capability the Deep Wire batch could not give itself.

Three layers go on each record, and they answer different questions:

| layer | what it is | the question it answers |
|---|---|---|
| **Conditions** | a `Bucket`-shaped digest per Chronicle series — `min / med / p95 / max / n / quality` | what was the wire actually doing |
| **Consequences** | the `getGameValue()` outputs, time-weighted over the run | how much did the wire help or hurt *this score* |
| **Comparison** | this run against your own rolling baseline, per metric | was this a good wire *for you* |

**Consequences matter more than conditions and are cheaper to store.** "RTT p50 was 34 ms" is
interesting; "`simSpeed` averaged ×1.09 for the whole run" is *the thing that changed the
result*. Sixteen scalars beat a wall of sensors, and they are already the honest summary because
every mapping row is clamped to a declared band.

**The wire-adjusted score.** Once consequences are recorded, an **assistance index** falls out —
a weighted product of the score-affecting mapping outputs against their neutral values — and
`adjustedLegacy = legacyScore / assistance`. It will not be perfect and the plan does not pretend
otherwise. It is recorded now for the same reason the seed and input log are: *the data has to
exist before the analysis can*, and retrofitting it into a shipped record format costs a
migration or a permanently incomparable back-catalogue.

**Split across two phases, deliberately, and the split is not where it looks.** SR9 lands the
**whole v3 record including every wire field**, even the ones nothing reads yet. SR10 is the
comparison and presentation layer on top. One format change, one migration — adding fields to a
record format twice means doing the migration twice, and the second one has real user data in it.

---

## 4. The look — why it feels like 1993, measured

I went looking before designing. Three findings, all of them checkable:

**Finding 1: there are zero shaders in this codebase.** Not "few". Zero. A grep for
`new Filter`, `GlProgram`, `GpuProgram`, `wgsl`, `glsl` and every stock Pixi filter across all
37,449 lines of TypeScript returns exactly one hit, and it is a comment in
[postprocess.ts](../../src/engine/postprocess.ts) saying *"A future WGSL port (WebGPU only)
would make it real-time."* The file's own header lists **"zero shaders"** as a feature.

**Finding 2: nothing is lit.** Every sprite is drawn at full brightness and tinted globally.
There is a light *direction* — `FoeView.updateShadow(lightDX, lightDY, alpha)` offsets a contact
ellipse — but no light *sources*, and no per-pixel response to any of them. A campfire does not
illuminate the ground. Night is a coloured rectangle over the world.

**Finding 3: the palettes are four flat steps of one hue.** From
[sprites.ts](../../src/engine/procgen/sprites.ts):

```ts
const STONE: RGB[] = [[60,65,78],[80,85,98],[105,110,125],[130,135,148]];
```

Four greys. Same hue, four brightnesses. That is a 1993 palette, and it is 1993 for a specific
reason — it is what you do when you have no lighting: bake the shading into the colours.

### The thing worth saying plainly

**Pillar 1 is not why this looks old.** "No image assets" is a constraint on *where pixels come
from*, not on *how good they are*. Dead Cells, Blasphemous, Children of Morta and Hyper Light
Drifter do not look modern because of their sprite resolution — they look modern because every
pixel is **lit, per-frame, by real light sources, through a shader**. A normal map generated
from a seed at runtime is exactly as procedural as the sprite it belongs to.

The reason this game looks like 1993 is that **it renders like 1993**: unlit sprites, baked
shading, blend-mode compositing, no shaders. That is fixable without touching pillar 1 at all.

---

## 5. The look — SR4 through SR8

*Design here; shaders, buffers and the measurement that gates the batch in [§11](#11-implementation-detail).*

Ordered strictly by **visual return per unit of work**. SR5 is the one that matters; the rest are
multipliers on it.

### SR4 — The shader floor

The enabling phase. Pixi v8's `Filter` takes a `GpuProgram` (WGSL) and a `GlProgram` (GLSL)
*together*, so one filter object serves both the WebGPU default and the `?gl` fallback path.

Ship **one** filter end to end to prove the pipeline, and make it one that replaces something:
a **real bloom** — bright-pass threshold, separable gaussian, additive composite — retiring the
Canvas2D blurred-layer fake in `BloomPass`.

Deliverables: a `src/engine/shaders/` home, a paired-source convention, a `CFG.gfx` gate for
every pass, and both backends verified. Nothing else in the batch can start until this works on
WebGL and WebGPU both.

### SR5 — Normal maps and real light *(the one that matters)*

This is the phase that moves the game from 1993 to 2025. Everything else is polish on top of it.

**Where the normals come from, for free.** Every sprite generator in `sprites.ts` already knows
its own geometry — `blocks()` knows it is drawing a wall, `roof()` knows the apex, `makeTree`
knows the trunk. Today that knowledge is thrown away the moment a pixel is written. Instead:

1. `Pix` gains a parallel **height buffer** — one byte per pixel, written alongside the colour.
   Existing generators annotate as they draw (a roof slopes, a trunk is a cylinder, a rock is a
   dome). This is a small edit per generator, not new art.
2. Sobel the height buffer into a **normal map** at bake time. One pass, once, at load.
3. Every sprite becomes a colour texture *and* a normal texture.

**Where the light comes from.** A light buffer rendered each frame, then a shader combining
`colour × (ambient + Σ light_i · N)`:

- campfires, torches, the hall's windows, the forge
- spell impacts, ability novas, elite auras (A2's affix colours already exist and are per-affix)
- boss telegraphs — a telegraph that *lights the ground it will hit* is a readability upgrade as
  much as a beauty one
- the moon, coloured by biome and network state, as a soft directional key

**What this buys, concretely:** night stops being a tint and becomes **darkness with pools of
light**, which *is* the Diablo look. A campfire becomes a place. A tower becomes a landmark. The
Kindled affix's aura becomes a thing that glows on the floor before it burns you.

**The performance ruling this phase must make:** 250 alive × per-pixel lighting inside a 16.67 ms
budget. Mitigations, all standard: cap live lights, cull to the viewport, render the light buffer
at half resolution, and keep every pass behind `CFG.gfx` so a slow machine degrades instead of
dying. **N4.6 already measures the machine** — `PressureObserver`, LoAF jank and the GPU string
are all live readings, which means the graphics settings can auto-tier themselves off
measurements the game is already taking. That is the deep wire paying for the graphics batch.

### SR6 — The palette pass

Cheap, data-heavy, and it fixes Finding 3.

- **Hue-shifted ramps.** Shadows shift toward the ambient hue (cool/blue), highlights toward the
  light's hue (warm). This single rule is most of the visual difference between amateur and
  professional pixel art, and it is arithmetic on a ramp — `palette.ts` already owns ramps.
- **Six to eight steps, not four**, with **ordered dithering** between them so the extra steps
  read as gradient rather than banding.
- **Per-biome grading LUT**, applied in a shader instead of the current tint rectangle.

### SR7 — Game feel

The Hero Siege / VS layer. None of it is hard; all of it is felt.

Hit-stop (freeze 40–80 ms on a heavy hit — the cheapest weight in games), impact flash, weapon
arc trails, damage numbers that scale with severity, crit shake, blood and spark particles,
ground decals that persist for the night, ember drift near fire, and chromatic aberration plus
radial blur on a boss slam. `ParticleSystem` and `cam.shake()` already exist —
`cam.motionScale` already honours `prefers-reduced-motion`, so **every effect here inherits the
accessibility gate for free.**

### SR8 — The Diablo pass

The last 15%, and only worth doing once SR5 is real.

Volumetric light shafts from the moon and from doorways; a wet/specular ground response so
firelight *reflects*; distance fog and a subtle depth blur at the horizon; a darker global
exposure with brighter, fewer lights; and hard warm/cold contrast — cold ambient, warm fire —
which is the colour grammar every Diablo game is built on.

---

## 6. Risks

| risk | why it is real here | mitigation |
|---|---|---|
| **Frame budget** | 250 foes + per-pixel lighting + four post passes against 16.67 ms, on a WebGL fallback path | half-res light buffer, viewport light culling, `CFG.gfx` tiers auto-selected from N4.6's live machine readings |
| **WebGPU/WebGL divergence** | every filter needs paired WGSL *and* GLSL, and they will drift | one filter in SR4 proves the convention; the visual gate runs both backends before any phase lands |
| **The Gathering is a five-minute tutorial** | a speedrunner will optimise it into a rush, and then act 1 is dead weight | SR1 ships instrumented — measure what a fast player actually does in minutes 0–5 before defending the act |
| **The draft trivialises the Loom** | three cards offered from 15 nodes is a much narrower tree than 15 nodes browsed | offer weighted by depth and holdings; the Loom's four keystones stay a real choice, which is the property B3.b was built to protect |
| **A wall most runs lose to is a wall most players quit at** | Q2 chose a wall deliberately, and the failure mode is a player who never sees the finale land a hit | the four scored outcomes are the mitigation, not a consolation: a losing run still produces a damage number and a survival time to beat. Ship SR3 instrumented and watch the *second* run, not the first |
| **Keyboard-only strands existing pointer code** | `BuildSystem` takes screen coordinates and `main.ts`'s pointer handlers are the only caller | SR0 adds a tile-space entry point rather than rewriting the system, and the pointer path is deleted in the same commit so no dead branch survives |
| **Six leaderboard axes is no leaderboard** | categories nobody understands are categories nobody plays | ship three (Time, Purity, Legacy), add the rest only if they are asked for |
| **A record format that leaks identity** | SR9's certificate and any later global board SHIP these records, and the wire readings include IP, PTR, colo, timezone and VPN evidence | an explicit allowlist enforced by a test, not a comment — conditions are recorded, identity never is |
| **The board silently stops recording** | `saveToLeaderboard()` ends in `catch { /* quota exceeded — silently drop */ }`, which is survivable at 400 bytes a record and a hazard with a wire block | budget the block under ~800 bytes, degrade by stripping `wire` from old records rather than dropping the new one, and raise a toast — silent data loss is tolerated nowhere else in this codebase |
| **Assistance indexing is pseudo-science** | "your wire helped you 9%" is a confident number over an unvalidated formula | version the formula on the record so an old card can be RECOMPUTED, show `n` on every comparison, and refuse to render a baseline under five runs |
| **Pillar 1 pressure** | the temptation, once lighting exists, to "just add one texture" | the rule is unconditional and has survived two batches. Normal maps are generated. Nothing is fetched |

---

## 7. Phasing

Two tracks. **They are independent and can run in either order** — SR1–SR3 touch systems and
data, SR4–SR8 touch the renderer, and they do not collide.

| phase | contents | depends on | status (2026-08-23) |
|---|---|---|---|
| **SR0 — Keyboard only** | `Input.pressed/held`, tile-space entry to `BuildSystem`, ghost-at-facing + hold-to-paint, arrows-nudge mode, delete the four pointer build handlers, click → pause menu (the one piece of new UI) | — | **shipped** |
| **SR4 — Shader floor** | `engine/shaders/`, paired WGSL+GLSL convention, `CFG.gfx` gates, real bloom replacing the Canvas2D fake, both backends green | — | **shipped** |
| **SR5 — Light** | height buffer in `Pix`, Sobel normals at bake, light buffer, the lighting shader, light sources on fires/spells/telegraphs/moon | SR4 | **partial** — shipped as a mask-based "darkness with pools of light" approximation piggybacked on the glow layer, not the full per-pixel normal-mapped lighting spec'd above; no height buffer, no Sobel bake |
| **SR6 — Palette** | hue-shifted ramps, 6–8 steps, dithering, per-biome LUT | SR4 | **shipped** |
| **SR7 — Feel** | hit-stop, flashes, trails, decals, crit weight, boss-slam distortion | SR4 | **shipped** |
| **SR8 — Diablo pass** | shafts, ground specular, fog, exposure, warm/cold grading | SR5 | **partial** — fog + exposure/warmth grading shipped, plus (2026-08-23) a flat overcast baseline so daytime — ~70% of a run's clock — stops rendering as neutral/undecorated; light shafts and ground specular still not built (need live visual tuning / the normal-map pipeline SR5 didn't build) |
| **SR1 — Three Acts** | `CFG.sr.actCurve`, act-driven density and elite gating, the act named in the HUD, instrumentation | SR0 | **shipped** |
| **SR3 — The Reckoning** | the summons trigger, the boss as a wall, four outcomes, the certificate with axes, Gear Score | SR1 | **shipped** |
| **SR2 — The Quickening** | the level-up draft over Loom nodes, weapon evolution over A5 weaves, elemental affixes, pickup radius | SR1 | **shipped** |
| **SR9 — The board** | category comparators over the board that **already exists** (`nw.leaderboard`, `saveToLeaderboard`, `migrate`); the v3 record in FULL — seed + input log + checksum, and the whole `wire` block even where nothing reads it yet; the privacy allowlist and the quota fix | SR3 | **partial, and the missing part is the risky part** — see below |
| **SR10 — Wire history** | the comparison layer: per-metric baselines from your own past records, the assistance index, both vocabularies on the scorecard | SR9 | **partial** — `compareWire` and the Lens comparison UI shipped; `assist.index`/`assist.formula` are hardcoded `{ index: 0, formula: 1 }`, never actually computed, so the "Adjusted" leaderboard axis has nothing to rank on |

**SR9's gap, in detail — found on 2026-08-23 review, not yet fixed:**
- **The privacy allowlist has no test.** §3's own ruling says *"the allowlist is enforced by a test rather than a comment"* and lists six required tests (§SR10 "Tests"). None exist — `regression.ts` has zero references to `WireRecord`, `buildWireRecord`, `SCORED_TARGETS`, or `compareWire`. `buildWireRecord()` in `src/game/systems/scoreboard.ts` does appear to hand-honor the allowlist (no `ip`/`colo`/`country`/`timezone`/coordinates/mask-evidence fields present in what it reads), but there is nothing that *fails the build* if a future edit adds one back in. This is the one risk the plan called out by name as needing a test, not a comment — and it shipped with only the comment.
- **The quota-degrade rung regressed.** `saveToLeaderboard()` (fixed 2026-08-23 in an earlier pass, before the wire block existed that same day) retries at shrinking entry caps `[50, 25, 10, 3, 1]`, exactly as the plan's *"budget it"* rung asks — but the plan's *second* rung, *"strip `wire` from the oldest half of the board"* before shrinking the count, was never added even though the wire block shipped an hour later in the same session. Right now a quota failure loses whole records before it tries losing the cheaper thing first.
- **`assist.index` is a stub, not a placeholder.** §3 specs it as *"a weighted product of the score-affecting mapping outputs against their neutral values"* — a pure, computable-from-`values` formula, not something needing live tuning. Shipping `{ index: 0, formula: 1 }` unconditionally means every stored record already has the wrong number baked in under `formula: 1`, and the "Adjusted" category (§3's fifth leaderboard axis) can't be built until this is real. Worth fixing before more records accumulate under a formula version that was never the real formula.
- **Two of five leaderboard axes never shipped.** `CATEGORIES` in `scoreboard.ts` has `legacy` / `time` / `purity` only. `pact` (covenant-weighted) and `adjusted` (blocked on `assist.index` above) are both still missing — consistent with the risk table's own *"ship three... add the rest only if asked for"* mitigation, so this may be intentional rather than a gap, but it's worth confirming against the plan's original five-axis intent rather than assuming.

**First: SR0.** It is the smallest phase in the batch, it is mostly deletion, and every phase
after it assumes a control model. Building SR1's acts against a mouse and then removing the
mouse is doing the work twice.

**Then the graphics ladder, SR4 → SR8, in order.** Q4 took the whole thing, which makes this the
larger half of the batch. The order is not negotiable: SR5 needs SR4's pipeline, SR8 needs SR5's
lights, and SR6/SR7 are cheap once SR4 exists. **SR5 is the gate** — its answer to "does
per-pixel lighting fit 16.67 ms with 250 foes alive" decides whether SR8 is a plan or a wish, so
it is measured before SR6 starts rather than after SR7.

**Then the run, SR1 → SR3 → SR2.** A curve, then a finish line, then depth on top of a shape that
exists. SR9 last, because a board with nothing to rank is furniture.

---

## 8. What this plan deliberately does not do

- **No classes.** Declined once already in the retired A-arsenal §4.3, on the grounds that a
  forever-character's class fantasy does not survive a fifteen-minute run. Still true.
- **No second difficulty axis.** The covenants are it. A7's brief forbade this in bold and the
  leaderboard's Pact category is the payoff for having listened.
- **No persistence beyond the board.** No meta-progression, no unlocks between runs, no account.
  Pillar 3 is the reason this game is fifteen minutes and not a job.
- **No hosted backend** unless Q1 comes back that way.

---

## 9. Open questions

All six opening questions were answered on 2026-08-22 — see §0.1. What remains are the questions
that only measurement can answer, listed so they are not mistaken for oversights:

**M1 — does per-pixel lighting fit the budget?** 250 alive, four post passes, 16.67 ms, on the
WebGL fallback path too. SR5 answers it with a number and the rest of the graphics track is
downstream of that number. *Measured in SR5, before SR6 starts.*

**M2 — what does a fast player actually do in minutes 0–5?** Q3 kept the Gathering because it is
the identity of the game. That verdict deserves evidence, so SR1 ships instrumented and the act
gets defended or compressed on what the instrument says, not on what either of us assumed.

**M3 — how many runs does it take to beat the wall?** Q2 chose a boss most runs lose to. The
failure mode is a player who quits before the finale ever lands. Watch the *second* run and the
fifth, not the first.

**M5 — does the assistance index mean anything?** SR10 ships a formula that is probably wrong.
The test is whether `adjustedLegacy` actually compresses the spread between runs on good and
bad wires, measured across a real history rather than argued about. `assist.formula` is
versioned on every record precisely so the answer can be applied retroactively.

**M4 — is the draft narrower than the Loom?** Three cards from fifteen nodes is a much tighter
tree than fifteen nodes browsed, and B3.b resized the Loom specifically so that "one keystone is
a real choice" was true. SR2 must not quietly undo that.

## 10. First thing to do

**SR0**, because it is the smallest phase here and everything else assumes its control model.
Deleting `aimAngle` and the pointer attack path is an afternoon, and it makes movement the only
aiming verb in the game — which is the property Q5 asked to protect.

**Then SR4, and then measure SR5 immediately.** Prove one real filter on both the WebGPU default
and the `?gl` fallback, then get per-pixel lighting standing and put 250 foes in front of it with
a frame counter running. Every other estimate in this document — the whole of SR6, SR7 and SR8 —
is downstream of that one number.

---

## 11. Implementation detail

Written after reading the seams, not before. Every file path, symbol and line number below was
checked against `main` at the merge. Where a phase turned out to be smaller than the design
section assumed, **that is recorded rather than quietly enjoyed** — three of them did.

Two new `CFG` blocks carry this batch. They go beside `a2` / `a6` / `a8` / `n45`, in
[data/config.ts](../../src/game/data/config.ts), and each has an `enabled` flag that is a real
revert:

```ts
sr: {
  enabled: true,
  keyboardOnly: true,          // SR0
  buildReachTiles: 1,          // SR0 — ghost distance along aimAngle
  actCurve: [ /* SR1 */ ],
  reckoningAtSec: 720,         // SR3 — minute 12 of a ~15 min run
  draftCards: 3,               // SR2
  draftRerollGold: 40,
  pickupBaseTiles: 1.2,
},
gfx: {
  tier: 'auto',                // 'auto' | 'low' | 'mid' | 'high' — SR4
  bloom: true, lights: true, palette: true, feel: true, atmosphere: true,
  lightBufferScale: 0.5,       // SR5 — half-res light target
  maxLights: 32,               // SR5
},
```

---

### SR0 — Keyboard only

> **Three findings shrank this phase to roughly a third of what §3 assumed.** They are worth
> stating because each one is a thing we were about to build that already exists.
>
> 1. **`aimAngle` was never a mouse.** [player.ts:56](../../src/game/world/player.ts#L56) sets
>    `this.aimAngle = Math.atan2(ay, ax)` from the movement axis, inside the branch that only
>    runs when there is input. The game has always been movement-aimed. There is **no aiming
>    work in this phase at all** — the property Q5 asked to protect was never at risk.
> 2. **Space is already the attack key.** [ui.ts:478](../../src/game/ui/ui.ts#L478) —
>    `else if (kl === ' ') this.hooks.attack()`. The pointer path at
>    [main.ts:555](../../src/main.ts#L555) is a *redundant* second way to do the same thing.
>    Deleting it costs zero gameplay.
> 3. **`aimAngle` holds its last value when you stop.** Because it only updates while moving,
>    standing still and pressing Space swings in the direction you were last travelling. That
>    is already the right behaviour and needs no defending — but it is now load-bearing, so it
>    gets a test.

**What actually touches the mouse for gameplay** — five handlers,
[main.ts:543–570](../../src/main.ts#L543-L570), and that is the entire list:

| handler | today | after SR0 |
|---|---|---|
| `pointermove` | `build.paint()` while held, else `build.hover()` | deleted |
| `pointerdown` | `build.hover()`, or `combat.attack()` | → `ui.openPause()` |
| `pointerup` | `build.place()` | deleted |
| `contextmenu` | `build.cancel()` | deleted (Esc does it) |
| `wheel` | `build.cycle()` | kept — harmless, and pleasant when a mouse is present |

**Step 1 — `Input` gains edge detection.** [input.ts](../../src/engine/input.ts) currently
exposes only `axis()`. The build ghost, the draft (SR2) and the pause menu all need
*press*, not *held*:

```ts
export interface Input {
  axis(): { x: number; y: number };
  /** True exactly once per physical keypress. Consumed on read. */
  pressed(key: string): boolean;
  /** True while held — for hold-to-paint. */
  held(key: string): boolean;
}
```

Implemented with a second `Set<string>` of keys that went down this frame, cleared at the end of
each `sim()` tick rather than each render frame, so a 30 fps machine cannot eat inputs. Note the
existing handler calls `e.preventDefault()` **only** for keys in `KEYMAP`; the new keys join that
list so `Enter` and `[` `]` stop scrolling the page.

**Step 2 — `BuildSystem` gets a tile-space core.** Today `hover(sx, sy)`, `place(sx, sy)` and
`paint(sx, sy)` each take *screen* pixels and call `cam.toWorld()`. Split, do not rewrite:

```ts
// new, the real ones
hoverTile(tx: number, ty: number) { … }        // was the body of hover() after toWorld
placeTile() { … }                              // was place() after toWorld — commits at mode.tx/ty
paintTile(tx: number, ty: number) { … }
// kept as thin wrappers, because TOUCH still needs them
hover(sx, sy) { const [wx, wy] = this.ctx.cam.toWorld(sx, sy); this.hoverTile(wx / TILE | 0, wy / TILE | 0); }
```

The virtual joystick in `input.ts` is untouched and touch play keeps working — "keyboard only"
is a statement about the desktop control scheme, not a removal of the touch path.

**Step 3 — the ghost follows your facing.** New, called each frame from `main()` while
`build.mode` is set:

```ts
aimFromPlayer() {
  const p = this.ctx.state.player, r = CFG.sr.buildReachTiles;
  const tx = Math.floor((p.x + Math.cos(p.aimAngle) * r * TILE) / TILE) + this.nudgeX;
  const ty = Math.floor((p.y + Math.sin(p.aimAngle) * r * TILE) / TILE) + this.nudgeY;
  this.hoverTile(tx, ty);
}
```

`nudgeX/nudgeY` are an offset in tiles, reset to 0 on `start()` and on `cycle()`.

**Step 4 — the keys.** While `build.mode` is active, **arrow keys stop being movement and become
nudge.** This requires splitting `KEYMAP`: WASD stays movement always, arrows are movement only
when not building. That is a real mode switch and it must be announced in the build banner
(`ctx.setBuildBanner`) or it is a trap.

| key | action |
|---|---|
| `Enter` | place at the ghost (`placeTile()`) |
| `Enter` **held** | paint — each tick, if the facing tile changed and `validate()` passes and `affordable() > 0`, commit |
| arrows | nudge the ghost ±1 tile (build mode only) |
| `[` / `]` | `cycle(-1)` / `cycle(+1)` |
| `Esc` | `cancel()` |
| `Space` | attack (unchanged) |

Hold-to-paint is a `lastPaintedTile` guard, not a timer: commit only when the tile *changes*, so
standing still with `Enter` down places exactly one building.

**Step 5 — the pause menu.** This is the only genuinely new UI in SR0. `ui.showGameOver()` exists
([ui.ts:1419](../../src/game/ui/ui.ts#L1419)) and is the shape to copy — a modal over the canvas.
`openPause()` needs: resume, the run's live stats (`scoreboard.getLiveStats()` already returns
them), the controls list, and a restart. Bound to `Esc` when `!build.mode`, and to left-click.

**Tests.** `aimAngle` tracks the movement axis and *holds* when input stops; `hoverTile` and
`hover` agree for the same world point; hold-to-paint places exactly one building per distinct
tile; `[`/`]` cycle the same list `selectable()` returns; Esc clears `build.mode` and the ghost.

---

### SR4 — The shader floor

**The starting position:** [postprocess.ts](../../src/engine/postprocess.ts) header says
**"zero shaders"** as a feature, and `BloomPass` is a `<canvas>` with radial gradients drawn into
it at quarter resolution, uploaded via `Texture.from(canvas)`, composited as a `Sprite` with
`blendMode = 'add'`, `zIndex = 60`, `alpha = 0.4`. It never reads the framebuffer — it draws
glow *where systems tell it there is glow*.

**New home:** `src/engine/shaders/`, one file per effect, each exporting a factory:

```ts
// src/engine/shaders/bloom.ts
import { Filter, GlProgram, GpuProgram } from 'pixi.js';

export function makeBloomFilter(opts: { threshold: number; intensity: number }) {
  return new Filter({
    gpuProgram: GpuProgram.from({ vertex: { source: WGSL_VERT, entryPoint: 'main' },
                                  fragment: { source: WGSL_FRAG, entryPoint: 'main' } }),
    glProgram:  GlProgram.from({ vertex: GLSL_VERT, fragment: GLSL_FRAG }),
    resources: { bloomUniforms: { uThreshold: { value: opts.threshold, type: 'f32' },
                                  uIntensity: { value: opts.intensity, type: 'f32' } } },
  });
}
```

**The convention this phase establishes**, and every later filter obeys:

1. **Paired sources, same file.** WGSL and GLSL for one effect live together so they cannot
   drift into separate commits. A filter with only one is a bug, not a WebGPU exclusive.
2. **Uniforms declared once**, in a `resources` block, named `u*`.
3. **Every filter behind a `CFG.gfx` boolean**, checked where it is *attached*, not inside the
   shader. Off means the filter is not in `container.filters` at all — a no-op shader still
   costs a full-screen pass.
4. **Both backends in the visual gate before the phase lands.** `?gl` is not a debug flag here,
   it is half the target.

**The real bloom.** Three passes: bright-pass (`max(0, luma - uThreshold)`), separable gaussian
(horizontal then vertical, at `lightBufferScale`), additive composite. Attached to
`stage.world`, not `app.stage`, so the HUD stays out of it — the same boundary `BloomPass`
already respects with its `zIndex = 60`.

**`GlowSpot` does not die.** `BloomPass.render(spots)` is called with explicit glow sources
today, and that list is exactly what SR5's light buffer needs. The Canvas2D compositing is
replaced; the *inventory of things that glow* is kept and promoted.

**Tiering.** `CFG.gfx.tier = 'auto'` resolves at boot from readings **N4.6 already takes**:
`net.vessel.reading` carries the unmasked GPU string, `pressureFrac`, and the LoAF jank window;
`snap.jankMs` is live. Auto-tier picks `high`/`mid`/`low` from those and **re-checks once at 60 s**,
dropping a tier if the jank window says the first guess was wrong. The deep wire paying for the
graphics batch is not a metaphor — it is `readGpu()` and `observeJank()`, already shipped.

---

### SR5 — Normal maps and real light

The gate phase. Everything in SR6/SR7/SR8 is downstream of the number this produces.

**Step 1 — `Pix` emits height.** [sprites.ts:20](../../src/engine/procgen/sprites.ts#L20) is a
`w × h` `ImageData` with `set/rect/outline/done`. It gains a parallel `Uint8Array`:

```ts
export class Pix {
  private img: ImageData;
  private hgt: Uint8Array;                 // NEW — one byte per pixel, 128 = flat
  set(x, y, c: RGB, a = 255, h = 128) { …; this.hgt[y * this.w + x] = h; }
  rect(x0, y0, x1, y1, c: RGB, h = 128) { … }
  done(): HTMLCanvasElement { … }          // unchanged
  normals(): HTMLCanvasElement { … }       // NEW — Sobel over hgt, packed RGB
}
```

`h` defaults to 128 so **every existing call site keeps compiling and keeps working**, producing
a flat-lit sprite identical to today. Generators then opt in one at a time — `blocks()` gives
walls a face gradient, `roof()` slopes from apex to eave, `makeTreeVariants` rounds the trunk,
`makeRockVariants` domes. No new art is drawn; the generators are annotating knowledge they
already have and currently throw away at write time.

**Step 2 — Sobel to normals**, once, at bake:

```
n.x = (h[x-1,y] - h[x+1,y]) * strength
n.y = (h[x,y-1] - h[x,y+1]) * strength
n.z = 1;  normalize;  pack to RGB as (n * 0.5 + 0.5) * 255
```

`normals()` returns a second canvas → a second `Texture.from()`. The 1px `outline()` writes
height 128 so silhouettes stay flat and do not get a bright rim.

**Step 3 — the light buffer.** A `RenderTexture` at `CFG.gfx.lightBufferScale` (0.5), cleared to
the ambient colour each frame, into which every live light is drawn as a radial falloff. Lights
are gathered the same way `GlowSpot`s already are:

| source | where it already exists |
|---|---|
| campfires, the hall, the forge | `FireSystem`, `state.buildings` |
| spell impacts, novas, volleys | `EchoSystem`, `AbilitySystem` |
| elite auras | `EliteState.has` — A2 already gives every affix a `color` |
| boss telegraphs | `hordes.updateFoe` telegraph phase |
| the moon | `daynight.tintAt(state.clock)`, already computed |

Capped at `CFG.gfx.maxLights` (32), sorted by distance to the camera centre, culled to the
viewport plus one tile.

**Step 4 — the lighting filter**, applied to `stage.world`:

```
albedo = texture(uWorld, uv)
N      = texture(uNormals, uv) * 2 - 1
L      = texture(uLight, uv)              // pre-accumulated, half res, bilinear
lambert = clamp(dot(N, normalize(uLightDir)), 0, 1)
out    = albedo * (uAmbient + L * (0.35 + 0.65 * lambert))
```

**Step 5 — night stops being a rectangle.** [main.ts:123–126](../../src/main.ts#L123-L126) draws
a screen-space `Graphics` rect with `blendMode = 'multiply'` over everything. That *is* the
1993 night. It becomes the shader's `uAmbient` term, which means a campfire genuinely carves a
hole in the dark — **darkness with pools of light, which is the Diablo look.**

> **A normals pipeline needs two textures per sprite.** `chunkmap.ts` calls `Texture.from(canvas)`
> in four places (lines 320, 344, 574, 603) and `views.ts` builds a `Sprite` per foe, drop and
> building. Each becomes a pair. Watch texture memory on the chunk cache — this is the most
> likely place SR5 costs more than it looks.

**The measurement that gates the batch (M1).** Seed a world, force 250 alive via
`hordes.toSpawn`, run 600 frames, record p50 and p99 frame time, on WebGPU *and* `?gl`. If p99
breaks 16.67 ms at `high`, the tier ladder absorbs it and SR8 gets re-scoped **before** SR6
starts, not after SR7.

---

### SR6 — The palette pass

Fixes Finding 3. Mostly data.

**Today:** `const STONE: RGB[] = [[60,65,78],[80,85,98],[105,110,125],[130,135,148]]` — four
steps, one hue, shading baked in because there was no lighting.

**After:** ramps are *generated* from a base colour by a rule, in
[procgen/palette.ts](../../src/engine/procgen/palette.ts):

```ts
export function ramp(base: RGB, steps = 7, opts?: { shadowHue?: number; lightHue?: number }): RGB[]
```

- **Hue-shifted.** Shadows rotate toward the ambient (cool/blue), highlights toward the light
  (warm). This single rule is most of the visual distance between amateur and professional pixel
  art, and it is arithmetic on a ramp, not artistry.
- **Seven steps, not four**, with **4×4 ordered (Bayer) dithering** between adjacent steps so the
  extra resolution reads as gradient rather than banding.
- **Per-biome LUT** as a 3D-ish 2D strip texture, sampled in a grading shader — replacing
  `GradePass`'s tinted overlay `Graphics`.

Shading baked into the ramps must come *out* as it goes into the normals (SR5), or every surface
gets lit twice and the world looks like plastic. **SR6 lands after SR5 for that reason, not for
convenience.**

---

### SR7 — Game feel

Cheap, entirely felt, and it inherits an accessibility gate for free.

| effect | implementation | seam |
|---|---|---|
| **hit-stop** | on a hit over a damage threshold, scale `dt` to ~0.05 for 40–80 ms | `main()`'s `simMul` product — where `net.getGameValue('simSpeed')` already multiplies |
| **impact flash** | 2-frame white tint on the struck sprite | `FoeView` already flashes on hurt; raise the contrast |
| **weapon arc** | a fading `Graphics` arc along `swingAngle` | `combat.swingT` / `swingAngle` already exist |
| **crit weight** | bigger, slower, shakier damage numbers | `ui/floaters.ts` |
| **blood / sparks / embers** | new `ParticleKind` rows | `PARTICLE_DEFS` in [particles.ts](../../src/engine/particles.ts) is a `Record<ParticleKind, ParticleDef>` — this is a data edit |
| **ground decals** | blood pools persisting for the night | `views.fx` container, `zIndex = 1e9` today; decals need their own container *under* entities |
| **boss slam** | chromatic aberration + radial blur, 200 ms | new filter, SR4's convention |

**Every one of these routes through `cam.shake()` or the `simMul` product, and
`cam.motionScale` is already `0` when `prefers-reduced-motion` is set** (N4.6). So the entire
phase inherits the accessibility gate without a single new check — provided nothing here shakes
the camera directly instead of through `shake()`. That is the one rule of this phase.

---

### SR8 — The Diablo pass

Only worth doing once SR5's lights are real, because every item is a function of them.

- **Volumetric shafts** — radial blur from each light in the light buffer, masked by an occlusion
  pass. Cheapest convincing god-rays available.
- **Ground specular / wetness** — a second Blinn-Phong term against `uLightDir` using the SR5
  normals, gated per-material so stone glistens and grass does not. `data/materials.ts` is the
  table.
- **Distance fog + horizon blur** — depth from `cont.zIndex`, which `views.ts` already sets to
  world `y` for depth sorting. The sort key is a free depth buffer.
- **Exposure and contrast** — darker global exposure, brighter fewer lights, hard warm/cold
  split (cold ambient, warm firelight). This is the colour grammar of every Diablo game and it
  costs two uniforms.

---

### SR1 — The Three Acts

**Trigger.** `LifespanSystem` already tracks real elapsed time and exposes `minutesRemaining()`
and `fracRemaining()`. The act is a pure function of it:

```ts
export type Act = 'gathering' | 'swelling' | 'reckoning';
export function actFor(elapsedSec: number): Act
```

Real seconds, not `state.clock` — for the same reason the Lifespan uses real time: a Gauntlet
`__nw.step()` loop must not trip the acts, and network jank must not stretch them.

**Consumption.** `CFG.sr.actCurve` is a row per act supplying multipliers over the *existing*
horde knobs rather than replacing them — the same discipline A2's covenant multipliers follow:

```ts
actCurve: [
  { id: 'gathering', untilSec: 300, countMul: 0.6, rateMul: 0.7, elites: false, champions: false },
  { id: 'swelling',  untilSec: 720, countMul: 1.4, rateMul: 1.5, elites: true,  champions: true  },
  { id: 'reckoning', untilSec: 900, countMul: 0.2, rateMul: 0.3, elites: false, champions: false },
]
```

`countMul` and `rateMul` fold into `hordes.spawn()`'s existing product beside `hpGrowth` and the
net scale. `elites: false` gates `rollElite()` — which **already returns null before touching
`Math.random`** when disabled, so the seeded spawn stream is unchanged and the Gauntlet's
seed-comparison tests stay valid. That property was built for `CFG.a2.enabled` and pays for
itself again here.

The Reckoning act *thins* the field (`countMul: 0.2`) so the boss is the fight, not the garnish.

**Instrumentation (M2).** Q3 kept the Gathering on the grounds that it is the identity of the
game. That deserves evidence: log first-craft time, first-build time, first-night HP and tiles
walked in act 1 to the Chronicle, and read them off a real run before defending or compressing.

---

### SR3 — The Reckoning

**The summons.** At `CFG.sr.reckoningAtSec`, `LifespanSystem.checkThresholds()` — which already
owns the warn and critical thresholds — fires a third: `onReckoning()`. It calls into
`WorldBossSystem`, which already knows how to make a lord converge on your hall
([worldbosses.ts:165](../../src/game/systems/worldbosses.ts#L165), `huntSpeed +
convergePerTerritory * terr`). The new work is *selection* and *staging*, not pathing.

**It is a wall (Q2).** Its stats are a function of the **pact** and the act curve, **not** of
your gear:

```ts
bossHp  = base * pow(CFG.sr.bossHpPerTier, tier) * activeCovenant(state.covenant).hpMul
bossDmg = base * …                              * activeCovenant(state.covenant).dmgMul
```

Deliberately **not** a function of `gearScore` — that was the design in the first draft and Q2
overturned it. Outgearing it must genuinely help.

**Four outcomes**, extending the existing `causeOfDeath` union rather than replacing it (the
scorecard's `migrate()` already handles unknown values from older cards):

```ts
outcome: 'reckoned' | 'outlasted' | 'fallen' | 'unmet'
```

**Gear Score** — new, in `rules.ts` beside `wornStat()`, summing over worn slots:

```
gearScore = Σ  (rarityIndex(item) + 1) * 10  +  affixCount * 5  +  Σ affixTier
```

Read from the **roll registry**, not the bag — the same source `trophy` uses, so a Sovereign you
found, wore and lost to a death scatter still counts. That precedent is already set and tested.

**The scorecard becomes v3.** `RunScorecard` gains `outcome`, `gearScore`, `reckoningSec`,
`bestHit`, `bestBurst10s`, `bossDamageDealt` — all optional, so every v2 card stays valid, the
same carve-out `elitesFelled` / `pact` / `trophy` already took. `migrate()` handles it.

**v3 is cut once.** The seed/input-log fields (§2) and the whole `wire` block
([SR10](#sr10--the-wire-record-and-its-history)) land in the *same* format bump, even where
nothing reads them yet. Bumping a record format twice means running a migration twice, and the
second one has real user data in it.

> **The cost Q2's verdict carries.** If most runs lose, the scorecard cannot only reward winning.
> `bossDamageDealt` and `reckoningSec` are not decoration — they are what makes a losing run a
> run with a number to beat. A board whose only category is "did you kill it" has three rows.

---

### SR2 — The Quickening

**1. The draft, and the trigger nobody had to build.** `LoomSystem` already grants points at
exactly the "you got stronger, come spend it" moments — `onNightSurvived()`, `onBossSlain()`,
`onSkillLevelUp()` via the Long Thread keystone — and already exposes
`canAllocate(nodeId): boolean` and `allocate(nodeId): boolean`. The draft is those three
functions and a modal:

```ts
offerDraft() {
  const pool = LOOM_NODES.filter(n => loom.canAllocate(n.id));
  const cards = weightedPick(pool, CFG.sr.draftCards, { byDepth: true, avoidHeld: true });
  // pause → render → on choice: loom.allocate(id)
}
```

Fired from the point grant, not from a panel. `levelUpFlourish(ctx)` already exists for the
moment's juice.

**M4 is the risk to hold.** B3.b resized the Loom from 40 nodes to 15 *specifically* so that
"one keystone is a real choice" was true, and `testLoomTreeShape` / `testLoomPayoffLayerIsReal`
pin that. Three cards from fifteen is a much narrower tree. The weighting must guarantee a
keystone appears when affordable, or SR2 quietly undoes B3.b and the suite will not catch it —
because the suite tests the *tree*, not the *offer*.

**2. Elements become an affix.** X1 shipped four hard-coded elemental swords —
`sword_fire`, `sword_frost`, `sword_void`, `sword_storm`, each an `I(...)` row carrying
`effects: ['fire_on_hit']` ([items.ts:142–146](../../src/game/data/items.ts#L142-L146)). That is
the concept without the generality: four weapons in the entire game can have an element and none
can roll the one you wanted.

A1's affix table gains an **elemental family** — fire, cold, lightning, chaos, physical — with
tiered rolls, rolled by the same `rollRarity` / affix machinery that already produces prefixes
and suffixes. Each maps to an existing `effects` hook where one exists (`fire_on_hit`,
`chill_on_hit`) and to a new one where it does not. **The C4 rule applies without exception: an
affix that grants an effect hook with no consumer is an affix that does nothing**, and seven of
those shipped once already. The four X1 swords stay as authored bases that begin with theirs.

This also gives A5's weaves and A6's Forge-Warden a better target: a thread that converts an
element, a reroll chasing a specific one.

**3. Pickup radius.** `DropSystem` already owns pickup. Radius becomes
`CFG.sr.pickupBaseTiles × gearMod(state, 'pickupRadius') × loom.mods.pickupRadius` — a new
`gearMod` key and a new `LoomModifiers` key, both of which must be **granted by a node and
consumed by a system in the same commit**, per B3.a.

**4. No auto-attack.** Q5. Echoes keep their C1 autofire and A3 active — "some auto stuff from
abilities" is already shipped. No new switches.

---

### SR9 — The board

> **This phase is much smaller than §3 assumed, because the board already exists.**
> [scoreboard.ts](../../src/game/systems/scoreboard.ts) has `LS_KEY = 'nw.leaderboard'`,
> `saveToLeaderboard()`, `loadLeaderboard()`, `migrate()`, a `MAX_ENTRIES` prune, and a sort that
> already ranks `legit` runs above god-mode ones regardless of score. Q1's "local board" is
> **built**. What is missing is categories and verification.

**Categories.** `loadLeaderboard()` returns `RunScorecard[]`; a category is a comparator plus a
filter, which is data:

```ts
export const CATEGORIES = [
  { id: 'time',    label: 'Fastest Reckoning', filter: c => c.outcome === 'reckoned', cmp: (a,b) => a.reckoningSec - b.reckoningSec },
  { id: 'purity',  label: 'Lowest Gear',       filter: c => c.outcome === 'reckoned', cmp: (a,b) => a.gearScore - b.gearScore },
  { id: 'damage',  label: 'Biggest Hit',       filter: () => true,                    cmp: (a,b) => b.bestHit - a.bestHit },
  { id: 'legacy',  label: 'Legacy',            filter: () => true,                    cmp: (a,b) => b.legacyScore - a.legacyScore },
];
```

**Ship three, not six** (§6): Time, Purity, Legacy. Add the rest when someone asks.

**SR9 lands the whole v3 format, including the parts SR10 reads.** The `wire` block is specced
in [SR10](#sr10--the-wire-record-and-its-history); it is *written* here. Recording a field
nothing consumes is normally this codebase's cardinal sin — the exception is bought explicitly:
a record format is the one structure where the data must exist **before** the analysis, because
the back-catalogue cannot be re-recorded later. The dormant-row rule is suspended for exactly
these fields and for exactly that reason, and §11's test list pins that they are all *written*.

**The verification insurance (§2), and it must land in the same commit as v3.** Every record
gains:

```ts
seed: string;          // already known — the ?seed= or the generated one
inputLog: string;      // base64 of a compact (tickDelta, keyMask) ring buffer
inputHash: string;     // cheap checksum over the log
engineVersion: string; // the build this ran on — a replay is only valid against its own rules
```

Pillar 4 is what makes this cheap: *"the same `?seed=` always generates the same world."* A run is
therefore fully described by its seed plus its input stream, and a server can later re-simulate
it and confirm the score **without trusting the client at all**. Nothing checks it now. It has to
be *recorded* now, because adding it to a shipped record format means a migration or a
permanently unverifiable back-catalogue.

**Keyboard-only pays for this too.** A keyboard input stream is a small, discrete, exactly
replayable thing. Pointer coordinates in screen space, at an arbitrary DPR, against a camera that
moves, are not. **SR0 and SR9 are the same decision seen twice** — which is a good sign for both
of them.

`engineVersion` is the honest limit: a replay is only valid against the rules it ran under, and
`window.NW.CFG` retunes balance at runtime. A verifier must pin the config too, or record that
it was touched — the scorecard's existing `legit` flag is the precedent for that admission.

---

### SR10 — The wire record and its history

Implementation for the design in [§3](#sr9--sr10--the-board-and-what-the-wire-did-to-it). SR9
lands the **format**; SR10 lands the **reading of it**.

#### The record shape

`RunScorecard` v3 gains one optional block. Optional, like `elitesFelled` / `pact` / `trophy`
before it, so every v2 card stays valid and `migrate()` needs no new branch to *load* — only to
*label* a card that has no wire data as "not recorded".

```ts
/** SR9/SR10 — what the wire was doing while this run happened.
 *  Conditions, consequences, comparison. Never identity — see the allowlist. */
export interface WireRecord {
  v: 1;
  /** CONDITIONS — one digest per Chronicle series, reusing the Bucket shape the
   *  store already produces: min/med/p95/max/n and the honesty tag. */
  series: Record<string, { min: number; med: number; p95: number; max: number; n: number; q: Quality }>;
  /** CONSEQUENCES — time-weighted mean of each score-affecting mapping output
   *  over the run. Sixteen scalars, each already clamped to a declared band. */
  values: Record<string, number>;
  /** One-shot facts that do not vary across a run. */
  shape: {
    effectiveType: string;      // '4g' | '3g' | …
    saveData: boolean;
    deepLive: boolean;          // did the kernel-level wire ever report
    natClass: string;           // 'cone' | 'symmetric' | … — never the address
    udpV6: boolean;
    protoDominant: string;      // 'h3' | 'h2' | 'http/1.1'
    pact: string;               // already on the card; mirrored here for self-containment
    soundings: number;          // N4.5 — how many were spent
    downMbps?: number;          // only if a sounding actually measured it
    upMbps?: number;
    bloatGrade?: string;
  };
  /** VESSEL — the machine, because it moves the score too (jank → mercy). */
  vessel: {
    gpuTier: 'low' | 'mid' | 'high' | 'unknown';   // a TIER, never the GPU string
    cores: number;
    pressureMean: number;
    jankP95: number;
    reducedMotion: boolean;
  };
  /** ASSISTANCE — the single derived number, and the version of the formula
   *  that produced it, because the formula will be wrong at first. */
  assist: { index: number; formula: number };
}
```

`assist.formula` is not decoration. The first version of the index will be wrong, and a stored
number whose derivation is unknown is a number nobody can fix later — versioning it means an
old record can be **recomputed** from `values` rather than discarded.

#### Where each field already comes from

Nothing here needs new measurement. Every one of these is a reading the game already takes.

| block | source | already shipped in |
|---|---|---|
| `series` | `ChronicleStore.get(key)` → `Series.stats()` and the existing `Bucket` roll-up over the whole run | N4.3 |
| `values` | `net.getGameValue(target)` for each of `NET_GAME_MAP`'s score-affecting targets | N1 → N4.7b |
| `shape.natClass`, `udpV6` | `net.snap.natClass`, `net.snap.udpV6` | N4.7b |
| `shape.protoDominant` | `net.protocolReality().dominant` | N4.7 |
| `shape.downMbps`, `bloatGrade` | `sounding.last` | N4.5 |
| `vessel.*` | `net.vessel.reading` — `pressureFrac`, `jankMs`, `cores`, `reducedMotion` | N4.6 |
| `shape.pact`, `soundings` | `state.covenant`, `sounding.count` | N4.5/A7 |

#### Sampling the consequences

A mapping output read once at death is a lie — `simSpeed` swings across a run. It needs a
**time-weighted mean**, and the cheap place to take it is the sensor poll that already runs at
0.1 Hz in `NetworkSystem`:

```ts
// in ScoreboardSystem — accumulate, never store a series
private wireAcc: Record<string, { sum: number; sec: number }> = {};
sampleWire(dtSec: number) {
  for (const t of SCORED_TARGETS) {
    const a = (this.wireAcc[t] ??= { sum: 0, sec: 0 });
    a.sum += this.ctx.net.getGameValue(t) * dtSec;
    a.sec += dtSec;
  }
}
```

`SCORED_TARGETS` is a **data row, not a guess** — the explicit list of mapping targets that move
the score, kept beside `CFG.legacy.weights` so the two are edited together. A target that starts
affecting the score and is not added here silently stops being accounted for, which is the same
dormant-row failure in a new place, so **the suite asserts every `SCORED_TARGETS` entry resolves
to a real `NET_GAME_MAP` target**.

#### The comparison layer (SR10)

`loadLeaderboard()` already returns every past card. With `wire` on them, the baseline is a
median over the player's own history — no server, no cohort, no statistics anybody has to trust:

```ts
export interface WireComparison {
  metric: string;
  now: number;
  baselineMed: number;     // median across the last N records that HAVE wire data
  deltaPct: number;
  percentile: number;      // where this run sits in your own history, 0..100
  n: number;               // how many records the baseline rests on — shown, always
}
export function compareWire(card: RunScorecard, history: RunScorecard[]): WireComparison[]
```

**`n` is displayed, always.** A "23% better than usual" computed from two prior runs is noise
wearing a percentage sign, and the Lens doctrine is that a reading states what it rests on.
Below `CFG.sr.wireBaselineMinRuns` (start at 5) the comparison renders as *"not enough history
yet — N of 5 runs"* rather than as a number.

**Presentation obeys pillar 7.** The scorecard is a bridge surface — it already prints
`dominantRealm` (fiction) next to `peakRtt` (instrument) — so the wire block gets **both
vocabularies**: the Veil says *"the wire ran quick for you tonight"*, the Lens panel says
`pulse med 34 ms · p95 71 ms · ×1.09 simSpeed · +22% vs your median (n=14)`. Same row, two
readings, exactly as the covenants do it.

#### Two rulings this feature forces

**1. Privacy — the record carries conditions, never identity.** This matters because SR9's
certificate and any future global board would *ship* these records off the machine, and several
of the readings involved are identifying. An explicit allowlist, and a test that fails on
anything outside it:

| never recorded | why |
|---|---|
| `publicIp`, `srflxIp`, `srflxIp6` | it is the player's address |
| `isp` / PTR / reverse-DNS | names the subscriber's provider, often the subscriber |
| `colo`, `country`, `timeZone`, coordinates | location. A city-scale CDN edge on a shareable certificate is still a location disclosure |
| `maskEvidence` bands and signals | a shareable artefact asserting "strong evidence you are on a VPN" is an accusation attached to a name |
| the unmasked GPU string, `enumerateDevices` counts | fingerprinting surface. `gpuTier` carries the useful part |

The N4.7 masking panel was built on the rule that *evidence never leaves the machine*. A record
format that quietly exports it would undo that, so the allowlist is enforced by a test rather
than by a comment.

**2. Storage — the quota `catch` must stop being silent.** `saveToLeaderboard()` currently ends
in `catch { /* quota exceeded — silently drop */ }`. That is survivable when a record is ~400
bytes; with a wire block it is a design hazard, because the failure mode is **the board quietly
stops recording and nobody finds out for a month**. Three changes:

- **Budget it.** `MAX_ENTRIES` is 50; the wire block must stay under ~800 bytes serialised, so
  the whole board stays under ~60 KB against a ~5 MB quota. Numbers are rounded to two decimals
  on write — full float precision on a p95 is noise stored at eight bytes a digit.
- **Degrade, do not drop.** On quota failure, retry once having stripped `wire` from the oldest
  half of the board. Losing history is better than losing the run that just finished.
- **Say so.** A failed write raises a toast and a Chronicle line. Silent data loss is the one
  thing this codebase's honesty doctrine has never tolerated anywhere else.

#### What SR10 makes possible later

The same argument as the seed and input log, and it is worth stating so nobody re-litigates it:
**record now, analyse later.** With `values` and `assist` on every card, a future global board
can rank on `adjustedLegacy` instead of raw score, and a cohort baseline can replace the
personal one without changing the record format again. Without them, every card written before
the idea occurred to anybody is permanently incomparable.

#### Tests

Every `SCORED_TARGETS` entry resolves to a live `NET_GAME_MAP` target; the time-weighted mean of
a constant is that constant; a v2 card loads and reports its wire as *not recorded* rather than
as zeroes (a zero would read as "the wire was terrible"); `compareWire` returns *insufficient
history* below the minimum rather than a confident number; the allowlist test fails if any
forbidden key appears anywhere in a serialised record; and a forced quota failure degrades the
board rather than dropping the run.
