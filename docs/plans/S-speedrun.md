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

### SR0 — Keyboard only *(Q5, Q6 — and it goes first)*

Small, cheap, and it changes the control model every phase after it is built on. It is also
mostly **deletion**, which is the best kind of phase.

**Attack aiming: delete the mouse, keep the verb.** `combat.ts` already resolves its swing as
`player.aimAngle ?? FACING_ANGLE[player.facing]`. Removing `aimAngle` does not remove aiming —
it makes **movement the only aiming verb in the game**, which is precisely the property that was
asked to be preserved. Positioning becomes the whole skill of the default attack, and that is a
much better fit for a leaderboard than a mouse is: keyboard input is consistent across machines,
and a run's inputs are then a clean, replayable stream (see §2's verification note — these two
decisions help each other).

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
| **A wall most runs lose to is a wall most players quit at** | Q2 chose a wall deliberately, and the failure mode is a player who never sees the finale land a hit | the four scored outcomes are the mitigation, not a consolation: a losing run still produces a damage number and a survival time to beat. Ship SR3 instrumented and watch the *second* run, not the first |
| **Keyboard-only strands existing pointer code** | `BuildSystem` takes screen coordinates and `main.ts`'s pointer handlers are the only caller | SR0 adds a tile-space entry point rather than rewriting the system, and the pointer path is deleted in the same commit so no dead branch survives |
| **Six leaderboard axes is no leaderboard** | categories nobody understands are categories nobody plays | ship three (Time, Purity, Legacy), add the rest only if they are asked for |
| **Pillar 1 pressure** | the temptation, once lighting exists, to "just add one texture" | the rule is unconditional and has survived two batches. Normal maps are generated. Nothing is fetched |

---

## 7. Phasing

Two tracks. **They are independent and can run in either order** — SR1–SR3 touch systems and
data, SR4–SR8 touch the renderer, and they do not collide.

| phase | contents | depends on |
|---|---|---|
| **SR0 — Keyboard only** | delete `aimAngle` and the pointer attack path, tile-space entry to `BuildSystem`, ghost-at-facing + hold-to-paint, click → pause/menu | — |
| **SR4 — Shader floor** | `engine/shaders/`, paired WGSL+GLSL convention, `CFG.gfx` gates, real bloom replacing the Canvas2D fake, both backends green | — |
| **SR5 — Light** | height buffer in `Pix`, Sobel normals at bake, light buffer, the lighting shader, light sources on fires/spells/telegraphs/moon | SR4 |
| **SR6 — Palette** | hue-shifted ramps, 6–8 steps, dithering, per-biome LUT | SR4 |
| **SR7 — Feel** | hit-stop, flashes, trails, decals, crit weight, boss-slam distortion | SR4 |
| **SR8 — Diablo pass** | shafts, ground specular, fog, exposure, warm/cold grading | SR5 |
| **SR1 — Three Acts** | `CFG.sr.actCurve`, act-driven density and elite gating, the act named in the HUD, instrumentation | SR0 |
| **SR3 — The Reckoning** | the summons trigger, the boss as a wall, four outcomes, the certificate with axes, Gear Score | SR1 |
| **SR2 — The Quickening** | the level-up draft over Loom nodes, weapon evolution over A5 weaves, elemental affixes, pickup radius | SR1 |
| **SR9 — The board** | local board, category sorting, and the seed + input log + checksum that makes a global board possible later | SR3 |

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
