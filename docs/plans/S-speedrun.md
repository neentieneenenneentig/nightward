# Batch SR — The Reckoning

*A fifteen-minute speedrun ARPG that ends in a boss, and a look that stops apologising.*

**Status:** plan. Nothing built. Written 2026-08-22, the day `dev/night-build` merged nineteen
milestones to `main` and both previous live plans were retired.

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

Three pillars get touched. Two survive intact; one needs an explicit ruling.

**Pillar 8 (the Lifespan) survives, reworded.** The run stays ~15 real minutes and stays
un-extendable. What changes is what the clock *does* at the end: instead of ending the run, it
**summons the thing that ends the run**. That is a stronger reading of the same pillar — "won by
what you accomplish inside the window" is more true when the window closes on a fight.

**Pillar 1 (100% procgen) survives, and is not the problem.** See §4. A normal map generated
from a seed is exactly as procedural as the sprite it belongs to.

**Pillar 3 (no persistence except finished-run outcomes) needs a ruling.** A leaderboard is, by
definition, *many* finished-run outcomes kept across sessions. Three ways out, in preference
order, and this is **open question Q1**:

| | shape | pillar 3 | cost |
|---|---|---|---|
| **(a)** | a **local** board in `localStorage` — your own last 50 runs, sorted by category | the existing carve-out, in the plural. Nothing new is persisted that a scorecard did not already persist | small |
| **(b)** | a **run certificate**: the finished scorecard encodes to a short signed string / URL the player can paste anywhere | no persistence at all — the player is the storage | small, and it is how this genre did it before servers |
| **(c)** | a **hosted** board | breaks pillar 3 and adds a backend, an abuse surface, and a moderation problem to a game with a console | large, and out of character for the project |

Recommendation: **(a) + (b)**. Together they give a personal best board *and* something to post
in a Discord, with no server. (c) stays available later if the game ever deserves it.

---

## 3. The run — SR1, SR2, SR3

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

**4. Auto-attack — declined, and its purpose taken instead.** VS is auto-everything because your
hands are for movement. NIGHTWARD's combat is a real swing with a telegraph, a dodge and a
recovery window, and A2's affixes were balanced against a player who can *choose* not to swing.
Auto-attack deletes that. What we take is the **intent**: an option for the basic swing to
repeat while the key is held, and an option for bar abilities to auto-fire on cooldown. Both
off by default, both in the options panel, neither touching the leaderboard's categories.

### SR3 — The Reckoning (the finale and the score)

**The summons.** At `CFG.sr.reckoningAtSec` (≈ minute 12) the Lifespan stops being a countdown
to nothing. The horde thins, the sky changes, and one lord — the deepest one you have provoked —
walks at your hall from the edge of the map. This uses `WorldBossSystem`'s existing converge
behaviour with a new trigger. The run now has an **antagonist** rather than an expiry date.

**Its difficulty is a function of the run you had.** Not a fixed wall. The boss scales on your
gear score, your Loom depth, the pact you swore and the lords you already killed — so rushing
the boss underpowered is a *legitimate strategy with a worse payout*, not a soft-lock. That is
what makes a speedrun category interesting.

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

The pact axis is the quiet win here: **the covenant system is already a difficulty selector with
five tiers and a raise-only rule, which is exactly the shape a speedrun leaderboard wants.** It
was built for a data budget and it turns out to be a category system.

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
| **A scaling boss is a boss you cannot lose to** | scaled to your power, it always meets you evenly, and an even fight every time is a boring fight | scale *sub-linearly* — outgearing it must genuinely help, it just pays less |
| **Six leaderboard axes is no leaderboard** | categories nobody understands are categories nobody plays | ship three (Time, Purity, Legacy), add the rest only if they are asked for |
| **Pillar 1 pressure** | the temptation, once lighting exists, to "just add one texture" | the rule is unconditional and has survived two batches. Normal maps are generated. Nothing is fetched |

---

## 7. Phasing

Two tracks. **They are independent and can run in either order** — SR1–SR3 touch systems and
data, SR4–SR8 touch the renderer, and they do not collide.

| phase | contents | depends on |
|---|---|---|
| **SR4 — Shader floor** | `engine/shaders/`, paired WGSL+GLSL convention, `CFG.gfx` gates, real bloom replacing the Canvas2D fake, both backends green | — |
| **SR5 — Light** | height buffer in `Pix`, Sobel normals at bake, light buffer, the lighting shader, light sources on fires/spells/telegraphs/moon | SR4 |
| **SR1 — Three Acts** | `CFG.sr.actCurve`, act-driven density and elite gating, the act named in the HUD, instrumentation | — |
| **SR3 — The Reckoning** | the summons trigger, the boss encounter, four outcomes, the certificate with axes, Gear Score | SR1 |
| **SR2 — The Quickening** | the level-up draft over Loom nodes, weapon evolution over A5 weaves, pickup radius, the two auto-fire options | SR1 |
| **SR6 — Palette** | hue-shifted ramps, 6–8 steps, dithering, per-biome LUT | SR4 |
| **SR7 — Feel** | hit-stop, flashes, trails, decals, crit weight, boss-slam distortion | SR4 |
| **SR8 — Diablo pass** | shafts, ground specular, fog, exposure, warm/cold grading | SR5 |
| **SR9 — The board** | local board + run certificate, category sorting | SR3, **Q1** |

**Recommended first cut: SR4 + SR5.** Not because the run matters less, but because *the look is
the thing the user can see in ten seconds*, the run half is more expensive to judge without
playing, and SR5's answer to "does per-pixel lighting fit the budget" is the single fact that
determines whether the rest of the graphics track is a plan or a wish.

**Second cut: SR1 + SR3.** That is the speedrun — a curve and a finish line. SR2 is depth on top
of a shape that has to exist first.

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

**Q1 — the leaderboard's shape.** Local board, run certificate, both, or hosted? §2 recommends
local + certificate. **This gates SR9 and nothing else**, so the rest can start regardless.

**Q2 — how hard is the finale?** Should a well-played run beat the boss most of the time (a
victory lap) or rarely (a wall you train against)? This is the single biggest feel decision in
the run half and it cannot be derived — it is a taste call about what a run is *for*.

**Q3 — does the Gathering survive?** Five minutes of Terraria before ten minutes of ARPG. Keep
it as the identity of the game, compress it to two minutes, or make it skippable at a scoring
cost? §7 says instrument first, but the intent should be stated up front.

**Q4 — how far up the graphics ladder?** SR4–SR6 gets to "modern pixel game" honestly. SR7–SR8
is the Diablo reach and roughly doubles the batch. Worth it now, or after the run half proves
the game is worth looking at longer?

**Q5 — auto-fire, in or out?** §3 declines auto-attack and offers two opt-in switches instead.
If the intent was closer to true Vampire Survivors — hands on movement only, all damage
automatic — that is a different combat model and a much larger change to A2, A3 and the dodge.

---

## 10. First thing to do

Prove SR4 on both backends with one real filter, then measure SR5's lighting cost against the
16.67 ms budget with 250 foes alive. Every other estimate in this document is downstream of
that one number.
