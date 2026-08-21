# NIGHTWARD — Roadmap (Batch 7 "Soul-Forged" — ACTIVE 2026-07-19)

> **Pivot (2026-07-16):** The world is no longer a dream — it's your network. Live browser
> network metrics (RTT, jitter, bandwidth, connection type, real clock) drive every game
> mechanic: terrain, spawns, day/night, resource flows, difficulty. The procgen engine stays
> — but its parameters are now live functions of your internet connection. Same tab, same
> seed, totally different world depending on where and how you're connected.

**Status: L1 "The Lifespan" SHIPPED ✅ (2026-07-31).** Branch `u2-grimdark`.
Typecheck clean, build green, **Gauntlet 72/72 functions / 1249/1249 assertions PASSED**
(live-verified 3× consecutively via headless Chrome + raw CDP at `?gl&seed=1234`, zero flakes).

---

> ## Direction update (2026-08-21) — the Hero Siege yoink → Batch A "The Arsenal"
>
> User direction, verbatim: *"update our plan to yoink all the UI, gameplay, etc from hero
> siege!"* Briefed as **Batch A — The Arsenal** (`docs/plans/A-arsenal.md`). Systems and
> interaction patterns only — rarity ladders, rolled affixes, elite packs, an ability bar,
> orbs, comparison tooltips, sockets, a gambler. No art, names, or copy, which costs nothing
> here because pillar 1 means there is no asset pipeline to put borrowed art into.
>
> **The audit finding: we already have about two thirds of Hero Siege under other names.**
> The Loom is a talent tree. Night hordes are waves. The five lords are act bosses. The
> Armory is a relic system. B5 already puts loot on the floor and walks you over it. What is
> genuinely missing is short and specific:
>
> | Gap | Status today |
> |---|---|
> | **Rarity tiers + rolled affixes** | none — 67 hand-authored items, a strictly linear copper→iron→silver→star ladder, zero rolls |
> | **Elite / champion packs** | `EnemyBehavior` is per *type*, never rolled per *spawn* — every skeleton on night 6 is the same skeleton |
> | **Active ability bar** | Echoes are auto-firing only; the bottom bar holds verbs (Interact/Attack/Ignite/Build), not powers |
> | **Item tooltips** | **zero tooltips exist anywhere in the codebase** — so a rolled item would be invisible to the player |
> | **A gold sink** | exactly one in the whole game (`hordes.ts:730`, scatter-cache) |
>
> ✅ **Why A1 is cheap:** `grep registerEffect` returns **fifteen live, working, already-
> consumed effect hooks** (`fire_aura`, `lifesteal`, `chain_on_kill`, `dodge`, `gold_find`,
> `thorns_reflect`, …). They were built in C4 to serve **five relics**, and fourteen of them
> are reachable from exactly one item each. The entire *suffix* half of an affix system —
> "of the Ember", "of the Leech", "of the Wisp" — is a data table over hooks that already
> work and are already Gauntlet-covered. **A1 is mostly a `data/` edit.**
>
> ⚠️ **The collision, and it needs a decision:** Hero Siege is a forever-character game —
> keep the hero, keep the loot, climb for a hundred hours. Pillar 3 forbids persistence and
> pillar 8 caps a run at ~15 real minutes. Diablo-style drop rates inside that window would
> ship six rarity tiers of which no player ever sees the top four — the same dormant-content
> failure the Lens work spent two milestones stamping out. Three ways out, in A-arsenal §4.2;
> **recommendation is (a) compress the ladder so it is traversable inside one run + (b) record
> your best item as a trophy on the finished-run scorecard**, which pillar 3 already permits.
> Option (c), a persistent stash, is buildable but changes what NIGHTWARD is — a conversation,
> not a commit.
>
> **Classes are the one borrowed system the brief declines.** They are a retention mechanism;
> the Loom already does build identity better inside our constraints, and picking an identity
> *before* you know what the wire is doing that run is backwards for this game. Build the Loom
> out instead — unless overruled.
>
> ⚠️ **A7 collides with N4.5 and must not become a second difficulty axis.** N4.5's data-budget
> opt-in is already user-directed to double as the difficulty selector. A7 gives that one
> control ARPG-shaped consequences (enemy scaling, a rising rarity floor, Riftborn gated to the
> top two tiers). One selector, two vocabularies: the Veil calls it a covenant, the Lens calls
> it a data budget.
>
> ⚠️ **A2 is gated on the outstanding N4.3 balance verdict.** Rolled enemy affixes multiply
> against per-night scaling *and* the Fray mapping *and* a Surge omen, and Fray × Surge already
> compounds to ×1.81 horde speed with no verdict in yet.
>
> **Suggested first cut: A1 + A4** (the roll, plus orbs / comparison tooltips / loot beams /
> rarity colour / minimap). That is the whole Hero Siege loop — kill, see a coloured beam, walk
> over, read a tooltip, feel the upgrade — and it touches neither combat balance nor the N4
> file set, so it can run in parallel with N4.4+. Open questions in A-arsenal §9.

> ## Direction update (2026-08-14) — playtest verdicts + a new milestone
>
> **Sound: rolled back, verdict IN.** The user asked to restore the pre-X2 soundtrack. All
> audio drift since the 2026-07-07 baseline came from a single commit, `944adb8`, which added
> a `combat` mood, per-lord `BOSS_MOODS`, and a `deathWhistle` SFX. The `combat` mood was the
> culprit: it triggered whenever any foe came within 10 tiles, which with night hordes and day
> roamers is most of a run — so drums were effectively always on and the ambient soundtrack
> stopped existing. Reverted on `fix/sound-rollback` (`db343c1`); `audio.ts` is byte-identical
> to the pre-change version. Verified in a real (headed) browser by instrumenting the live
> synth: day = triangle / night = sine / **0 kicks, 0 hats even while under attack**, boss =
> sawtooth + 11 kicks + 11 hats, then back to ambient after. Playtest verdict: *"feels more or
> less guchi."* **Standing rule from this: drums and sawtooth are for world bosses only. Do not
> key music off ordinary combat or foe proximity.**
>
> **New user direction — loot must land on the floor.** Verbatim: *"we need drops … for timber,
> berries, etc etc. need to drop on the floor and then we pick it up by walking over it. makes
> it feel more real"* and *"when i kill a boss its gotta drop stuff, the random mobs as well."*
> All three loot sources, not just gathering. Briefed as **B5 — Ground Drops**
> (`docs/plans/B5-ground-drops.md`). It is cheap because all three sites are already the same
> `invAdd`/`acquireGear` loop over a `Stack[]`, and every item already has a 16×16 procgen icon
> that doubles as its world sprite — **no new art, no render-pipeline change.**
>
> ⚠️ **The B5 trap, recorded here so it is not rediscovered:** the Gauntlet's gather tests never
> assert inventory gain (`testGathering:105`, `testGatherEveryFeature:434`,
> `testFullPlaythrough:1904` — none read `player.inv` after a gather). B5 could break the entire
> gather→bag pipeline and the suite would stay green at 1249/1249. This is the §B1.a finding
> repeating in a different system. **B5 owns five new tests; a green Gauntlet is not evidence
> for it otherwise.** Exactly one existing test is expected to go red —
> `regression.ts:1169`'s boss-relic assertion — and that failure is correct.
>
> **Also raised, deliberately NOT bundled:** a WoW-style level-up flourish. Skill xp feedback
> itself is confirmed fine as-is. Specced as optional **B6** at the bottom of the B5 brief;
> needs a yes/no. Kept separate so its playtest verdict isn't tangled with B5's.
>
> **Merge order (all three are unmerged and unpushed):**
> `fix/sound-rollback` → Batch B (`feat/b-reachable-run`, gated on the B1/B3.b playtest) → B5.
> B5 touches `gather.ts`/`hordes.ts`/`worldbosses.ts`/`config.ts`/`main.ts`/`regression.ts` —
> a near-complete overlap with Batch B's file set, so do not parallelise them.

---

---

> ## N4.3 — Omens, 2026-08-20 (branch `dev/night-build`, unmerged)
>
> The half of N4 that stops the Lens being a diagnostics panel bolted to a game. N4.2 shipped
> the `ChronicleStore` and its change detection early; §7 assigned N4.3 the two things that
> were still outstanding — **scheduled jittered probes**, and **wiring detected changes into
> world events** (§5.3). Both now ship. **Gauntlet 1645/1645 across 100 tests, 12 runs green
> out of 12** (a couple of probes branch on terrain, so a run can report 1640 or 1644).
>
> ### The probes were phase-locked to the day/night cycle, and it is exact arithmetic
>
> N4.0 jittered the DoH beacons and stated why: *"so probes never phase-lock."* Three of the
> four schedulers were left on fixed periods, and one of them is a clean divisor:
>
> | scheduler | period | day/night cycle | result |
> |---|---|---|---|
> | DoH beacons | 6 s ±40% | 340 s | already jittered (N4.0) |
> | **same-origin baseline** | **20 s fixed** | **340 s** | **340 / 20 = 17, exactly** |
> | Cloudflare trace | 300 s fixed | 340 s | walks slowly, deterministic within a run |
> | deep-wire (`cfL4`) | 45 s fixed | 340 s | walks, deterministic within a run |
>
> The baseline probe therefore sampled the **same seventeen phases of the cycle on every day
> of every run, forever**. Anything that tracks the cycle — and the whole premise of this game
> is that the network and the world move together — was structurally invisible to it. That is
> not a politeness problem, it is a measurement-validity problem, and no number of assertions
> about the *value* of a sample would ever have found it.
>
> All four now re-roll their next gap through one shared `jitteredGap()` in `data/network.ts`.
> Measured over 300 simulated probes against 68 five-second phase buckets:
>
> | | fixed 20 s | jittered |
> |---|---|---|
> | phase buckets reached | **17 of 68** | **67 of 68** |
> | mean gap | 20.000 s | 19.98 s over 2000 samples |
>
> Live off a running game, the four schedulers' next gaps read `beacon 6.84 s · baseline 14.01 s ·
> trace 345.53 s · deep 56.79 s` — against base intervals of 6 / 20 / 300 / 45, all four now
> off their nominal period and none of them the same twice.
>
> The mean is the load-bearing half of that table. Spreading probes out is fine; quietly
> firing more of them is not, and N4.0 spent an entire phase getting this volume down. The
> test asserts the mean stays within 2% of the configured interval, and the matched control
> asserts `jitteredGap(20, 0)` returns exactly 20000 every time — so the spread above is
> demonstrably the jitter and not the test.
>
> The jitter also multiplies **on top of** the deep wire's failure backoff, so two clients that
> failed at the same moment no longer retry at the same moment.
>
> ### The Lens CHANGES panel has never once shown anything
>
> `main()` calls `chronicle.takeEvents()` at 1 Hz to turn detected steps into Feed lines. That
> drained the same array `tabs.ts` reads for its CHANGES panel and `toJSON()` reads for the
> export. So:
>
> - the CHANGES panel could only ever have shown something if a Lens refresh landed inside the
>   same second as a detection — in practice, never;
> - **every chronicle ever exported carried `"events": []`**, in a file whose entire purpose is
>   to be evidence.
>
> Nothing went red. `testChronicleStore` builds its own store and never calls `takeEvents()`,
> so the drain was invisible to it — the same shape as the four tautologies this suite has
> already shipped. `events` is now the permanent record and a private `pending` queue is what
> `takeEvents()` drains; the test asserts both halves, including the matched control that the
> queue *does* still drain, because a `takeEvents()` that stopped draining would re-log and
> re-raise the same omen once a second forever.
>
> ### Omens — a change on the wire becomes a change in the world
>
> §5.3 asks for three: a latency step-change is a rift, a retransmission burst is a surge, a
> throughput collapse is a famine. `systems/omens.ts` is a table, so adding one is a row:
>
> | series · direction | Omen | effect | gate |
> |---|---|---|---|
> | `fray` ▲ | **Surge** | `hordeAggression` ×1.25 + the screen frays | 3σ |
> | `flow` ▼ | **Famine** | `resourceYield` ×0.65 | 3.5σ |
> | `flow` ▲ | **Bounty** | `resourceYield` ×1.30 | 3.5σ |
> | `pulse` ▼ | **Quickening** | `moveSpeed` ×1.10 | 3σ |
> | `silt` ▲ | **Miring** | `moveSpeed` ×0.88 | 3σ |
> | `pulse` ▲ | **Rift** | fires the realm rift | 4.5σ |
>
> Three decisions in there were choices, not defaults, and are worth stating:
>
> **Omens go both ways.** §5.3 lists only bad ones. A system that can only ever punish teaches
> a player to resent their own connection, and it makes the mapping a penalty box rather than a
> mapping. A latency *drop* is a Quickening and a throughput *surge* is a Bounty.
>
> **A Famine lifts when the network recovers, not when a timer expires.** The plan says "yields
> drop until it recovers" and that is the better mechanic: the player's route out is the
> network coming back, which they can watch happen in the Lens. Recovery is measured against
> the *pre-step baseline* with a 10% hysteresis band and is direction-dependent — a down-step
> recovers by coming back up. The duration cap is a safety valve for a permanently degraded
> link, not the primary exit, and the test distinguishes `recovered` from `expired`.
>
> **An omen is a STEP, not a level.** The `Horde Aggression (Fray)` mapping row already makes a
> lossy link permanently harder. A Surge is what happens the moment it *starts* being lossy.
> Steady-state hostility and a shock are not the same experience and they multiply separately.
>
> ### The rift system has been dead code on desktop since N2
>
> Its only trigger was a `connection.type` transition. **Desktop browsers do not report
> `connection.type` at all** — the flash, the particles, the biome swap, the scoreboard counter,
> all built and tested and unable to fire on the platform this game is played on. A hard latency
> step is the trigger it always needed. `NetworkSystem.riftFromWire()` honours the same 30 s
> cooldown as the transition path, and **returns false when the biome selector returns the realm
> we are already in** — the realm holds and no rift is claimed. Reporting `Vale → Vale` would be
> a lie in the one panel that is not allowed to lie, and the omen is asked-then-raised rather
> than raised-then-asked so a refusal leaves nothing phantom behind.
>
> ### What the tests actually prove
>
> 61 new assertions across 5 tests. Two are worth naming, because both are the kind that would
> have passed on a broken implementation:
>
> **Movement is measured, not read back.** The probe drives the input axis and measures the
> distance the player covers. Reading `omens.mul()` back would pass while `main.ts` computed the
> value and discarded it, which is exactly what shipped in G1 and in the Loom. Measured:
> **1.100× for a Quickening and 0.880× for a Miring**, against configured values of 1.10 and 0.88.
>
> Getting that to three decimals took two goes, and the second one fixed a **pre-existing flake
> in the Loom test**. The Loom's movement probe trials all four directions and keeps the longest
> corridor — an idiom that was itself a flake fix. But *longest* is not *fair*: terrain speed
> varies tile by tile, so a faster player ends up further along and can enter slow ground the
> plain run never reached, and on a short corridor that noise is larger than the modifier. It
> failed as `Deep Roots slows real movement: 28.4 → 29.2px` on a 28 px corridor, with nothing
> wrong in the Loom at all — found while chasing the identical flake in my own probe.
>
> Both now use a shared `findUniformCorridor()`: a straight run of seven tiles that are all
> standable **and all report the same `world.speedAt()`**. On uniform ground distance is exactly
> proportional to the multiplier. The Loom probe consequently gained an assertion it could never
> make before — that Deep Roots' advertised **−12% is 0.880×**, not merely "smaller".
>
> A third cause was underneath both: **a death respawn teleports the player to the hall
> mid-measurement**, which measured 2934.8 px against an expected ~90 on 1 run in 10. Both probes
> now clear the field, restore HP, and reject any run longer than the corridor it was walked down —
> a distance that did not come from walking is not a movement measurement.
>
> **`recovered()` is asserted not to lift on the tick it was raised.** If that comparison were
> inverted, every omen would lift immediately and the entire system would be a no-op that still
> passed an "an omen can be raised" test.
>
> ### Two bugs in my own tests, both instructive
>
> **The stub inverted the thing it was pinning.** The yield thinning uses stochastic rounding —
> `floor(x) + (random() < frac ? 1 : 0)` — and I copied the Loom probe's `Math.random = () => 0`.
> But `0 < frac` is **true for every fractional part**, so the stub made the famine round *up*
> every time and a 2-item harvest thinned to exactly 2. It read as missing wiring. `0.999`
> floors instead, and `floor(n × 0.65) < n` for every `n ≥ 1`.
>
> **A test asked the detector to find a step against a baseline containing that step.** The
> follow-up assertion pushed 60 s of the new level and then stepped back; `detect()` compares
> `now-15..now` against `now-105..now-15`, so the baseline window straddled both levels, its
> standard deviation was the size of the step, and sigma collapsed. The store was right and the
> test was wrong.
>
> Also: the harvest probe took the first feature tile within 6 tiles without checking the player
> could *work* it, got `-1`, and — because `ok()` throws — took the move-speed section down with
> it, leaving `main.ts`'s wiring unverified. It now tries candidates until one actually starts.
> That is the same silently-skipped-phase failure the waystone bug had, caught this time by the
> guard written for it.
>
> ### Live, off a running game
>
> Raised through the real path — a step pushed into the Chronicle, drained by `main()`'s 1 Hz
> tick, handed to `omens.consider()`. Nothing reached into `omens.active`:
>
> ```
> raised:  ["Surge x1.25"]      hud chip: "Surge 73s"
> active:  [{ kind: surge, target: hordeAggression, mul: 1.25, from: 0.5, to: 1.03, sigma: 21.3 }]
> muls:    { horde: 1.25, yield: 1, move: 1 }
> chronicle.events kept after the 1 Hz drain: 2
> l4: { proto: TCP, minRtt: 1.519, lost: 3, retrans: 4, cwnd: 53 }   ← fray 0.75
> ```
>
> **Two attempts at that capture failed, and both failures were the system working.** The first
> raised a Surge and it lifted one second later — because the real reading is a Cloudflare edge
> honestly reporting `lost=0`, so `recovered()` fired correctly. The second wrote to
> `net.snap.fray` to hold it, which did nothing: `net.update()` recomputes the snapshot from
> `deep` every frame, so that write is **the same transient-projection trap as writing to
> `state.player`** — its seventh occurrence. The capture only worked once the *kernel dump* was
> degraded, which is the only authoritative value in the chain.
>
> ### Two things for the playtest verdict
>
> Both are single numbers, flagged rather than pre-emptively tuned:
>
> - **The Surge screen effect may be too much.** `CFG.omens.surgeFxStrength` at 0.5 drives the
>   vignette +0.22 and pushes the grade to `[255,120,120]` at 0.11 strength. In the gate shot it
>   reads close to a damage flash that never ends. The plan asks for loss to be *frightening*;
>   whether it is frightening or just loud is a feel call.
> - **Fray and Surge compound to ×1.81 horde speed.** The Decoder Ring clamps `hordeAggression`
>   at ×1.45 for a badly lossy link, and a Surge multiplies ×1.25 on top. That separation is
>   deliberate — level and step are different experiences — but the product is the number that
>   gets played.
>
> ### The `state.player` projection trap, occurrences eight through twelve
>
> The 12-run baseline went red once on `at least one productive action performed`, in the
> **survival** playthrough. The line above it — `buildings exist at end (3 total)` — passed, so
> the world had buildings but the playthrough had produced none of them. They came from setup.
>
> The cause is the one this project keeps rediscovering. `state.player` is a **projection**;
> `main()` overwrites it from `nw.player` at the end of every sim tick. A write to it is not an
> error, does not warn, and disappears on the next `nw.step()`. The survival playthrough's
> gather loop did exactly this, so it never walked to anything and only gathered what happened
> to be inside the 1.6-tile reach already. **It is the same bug I fixed in the *exhaustive*
> playthrough's phase-1 loop yesterday, in a different function, and I did not check for
> siblings.** Grepping `state.player.x = ` found four more:
>
> | site | what it silently did |
> |---|---|
> | survival playthrough, gather loop | never walked to a node — over 12 runs the playthrough went from **0 crafts and 0 builds** to a steady **12–19 gathers, 12–13 crafts, 8–9 builds** |
> | survival playthrough, setup | "move player near hall" moved nobody |
> | Loom gather-yield probe | only measured nodes already in reach |
> | `testFireIgnite` | ignited from the original tile, not the flammable one |
> | **`testCollisionWalls`** | **a tautology — see below** |
>
> **The wall test was a green light wired to nothing.** It wrote a position on the far side of
> a Palisade, stepped, and asserted the player had not moved far. The player had not moved
> *at all*, because the write was discarded — so `position blocked by Palisade wall` was true
> for the same reason `1 === 1` is true. It would have passed with the wall deleted, with
> collision disabled, with the building system removed entirely. **The fifth tautology found in
> this suite.** It now stands on open ground west of the wall, drives the input axis east for 40
> ticks, and asserts the player stops short of the wall's edge — measured `x=-1163.4` against an
> edge at `-1152` — with a matched control that the player did move east at all, and a second
> that an adjacent wall-free tile *is* standable so the refusal is the wall and not the terrain.
>
> Fixing those changed where the player stands during later tests, which exposed two more latent
> flakes that had been masked by the trap: the Loom's yield probe hardcodes a +20px approach that
> lands in water or in the trunk (it now tries each side and keeps the first node that actually
> *starts*), and `wall placed near chained waystone` guarded its placement on `canPlaceAt()` and
> then asserted unconditionally that the wall was there — the sibling search ten lines above it
> already carries exactly that fix and its comment, and this one was missed.
>
> Twelve runs green out of twelve after all of it, against 11/12 before — and the one that was
> red was red for a real reason.
>
> ### Budget
>
> No new outbound requests. The jitter changes *when* four existing schedulers fire, not how
> often — asserted. N4.5 remains the only phase that will spend the player's data, and it stays
> behind the opt-in that doubles as the difficulty selector.

---

> ## Night build 2026-08-19 — B5, B6, N4.1, N4.2 (branch `dev/night-build`, unmerged)
>
> ⚠️ **This branch is an INTEGRATION branch, not a feature branch.** It is
> `main` + `fix/sound-rollback` + `feat/b-reachable-run` + `feat/g-terrain-depth`, and then
> four new milestones on top. It exists so the whole queue can be playtested as one thing
> instead of five. The individual branches still exist and are still the right unit to
> review. **Nothing here has been merged to `main`.**
>
> Two conflicts in the stack, both trivial and both resolved as unions: `package.json`
> (the `qa:*` scripts vs `gauntlet`) and `main.ts` (`__nw.sys.net` vs `__nw.input`).
>
> ### B5 — Ground Drops
>
> Loot lands on the floor and is walked over. All three loot sources — gathering, horde
> kills, world-boss kills — ended in the same two lines (`invAdd` + `acquireGear`) and the
> item teleported into the bag; B5 replaces that one seam at all three sites. Every
> modifier upstream (mega-cluster area rolls, Loom double-yield, Granary, Battery Scarcity,
> material yield) still runs first and still produces the final `Stack[]`. Only the
> destination changed.
>
> Three beats, because skipping any one makes ground loot feel **worse** than instant
> pickup: the toss (~0.45 s arc, the item visibly leaves the tree/corpse), the rest
> (contact shadow, idle bob), the collect (walk near, it snaps to you).
>
> **Magnet radius 1.6 tiles, not a literal walk-over.** A pure hitbox overlap turns the
> floor after a 43-foe night wave into a pixel hunt. `armDelaySec: 0.25` stops the magnet
> firing before the arc finishes — without it, gathering at point-blank range collects
> instantly and the entire feature is invisible.
>
> Two guards against this codebase's own documented failure modes:
> - Pickup SFX hard-limited to one per 0.12 s. Pickup is high-frequency (43 foes a night,
>   16 rolls per mega-cluster); an unguarded blip per stack is the `deathWhistle` mistake
>   of 2026-08-14 repeated in a new system.
> - Toasts moved from the loot roll to the pickup and aggregate over 0.4 s. The
>   `log.push('gather', …)` entry **stays at the roll** — the event log records what the
>   world produced, which is true whether or not the player walks over to collect it.
>
> `CFG.drops.enabled = false` restores the pre-B5 path exactly. That is the escape hatch if
> the verdict is negative, and it is tested.
>
> **Known consequence, stated rather than hidden:** loot can now be abandoned. Materials
> rot after 90 s; gear, tools and relics never do. Crafting and building can briefly lack
> materials you "earned". That is intended, and it is a real change to flow.
>
> **⚠️ Collision note carried from G4 still applies and is now joined by this one:** a drop
> is clamped to a standable tile when it lands, but drops do not block movement and are not
> entities — they are not in `world`, only in `state.drops`.
>
> ### B6 — Level-Up Flourish
>
> Specced as OPTIONAL and needing a yes/no. **Built anyway, because it is cheap and was
> directly asked for, and it is one config flag from off.** Consider this the prototype the
> verdict is about, not a decision already taken.
>
> A level-up was a toast in the corner plus a sound at two of the seven call sites —
> Firemaking and Combat levelled up in silence. Now: a `levelup` particle row (gold,
> **negative** gravity, ~1 s — motes that rise read as an upgrade, motes that fall read as
> debris), two rings racing outward with the second trailing the first, and a ground bloom,
> ~0.65 s, drawn **on the character**. One shared `levelUpFlourish(ctx)` rather than seven
> copies, because the seven sites had already drifted apart once.
>
> **Skill levels only.** Not soul-gear levels and not Loom points, both of which are
> frequent: a flourish firing several times a minute stops reading as an achievement, which
> is the same always-on-intensity failure that got the combat music rolled back.
>
> ### N4.1 — The Deep Wire
>
> Everything the game measured before this was an **inference**. `navigator.connection.rtt`
> is quantised to 25 ms buckets; `downlink` is capped at 10 Mbps and absent outside
> Chromium; "jitter" was a statistic derived from those buckets, so it was measuring the
> quantiser as much as the network. **Packet loss was recorded in this file as impossible
> from a browser. It is not.**
>
> A Cloudflare edge that terminates our TCP connection returns its own kernel socket
> statistics in a `Server-Timing` header — `cfL4;desc="?proto=TCP&rtt=…&min_rtt=…&rtt_var=…
> &lost=…&retrans=…&delivery_rate=…&cwnd=…"`. That is a `TCP_INFO` dump for our own socket,
> in **microseconds**. `src/game/systems/deepwire.ts`:
>
> - `parseCfL4` / `parseServerTiming`, both defensive, both reading by key and never by
>   position.
> - A passive `PerformanceObserver` harvesting TAO-enabled resource waterfalls. **The TAO
>   test is done on the ENTRY, never on a hostname allowlist** — a host can stop sending the
>   header and a proxy can strip it. A zeroed `responseStart` means "no data", never "0 ms";
>   inverting that would report a filtered network as the fastest ever seen.
> - One **header-only** probe (`__down?bytes=1`) every 45 s through the existing `NetGate`,
>   with backoff. The interesting data is in the headers; spending the player's bandwidth to
>   read a kernel counter would be absurd. The real throughput test stays an opt-in verb
>   (N4.5).
> - Identity as a side effect: `cf-meta-ip/colo/country/city/asn` ride along on the same
>   response — which is what let N4.0 retire `ipify` and `ipapi.co` without losing anything.
>
> **Live-verified**: `pulseBest 2.03 ms` (real `min_rtt`, sub-millisecond) and
> `flowBest 17.03 Mbps` (real `delivery_rate`, above the 10 Mbps `downlink` cap) read off a
> running game.
>
> Six measured metric rows — Fray, Silt, Aperture, Flow, Pulse, Flux — plus three
> "effective" rows the sim consumes. **The measured rows deliberately do not overwrite
> `rtt`/`downlink`/`jitter`**: those keep their documented estimated meaning so the Lens can
> show measured and inferred side by side. Silently swapping one for the other would erase
> the only evidence that the deep wire works.
>
> Two new modifiers that only exist because the kernel told us: **Fray** (loss + retrans)
> drives horde aggression — packet loss should be frightening — and **Silt** (RTT above
> *this path's own* `min_rtt`) drags movement. Silt is measured against the path's own floor
> so a player who simply lives far from an edge is not punished for their geography.
>
> Every derived value sits at **neutral** when the wire is silent. A player behind a proxy
> that blocks the endpoint gets a balanced game, not an easy or an impossible one.
>
> **Correction to record here:** the "What we CANNOT get from a browser" list in this file
> is now wrong about packet loss for Cloudflare-terminated paths. ICMP, pcap, ARP, LAN
> enumeration and WiFi dBm remain correct.
>
> **Not done:** the plan suggests depending on `@cloudflare/speedtest` rather than
> hand-rolling. That package is a full throughput engine and this phase spends no bandwidth;
> it belongs with N4.5, where it would actually earn its place as a dependency in an
> otherwise pixi-only project.
>
> ### N4.2 — The Lens becomes a side cart, and gains a memory
>
> The Lens was a centred modal built by 115 lines of string concatenation in `main.ts`,
> rebuilt wholesale every refresh. **It covered the game** — the wrong shape for a panel
> whose entire premise is that these numbers are driving the world in front of you.
>
> Now a right-edge drawer (380 px; full-width sheet under 700 px). Non-modal: no scrim, no
> input capture beyond its bounds, the game keeps rendering beside it. Animates on
> `transform` only, so opening it never triggers layout during a 60 fps sim. Five tabs —
> PULSE / PATHS / IDENTITY / VESSEL / THREADS — extracted to `src/game/ui/lens/`. Only the
> **visible** tab is rebuilt, only while open, throttled to 4 Hz.
>
> **Honesty tags are the point of the refactor.** Every reading is tagged `measured` /
> `reported` / `derived` / `unavailable`, and an unavailable row says **why** in plain
> language — "unavailable" with no reason is indistinguishable from "broken". PULSE shows
> the deep wire and the browser estimate side by side so the size of the 25 ms bucket is
> visible. PATHS distinguishes TAO routes (full waterfall) from ones where the browser
> zeroes every timing field. IDENTITY keeps a "what we cannot see" section — packet loss
> used to be on it.
>
> **The Chronicle** (`systems/chronicle.ts`). What existed was three arrays of 60 numbers: a
> one-minute sliding window, which cannot answer "what changed?" because by the time you
> notice, the thing it changed *from* has been shifted off the front. Now one session-long
> store, and two decisions carry it:
> - **Aggregates, not decimation.** Old samples collapse into 10 s buckets keeping
>   min/median/p95/max. "Keep every tenth sample" is simpler and throws away exactly what is
>   worth keeping — **the outliers are the event**.
> - **Every sample carries its provenance**, so the export cannot claim precision it never
>   had.
>
> Change detection compares a short window against a longer baseline that **excludes** it,
> in standard deviations rather than percent: a satellite link that always wobbles by 80 ms
> should not fire every minute, and a fibre link that never moves should fire on 20 ms.
> Steps become Feed lines now, and world events in N4.3.
>
> **Export** dumps every series, probe and derived inference as JSON, locally. The panel is
> a data-collection instrument, so the data has to be able to leave it.
>
> Also deleted: `drawSparkline()`, 40 lines of canvas code that had **never once been
> called**. The strip uses inline SVG, which survives `innerHTML` rebuilds.
>
> ### Evidence — including what went wrong
>
> Typecheck clean on both configs · build green · **Gauntlet 1553/1553 across 94 tests, 10 runs green out of 10**
> (up from 1337/1337 across 85: 21 new assertions worth of B5/B6/N4 coverage plus rewrites).
>
> **A correction to my own first conclusion, recorded because the first version of this
> entry was wrong.** I wrote that the intermittent redness was mine, on the strength of six
> consecutive green runs at the pre-feature commit. Six runs is not a measurement of a
> one-in-four event. A proper 8-run baseline at `e7a3ee3` came back **6 green / 2 red, both
> reds on `5/12 systems exercised`** — so the suite already flaked at roughly one run in
> four before any of this work existed. What my changes did was move *which* assertion
> caught it. The two causes below were real and are fixed; they were not the whole story,
> and claiming they were would have buried a pre-existing defect under a tidy narrative.
>
> Two causes that genuinely were mine, both in B5's own test changes:
>
> 1. `testBossDeathPaysOut` walks the player to a lord's corpse now, and restored the
>    position through `state.player.x`. **That is the projection — `main()` overwrites it
>    from `nw.player` every tick** — so the player stayed at the corpse. Two tests that run
>    after it (waystone placement near the hall, the Loom movement probe) went red about one
>    run in three, for reasons having nothing to do with either of them.
> 2. Several new assertions read `state.drops.length` across hundreds of ticks of live sim,
>    in which foes genuinely die and drop loot of their own. They watch planted UIDs now.
>
> Three more flakes surfaced while pinning B5 and **all three were real**: an unpinned toss
> angle drifts a planted stack out of the radius it was planted inside; `state.player` vs
> `nw.player` again, this time putting a stack 55 px from a player it was meant to be 31 px
> from; and one N4.1 test went red because **the probe genuinely succeeded in CI** and
> reported `cwnd 52`, making Aperture legitimately 1.25 — fixed by forcing the wire silent
> for the neutrality assertions rather than by widening the band, since otherwise the
> assertion measures whoever's network is running the suite.
>
> Three real product bugs were found by *writing* the tests rather than after shipping:
> `stats()` walked backwards from the newest sample so the "baseline excluding the recent
> window" swept it up anyway and the detector compared a window against itself; compacting
> everything older than the fine window meant one sample aged out per push, so every
> "bucket" held a single sample and a 900 ms spike reported `med=900`; and rewriting the tab
> bar's `innerHTML` on every selection detached the node the click came from.

> **A rendering bug that predates all four milestones, found by B6.** The level-up burst
> drew its rings and none of its motes. The rings are `views.fx`, which lives inside the
> camera-transformed container; `ParticleSystem` was parented to `app.stage`, which is
> **screen space**. Every call site has always passed world pixels, so since G1
> (2026-07-18) every particle in the game — embers, hit sparks, gather puffs — has been
> drawn at its world coordinate treated as a screen coordinate. Correct only near the
> origin, and wrong by exactly the camera offset everywhere else, which is why it never
> looked broken so much as sparse. One line: `new ParticleSystem(stage.world, 400)`.
> Verified in a 4× clipped capture, not by reasoning about it.

> **And the 4× capture immediately found a second one.** Every stack count lying on the
> ground was an unreadable smudge. `stage.world` is scaled 2× and Pixi renders `Text` into
> a texture at **resolution 1**, so each label was a low-res bitmap linearly upscaled — a
> thin glyph with a dark stroke blurs into grey mush. It presented as a *colour* bug, and
> every property was already correct: fill cream, alpha 1, tint white, no filter anywhere
> in the ancestor chain. What settled it was forcing the fill bright red and getting a dark
> red smudge, which ruled the fill out and pointed at filtering. `resolution = 4`.
>
> Looking at the picture found two more things in the same 30 lines: the count was drawn at
> `(0, 5)`, directly on top of its own contact shadow (an ellipse centred at `(0, 7)`, ry
> 3), so the top half of every digit sat in the darkest pixels of the frame; and `fontSize
> 9` with a **3 px** stroke leaves nothing, because Pixi draws the stroke *over* the fill
> and centres it on the outline, eating 1.5 px inward from each side of a ~2 px stem.
> `BuildingView`'s name label had the same resolution bug and is fixed with it. Floaters are
> unaffected — they convert world→screen and live in an unscaled layer.
>
> **Both of these are the same lesson twice in one night: a renderer cannot be verified by
> reading it.** Two bugs, both months old, both invisible to a suite of 1500 assertions,
> both obvious within seconds of actually looking at a magnified frame. The gate
> screenshots are not decoration for the report; they are the only instrument that catches
> this class of defect.

> **One more flake, and this one N4.1 caused.** The Night Market assertion is
> `round(pop × goldMul × 1.4) > round(pop × goldMul)` with `pop = 2` — false for any
> `goldMul` near 0.8, since `round(1.6)` and `round(2.24)` are both 2. It was stable before
> because `goldRate` was a quantised `downlink` bucket; N4.1 made it a **continuous measured
> value**, so it started landing in the dead band. That is the cost of measuring things
> honestly, and the fix is on the test, not the feature: six huts put the base near 14,
> where a 40% rise cannot round away.

> **The fourth tautological test in this suite.** `testGatherEveryFeature` reported
> "tested === found" and had **never gathered anything**. `world.activeFeatureAt` returns a
> `FeatureDef` directly; the test read `f.def?.id`, which is `undefined` for every tile ever
> scanned, so `found` stayed 0 and the assertion passed as `0 === 0`. Fixing that exposed a
> second bug behind it (the same `state.player` projection write — it located 12 feature
> types and moved to none of them) and a third (the fixture ran with flint tools and
> leftover xp, so only 6 of 10 were reachable). With all three fixed it gathers **11 of 11**
> located feature types. A test whose precondition never holds is not a weak test, it is a
> **green light wired to nothing**, and this suite has now shipped four of them.
>
> **The pre-existing flake, chased to its root rather than documented as weather.** Eight
> instrumented runs printing which systems each playthrough actually touched turned
> `5/12 systems exercised` from a mystery into one line of code. `gather` and `crafting`
> never dropped separately — they dropped **as a pair**, in 3 of the 6 runs that completed,
> and phase 1 reported `0 gathers, 0 crafts` every time. They are a pair because phase 1
> crafts from what phase 1 gathered.
>
> The cause is `state.player` versus `nw.player` **for the sixth time this session**. The
> phase-1 gather loop scans ±3 tiles for a feature and walks to it by assigning
> `state.player.x`. That is the projection, which `main()` overwrites from `nw.player` on
> every sim tick, so the loop moved the player nowhere and could only ever harvest what was
> already inside the 1.6-tile reach. A feature 3 tiles out at 96 px is unreachable, the
> phase logs "13 feature(s) in reach" and gathers none of them, and on a run that also
> happens to miss hordes/echoes/bosses the count lands on exactly 5. It now teleports
> through `nw.player` and stands *beside* the node — a tree tile is not standable, and
> teleporting into one silently leaves the player where they were.
>
> **This projection trap has now caused six bugs in one session and deserves a rule:** in
> tests, read whatever is convenient, but *write* only to `nw.player`. A write to
> `state.player` is not an error, does not warn, and disappears within one tick.
>
> The other 2 of 8 runs died on **`CDP timeout`** with no assertion having failed — a
> harness limit, not a product signal. `cdpRecv` waited 30 s for the next message of any
> kind, and the exhaustive playthrough is one long synchronous block that emits nothing
> between phase logs, so a slow machine was indistinguishable from a hung page. Raised to
> 120 s, which still catches a genuine hang.
>
> The `levelReq` diagnosis in the first draft of this entry was a real fragility and the
> phase log still names gated features — but it was **not** what was firing. It was the
> plausible explanation, and it survived because it was never tested against a measurement.

> **Measured before and after, 8 runs each on the same machine and the same seed:**
>
> | | before | after |
> |---|---|---|
> | runs green | 6 of 8 (2 died on `CDP timeout`, 1 of the 6 red) | **8 of 8** |
> | `gather` exercised | 3 of 6 completed runs | **8 of 8** |
> | fewest systems exercised | **5** of 12 | **8** of 12 |
> | `soulfeed` exercised | **0** of 8 | 6 of 8 |
> | `waystones` exercised | **0** of 16 | exercised |
>
> The last row is the one that matters more than the flake. Soul-feed consumes gathered
> materials, so a playthrough that never gathered could never reach it — the
> "exhaustive" playthrough had been skipping an entire system every single run, and the
> suite reported that as a passing test the whole time. Fixing one projection write did not
> just stop a red light; it turned a third of the playthrough back on.

> **Then the same instrument found a second silently-skipped system.** `waystones` was
> unexercised in **16 of 16** runs. The phase looks up the hall to place waystones around,
> and `exMark(m, 'waystones')` sits inside `if (hall)` — so when the hall dies the phase
> does nothing and says nothing about it. And the hall does die: it is a 400 hp building
> standing through several night waves, and the run log now confirms it in as many runs as
> not. Phase 6 stands a new one up, because that phase exists to exercise waystones and
> hall survival is phase 4's business.
>
> **Two of the twelve systems were quietly absent from every single run while the suite
> reported green.** Neither was found by reading the test. Both were found by printing
> which systems each run actually touched — the same move as the four tautologies: stop
> trusting the pass, and make the test say what it did.

> **A near-miss worth recording.** A Python patch script opened the 263 KB test file for
> writing and then threw a `UnicodeEncodeError` mid-write on a malformed emoji escape.
> Opening for write truncates immediately, so the source file was left at **zero bytes**,
> and a 10-run measurement that was in flight at the time silently measured the wreckage
> — 8 of its 10 runs were garbage. Recovered from `HEAD` in full. Every patch script now
> encodes to bytes FIRST and writes through a temp file plus `os.replace`, so a bad encode
> can never destroy the original. Worth stating plainly because for a few minutes the
> failure looked like a real crash rate and was not.
>
> ### What is NOT done
>
> - **No playtest.** All four of these are feel changes; B5 changes how every loot event in
>   the game feels. They land on the WORKFLOW playtest gate and **nothing here may merge to
>   `main` without a verdict.**
> - **No gate screenshots for B5/B6.** The relief gate shots at `qa/gate-batch-G/` are from
>   the previous session and do not show ground drops.
> - **No `cargo test` run** — no Rust changed, so it was not run rather than run and
>   reported.
> - **No Firefox / headed WebGPU / `pilgrim` lanes**, as before.
> - **N4.2 partially covers N4.3.** The `ChronicleStore`, tiered retention and change
>   detection shipped here because the strip and the export both needed a real backing
>   store. N4.3 still owes the **scheduled jittered probes** (latency ~10 s, DNS ~30 s, STUN
>   at boot and on rift) and the wiring of detected changes into **world events** rather
>   than only Feed lines.
> - **B5 Q2 (gold as physical coins) is still `goldDrops: false`**, and B5 Q4 (drops
>   surviving the death scatter) is left as-is per the brief's recommendation.

> ## Batch G "Depth" — SHIPPED 2026-08-19 (branch `feat/g-terrain-depth`, unmerged)
>
> ⚠️ **Naming collision, read this first.** There is an *already-shipped* `G1/G2 — Visual
> Upgrade & Juice ✅` further down this file, dated 2026-07-18 — screen shake, the 9-kind
> `ParticleSystem`, `BloomPass`, colour grading, vignette. That is a **different G1/G2**
> from the Batch G milestones below, which come from `BG-batch-proposal.md`. Reading the
> ✅ alone would wrongly suggest the terrain work was already done.
>
> **The problem this batch existed to fix:** the chunk baker painted colour and never lit
> it, and the mountain ramp was *darker* than the grass beside it — so a peak read as a
> pit. Terrain had structure at 1 px (dither) and at 32 px (the tile grid) and nothing in
> between.
>
> **G1 — height-field relief lighting** (`src/game/world/relief.ts`, new). A continuous
> height field is derived from the discrete material grid — **bilinear over tile centres**,
> because sampling heightClass per pixel just reproduces the 32px staircase as a hard
> shading edge — plus world-space fbm micro-relief. Normals come from a **3×3 Sobel** (a
> 2-tap forward difference is one-sided and paints a directional seam along every step).
> The result is a 66×66 greyscale texture per chunk, linear-filtered, **multiply**-blended.
> Multiply can only DARKEN, and that is the deliberate trade: flat ground lands at exactly
> 1.0 so G2's palette passes through untouched, and the form is read off the shadowed
> faces. Light direction follows the world clock (east at dawn → west at dusk, altitude
> peaking mid-phase, half strength at night); the sun is **capped below ~45°** because at
> 90° every normal returns ~cos(slope) and relief flattens to nothing — the first
> calibration shipped a near-vertical noon sun and shaded nothing at all.
> **Toggle: `R` in game, or `?norelief` at boot.** The proposal's Option C, as recommended.
>
> **Cost:** ~1 ms per chunk, and it is built **off the bake path** (`RELIEF_BUILD_PER_FRAME`)
> — a normal field costs about as much as the whole rest of a bake, so a teleport into
> fresh terrain would otherwise stall on ~25 at once. Chunks arrive unlit and light up over
> the next frames. Base bake measured at ~6 ms/chunk; **no pre-change baseline was taken**,
> so the batch's total bake delta is unmeasured.
>
> **G2 — palette and value inversion.** All 24 material ramps re-cut from 3 stops to 5
> (`makeTileVariants` now quantises by ramp length, so a 3-stop ramp behaves exactly as
> before). Mountain and snow re-ramped light-on-top; the 8 realm-warped materials moved off
> raw `#cc00cc`/`#00cccc`/`#cc9900`. Measured result: **mountain 165.5 > hill 129.9 >
> grass 119.1** mean luminance off the baked canvas — monotone with height at last.
> Two fixes fell out of this: every tile variant is now **re-centred on the same mean**
> before quantising (each variant carrying its own average brightness is what made the
> ground read as 32px wallpaper), and cliff shading moved from additive `darken()` to the
> new proportional `scale()` — an additive −30 is a cliff face on slate and a **no-op on
> snow**, which was painting "cliffs" lighter than the grass below them.
>
> **G3 — the floating planks.** The cliff pass no longer fires into `heightClass 0`; foam
> already owns the shoreline, and a band there paints a plank of land on the sea. Genuine
> faces widened (9 px one-step / 20 px steep) with per-column striation hashed on the
> **world** pixel column and a top edge that undulates on smooth noise — per-pixel white
> noise there reads as a comb of hair, not broken rock. Measured: shoreline darkens 4.6,
> a real cliff darkens 71.6.
>
> **G4 — silhouette smoothing.** Corner-cut chamfers where two adjacent orthogonal
> neighbours share a foreign material. The feather pass blends *texture* but never reshapes
> the *outline*, which is why the staircase survived it. Drawn in three alpha layers like
> `feather()` does: a single hard-clipped wedge is a **spike** at a high-contrast border
> (dark water sawing into pale sand looked worse than the staircase it replaced).
> ⚠️ Cosmetic only — collision still reads the tile grid, so a corner can look ~13 px
> rounder than it walks.
>
> **G5 — verticality.** Mountain and snow appear in **no feature density table**, so the
> peaks were flat texture fields with nothing standing on them. Added render-only rock
> crags (never gameplay entities — both materials are impassable, so a real gatherable node
> up there would be loot the player can never reach), cut from a **shaded-down** mountain
> ramp: at full brightness a crag is the same value as the rock it stands on and reads as
> an empty outline. Snow gets bare rock with a snow cap. Trees now build each variant at
> its own size (0.72×–1.30×) at native resolution — uniform tree size was most of why a
> forest read as wallpaper.
>
> **G6 — dead code.** Deleted the 174-line `bakeSubpix` path (`subpixFactor` had returned a
> constant 1 since it landed) and the per-tile ambient-occlusion pass, which darkened whole
> 32px squares and was a direct contributor to the tile grid the relief field now handles
> properly.
>
> **Evidence.** Typecheck clean on both configs. **Gauntlet 1249/1249.** New
> `qa/specs/relief.spec.ts` — 5/5, every assertion a **matched pair** with a positive
> control, because a negative claim whose precondition never held is worthless. The
> anti-tautology guard that matters: a flat grey tint over the whole world would sail
> through a naive "boundaries are darker" check, so the overlay must reach a true 1.0
> somewhere *and* average near it. Measured: level ground 0.984, height step 0.799,
> darkest 0.549, brightest 1.000, overall mean 0.978; 94/221 samples move between dawn
> and dusk. Two of these tests **failed first** and both failures were real — the cliff
> control never fired under random wandering (now a directed search), and the
> level-vs-slope split was reading tile *centres*, where a bilinear field's gradient is at
> a minimum.
>
> **Smoke: 3/4.** The red one is the pre-existing drums-in-ordinary-combat regression —
> **verified to fail identically on pristine `main`** this session, and fixed on the
> unmerged `fix/sound-rollback`.
>
> **Gate screenshots** (relief noon/dawn/dusk vs flat, three biomes, seeds 1234/7777/4242):
> `qa/gate-batch-G/` — on disk, gitignored, ~400 KB each. **Awaiting the user's verdict.**
> ## Direction update (2026-08-17) — QA becomes a release gate
>
> **User direction, verbatim:** *"lets create test cases that is like an actual play through,
> timed and everything, as close to real player as possible, we can even have different profiles
> applied to different tests, i dunno, qa needs to be more comprehensive, if a qa run passes game
> must be ready to release effectively … can we use playwright for testing, that way we can get
> playwright traces as well for comprehensive data analysis of qa playthroughs?"*
>
> **Built: `qa/` — Playwright as layer 3 of the test pyramid.** See `qa/README.md`. The framing
> that matters: this does **not** replace the Gauntlet, it covers what the Gauntlet structurally
> cannot. The Gauntlet drives the sim with `__nw.step()` — no rAF, no input, no real time, and
> only ever against the vite dev server. L3 drives a real browser with real keystrokes in real
> wall-clock time, **against the built bundle that GitHub Pages actually serves**. Nothing had
> ever loaded `dist/` in a browser before this.
>
> Seven player archetypes (`qa/profiles.ts`), each a pure `act(snapshot, rng)` policy so a given
> (profile, seed) replays identically: `rusher`, `turtle`, `explorer` (chunk-streaming and heap
> canary), `hoarder`, `idler`, `flailer` (seeded input fuzz — the crash finder), and `pilgrim`
> (one entire 15-minute life to the death screen, `NW_MINUTES=99`). Each emits a per-second
> timeline of hp/gold/foes/inventory/fps/heap as a JSON artifact — a balance dataset, not just a
> pass/fail.
>
> **Finding 1 — the drum regression is live on `main`.** The harness caught it on its first real
> run, black-box, knowing nothing about the source. Staged scenario, seed 1234, production build:
> a foe **0.3 tiles** from the player and the nearest world boss **1767.8 tiles** away (threat
> range 22) — the drum kit played **9 hits in 7.8s**. Across one-minute sessions the counts were
> 44–89 drum hits with no boss involved. Cause: `main.ts:625`
> `… : foesNear ? 'combat' : …` plus the `combat` row of `MOODS` carrying `drums: true`.
> `fix/sound-rollback` (`db343c1`) removes both; rebuilt in a worktree and re-run against the
> identical staged scenario it reads **hats 0 → 0**, while a hunting boss still reads
> **hats 1 → 12**. The fix is verified and waiting only on merge sign-off.
>
> **Finding 2 — the deploy had no gate.** `.github/workflows/deploy.yml` published `dist/` to
> Pages on every push to `main` with zero tests in front of it, and `WORKFLOW.md` still said
> "currently, there's no CI pipeline". Added `.github/workflows/ci.yml` (static trio + Rust tests
> + typecheck of the QA harness + smoke/Gauntlet on the built bundle) and inserted the QA gate
> into `deploy.yml` before `upload-pages-artifact`. Traces upload as artifacts on failure.
>
> **Finding 3 — the game talks to ~14 third-party endpoints.** By design (`data/network.ts` — the
> latency-beacon mechanic), including `ipapi.co/json/` which returns ISP/org/city/country, gated
> behind the first explore action. Not a bug, but a conscious call to make before a public
> release. The QA console-error gate now attributes errors by origin so third-party 429s and
> blocks are recorded but never fail a run.
>
> **Finding 4 — below ~10 fps the world clock and the lifespan clock diverge. NEEDS A DECISION.**
> Only a real-time browser test can see this; the Gauntlet cannot, because `__nw.step()` bypasses
> the frame loop entirely. PixiJS's ticker caps `deltaMS` at `maxElapsedMS` (default **100 ms**,
> never overridden in this codebase), so each frame feeds at most 100 ms into the fixed-timestep
> accumulator in `main.ts:483`. Below 10 fps the game world therefore advances at roughly
> `fps × 0.1 ×` wall-clock. Measured at 2.6 fps: **14 s of game world in 60 s of real time
> (0.23×)** — matching the predicted 0.26×. Meanwhile L1 ages the character off
> `lifespan.updateReal(performance.now())`, which is true wall-clock **by deliberate design**
> (so the cap survives `simSpeed` drift). Consequence: on a machine that cannot hold 10 fps, the
> 15-minute life still expires in 15 real minutes, but the player experiences roughly a quarter
> of the world. For a bounded "perfect run" game going onto Pages for arbitrary hardware, that is
> a fairness question, not just a performance one. Options: leave it; raise `maxElapsedMS`; or
> detect sustained low fps and degrade quality rather than time.
>
> **Finding 5 — the rollback fixes the mood table, but the trigger radius is the real dial.**
> The boss soundtrack keys off `worldbosses.nearestThreatTiles() < CFG.worldBoss.warnTiles`, and
> `warnTiles` is **22 tiles (704 px)** with `count: 3` lords roaming. That radius is comparable
> to the whole visible viewport, so the drums start well before the lord is on screen, engaged,
> or even hunting. Measured on the *fixed* build, `explorer` profile, seed 777: the player walked
> from 42 tiles out down to 4.1, and **26 of 39 sampled seconds sat inside the radius** — boss
> music for roughly two thirds of the session. Caveat: that profile walks a straight line and
> happened to beeline toward a lord, so this is not a general statistic; it needs a multi-seed
> sweep before acting on it. But if the drums still feel too frequent after `fix/sound-rollback`
> merges, **the dial is `NW.CFG.worldBoss.warnTiles` (live-tweakable), not the MOODS table.**
>
> **Confirmed: Gauntlet 72 functions / 1249 assertions pass in a real browser against the
> production bundle** — the first time that has been demonstrated rather than assumed.
>
> ⚠️ **Two traps recorded so they are not rediscovered.** (a) rAF throttling: an occluded or
> backgrounded Chromium stops firing `requestAnimationFrame`, so every frame-derived measurement
> reads zero while the run reports a pass — this produced a false PASS on 2026-08-14.
> `playwright.config.ts` sets three anti-throttling flags AND `Nightward.boot()` refuses to
> proceed unless `__nw.frames` is provably advancing. (b) The `webgl` lane renders through
> ANGLE/SwiftShader at ~3 fps; that is a statement about the software rasterizer, not the game.
> It is a **correctness** lane. Frame-rate floors only apply to the headed `webgpu` lane.
>
> **Release readiness:** the pipe is laid (`base: './'` is correct, the Pages workflow exists and
> now has a gate). Blocking: merge `fix/sound-rollback`; nothing has ever been pushed, so the
> deploy workflow has never actually run; the Firefox lane is written but not yet exercised.

---

> ## Direction update (2026-08-17, later) — the Wire gets real instrumentation
>
> **User direction, verbatim:** *"lets work on the networking panel … side cart style, the game
> itself is a network testing tool right, it tries to determine as much information as possible
> about the environment it is in — whether local stuff executed in the browser execution space
> we running, or whether it hits some api that provides additional information about the caller
> (itself in this case). in addition and on top of the previous is the tests that are run over
> time, the stats in regards to changes in pings, latency, download, upload, etc. … our immediate
> todos are networking expansion then linking new networking stuff into the game loop somehow"*
>
> Planned as **N4 — The Deep Wire** (`docs/plans/N4-deep-wire.md`). Seven phases, each
> independently shippable. Nothing implemented yet.
>
> **The audit that motivated it.** The mapping layer (`NET_METRICS` → `NET_GAME_MAP`, data rows,
> live-editable) is good and N4 does not change its shape. The **measurement** layer underneath
> it is thinner than GDD §4.2 claims: "downlink" is `navigator.connection.downlink`, which Chrome
> caps at 10 Mbps and Firefox/Safari do not implement; **upload has never been measured at all**;
> `jitter` is derived from an RTT value Chrome quantises to 25 ms buckets, so it is usually 0 or
> 25; "beacon latency" is `fetch()` wall-clock including handshakes and main-thread scheduling;
> DNS timing was specced in this document at N1 and never implemented; and `drawSparkline()`
> exists but **is never called** — the 60-sample history buffers are written and never read.
>
> **Finding — `Server-Timing: cfL4` hands us the edge kernel's TCP socket state.** Verified
> against the live endpoint (headers quoted in the brief). `https://speed.cloudflare.com/__down`
> returns `access-control-allow-origin: *`, **`timing-allow-origin: *`**, `server-timing` in
> `access-control-expose-headers`, and a `cfL4` entry carrying
> `rtt`/`min_rtt`/`rtt_var`/`lost`/`retrans`/`delivery_rate`/`cwnd` — microsecond RTT, real
> kernel-measured jitter, **packet loss and retransmissions**, and an uncapped throughput
> estimate. Readable two independent ways (`headers.get()` and
> `PerformanceResourceTiming.serverTiming`). ⚠️ **This corrects this document:** the
> *"What we CANNOT get from a browser"* section implies packet loss needs the optional local
> agent. For any Cloudflare-terminated path it does not. ICMP/pcap/ARP/LAN/WiFi-dBm remain
> correctly listed as impossible.
>
> **Also verified live:** `__up` accepts a POST body and accounts for it (`recv_bytes=200983` on a
> 200 KB upload) — real upload measurement; both DoH resolvers are CORS-open
> (`cloudflare-dns.com/dns-query` with `Accept: application/dns-json`, and `dns.google/resolve`)
> — real DNS, resolver races, PTR on our own IP, DNSSEC `AD`, TTLs; `cf-meta-ip` returns the
> public IP, so **`api.ipify.org` is redundant** and `ipapi.co` (the endpoint whose **429** has
> already failed a QA run) is likely droppable too. And a TAO check across the current beacon
> pool: **none of the fourteen favicon beacons set `Timing-Allow-Origin`**, so they can never
> yield a DNS/TCP/TLS breakdown no matter how they are timed — they stay useful for geographic
> discovery, but precise instrumentation has to route through TAO-enabled hosts.
>
> **The game-loop link.** New signals mostly arrive as new `NET_GAME_MAP` rows — packet loss as
> **Fray** (horde aggression), bufferbloat (`rtt` − `min_rtt` under load) as **Silt** (the world
> thickens), `cwnd` as **Aperture** (carrying capacity), measured throughput replacing the capped
> `downlink` for gold rate. Two things are more than rows: a **Sounding Stone** the player builds
> and activates to run a real throughput/latency/DNS burst — which makes the measurement a game
> *verb* and makes its cooldown double as the data budget and the rate limit — and **change
> detection** feeding the existing rift/omen machinery, which finally gives rifts a trigger that
> fires on desktop (they currently key off `connection.type`, which desktop browsers never report).
>
> **The hard constraint:** throughput testing spends the player's data. Never on boot, honour
> `saveData`, adaptive sizing from 256 KB, a visible session cap, and a `NW_NO_NET` stub mode so
> CI never runs a real bandwidth test.
>
> ⚠️ **Finding — the endpoint-permission liability is in the shipped code, not in N4.** User
> raised it; checked rather than assumed. Everything N4 *adds* is sanctioned: Cloudflare
> publishes **`@cloudflare/speedtest`** on npm (MIT, `vasco@cloudflare.com`, Cloudflare-staff
> maintainers) driving the exact `__down`/`__up` endpoints — we should depend on that package
> rather than hand-roll fetches; both DoH resolvers and both STUN servers exist precisely to
> answer unsolicited requests from strangers. But **the fourteen favicon beacons were never
> invited**, and two say so: BBC's `robots.txt` — *"Please use our site like a human, not a
> robot"*; Le Monde's — *"il est interdit d'utiliser des robots d'indexation Web **ou d'autres
> méthodes automatiques de feuilletage ou de navigation** sur ce site Web"*, citing art. L 342-1
> CPI. `ipapi.co` is a **1,000/day "free trial"** and has already 429'd a QA run.
>
> **And the volume is worse than it looks.** `ACTION_COOLDOWNS.attack = 0`, so every swing fires
> an echo, plus a 3-beacon all-pool volley every 1.5 s. With a `0.64 s` swing envelope
> (`0.32 s` at `attackSpeedFloor`) sustained combat emits **~3.6–5 requests/second — on the
> order of 1,000+ third-party requests per 15-minute run**, each with `cache: 'no-store'` so it
> is a real origin hit, and `probeSingleEndpoint()` has **no failure backoff** (only the
> unrelated `pollEndpoint()` does). The sharp risk is not to us: these come from *the player's*
> IP, and a machine on a corporate or school network beaconing at a fixed 3/s cadence to
> `yandex.ru`/`baidu.com`/`naver.com` is a textbook **C2 signature**. We can get a player
> flagged by their own IT department. Practical risk today is near zero — the game had never
> been pushed until this afternoon — but it is cheap to fix now, expensive after launch, and
> applies at n = 1.
>
> **The fix is also the technical upgrade,** which is why it goes first as **N4.0**: §2.4
> already established none of those fourteen hosts set `Timing-Allow-Origin`, so they can never
> yield a timing breakdown anyway — they are the most legally dubious *and* least informative
> thing we do. Retire the fetches; rebuild route discovery on **DoH** (sanctioned, never touches
> their servers, yields real DNS latency, and returns the host's actual IP so the geography
> stops being a hardcoded `detail: 'London, GB'` string); add a same-origin baseline beacon;
> rate-limit the attack path. Open questions — data budget, `ipapi.co`, whether STUN is
> acceptable, whether to land only N4.0–N4.2 first, and sign-off on changing the shipped beacon
> mechanic — are at the end of the brief and need a decision.

**L1 — The Lifespan: a hard 15-minute "perfect run" loop (2026-07-31).** User's direction
overnight: turn the open-ended survival loop into a bounded, replayable run — "a hard 15 minute
game loop... hard lifespan for players, like 10 years per minute... they simply fall over and die
of natural causes... challenging loop gameplay where u try to get the perfect run." Full brief:
`docs/plans/L1-lifespan-perfect-run.md`. Shipped:
- **`systems/lifespan.ts` (new):** the character ages via REAL wall-clock time (not sim time —
  the cap has to hold regardless of network jank/`simSpeed` drift), `startAge` 16, seeded
  per-run target of `baseRunMinutes` 15 ± `varianceMinutes` 1.5 (a 14–16.5 min window, seeded
  off `state.seed` so a given `?seed=` always rolls the same target). Aging rate is modulated
  by S1's existing vigor/resolve vitals — full vitals = exactly the baseline 15-min ceiling;
  neglect accelerates aging up to `vitalsSwingPct` (12%) faster. **One-directional only: nothing
  extends a run past the seeded cap, including god mode** — old-age death is a SECOND, distinct
  terminal condition alongside hall-destruction, and it is NOT blocked by `state.god` (by design).
- HUD: an age chip + draining lifespan bar in the top bar; warning toast + amber tint inside the
  final `warnMinutesRemaining`, a heartbeat vignette inside `criticalMinutesRemaining`.
- Natural death gets its own ending — "THE DREAM FADES" — distinct flavor text from the
  hall-destroyed "THE THREAD IS CUT," no gold loss/scatter (it's the intended way a run ends,
  not a punishment). `GameState.gameOverCause: 'hall_fallen' | 'old_age'`.
- **Scoreboard v2 (`systems/scoreboard.ts`):** `RunScorecard` gains `age`, `causeOfDeath`,
  `legit`, and `legacyScore` (a transparent weighted sum over nights/kills/bosses/buildings/loom
  points/gold/years-lived + an old-age-finish bonus, weights in `CFG.legacy.weights`, data not
  code). **This replaces the old sort key (`connectionAge` descending, uncapped) — that key
  rewarded being AFK: a player who walled in and did nothing had the dominant leaderboard
  strategy, since nothing ever ended the run.** v1 localStorage records migrate in place on load
  (best-effort score, no crash/data loss). W6's in-progress leaderboard panel (already
  uncommitted on this branch) is finished as part of this milestone and folded into the v2 board.
- **Leaderboard integrity:** `state.everGod` (sticky, set once god mode is ever toggled on) flags
  a run's scorecard `legit: false`; the leaderboard sorts ALL legit runs above ALL flagged runs
  regardless of score, so a god-mode run can never look like a top legit finish. Verified live:
  a deliberately lower-scoring legit run outranks a much higher-scoring flagged one.
- Rebalance: `soulgear.xpBase` 900→250 (+ raised per-action soul xp across the board) — the old
  curve needed ~300 landed swings just to reach weapon soul level 2, most of a whole run spent
  only swinging. Loom gains a second point income (`CFG.loom.pointsPerBossKill`, +2/boss) since
  1/night alone (~2-3 points in a 15-min run) barely samples the 40-node tree.

**Chief-of-staff review pass, same session — real bugs found and fixed (not just the requested
feature):**
1. **World-boss kills never reached the scoreboard.** `worldbosses.ts`'s `hurt()` death branch
   never called `scoreboard.onKill()` (only the ordinary horde-foe death path in `hordes.ts`
   does, and `EnemyDef.boss` is `weight:0` there — it can never actually spawn through that path)
   — `bossesSlain` was permanently stuck at 0 on every run, forever. Fixed: `hurt()` now calls
   `scoreboard.onKill(true)` (and `loom.onBossSlain()`).
2. **`particles.spawn('hit', ...)` — not a real `ParticleKind`.** Two call sites in `hordes.ts`
   (a landed projectile, a damaging trap spring) passed a particle type that doesn't exist in
   `PARTICLE_DEFS`; `ctx: any` erased the type check that would normally catch this. Both threw
   on every occurrence — a live, previously-undetected crash bug in the projectile/trap-impact
   path, found by the new, more-thorough Death & Scatter regression test actually exercising the
   surrounding sim instead of a tautological `ok(true, ...)`. Fixed: `'hit'` → `'spark'`.
3. **Debug/god-mode hotkeys shipped live in every production build.** `CFG.debug.enabled: true`
   was the only gate, and nothing ever set it false; `g`/`h`/`m`/`.` also had no `e.repeat` guard,
   so holding the key key-repeated to unbounded gold/materials. The keyboard path is now gated
   behind `import.meta.env.DEV` (stripped from `npm run build` output); `window.NW`/`window.__nw`
   stay exposed in production either way (the documented live-tuning feature, and how the
   Gauntlet drives state — always by direct mutation, never a simulated keypress).
4. **Identity-probe honesty bug.** `network.ts`'s `pollIpInfo()` fired its periodic IP/geo
   refresh off real uptime alone, independent of whether the player had ever triggered the
   `explore` action — violating the documented privacy law ("scrying reveals who you are") and
   leaving the Lens UI claiming "unrevealed" after the data had already left the browser. Fixed:
   gated behind `identityFetched`.
5. Unsanitized third-party strings (ISP/city/country/ASN/colo from `ipapi.co`/Cloudflare trace)
   went straight into `innerHTML` in the Lens Identity section. Escaped.
6. Several regression tests were tautological (`ok(x.length >= 0, ...)`, `ok(Math.abs(...) >= 0,
   ...)`, trailing `ok(true, ...)` after real assertions) — the exact failure mode flagged twice
   before in this project's history. Rewrote to assert the actual claimed behavior (boss fight
   really kills, night wave really produces foes, death really scatters the player, long walk
   doesn't corrupt position to NaN).
7. **Confirmed NOT a bug:** the spam-click swing-restart DPS allowance in `combat.ts` is
   correctly rate-capped (`CFG.combat.restartMinIntervalSec`) and is documented, intentional,
   user-requested design (the "redaming" feature from S1) — no change made.

**Known, accepted limitation (not fixed, low stakes for a local single-player leaderboard):**
`everGod` only flips when god mode is toggled via the (now DEV-only) keyboard hotkey — a
sufficiently determined player editing `window.__nw.state.god` directly via devtools, or hand-
editing the `nw.leaderboard` localStorage key, could still bypass the flag. There's no backend to
enforce this against, same accepted tradeoff as `window.NW.CFG` being globally live-tweakable.

**G1-Painterly — Kuwahara oil-painting filter (2026-07-19):**
- `PainterlyPass` in `postprocess.ts`: Kuwahara filter (4-quadrant variance-minimizing mean)
  applied at 1/5 resolution for performance, then upscaled with linear interpolation
- Toggle: **V** key or `?painterly` URL param; runtime tweaks via `NW.painterly.{enabled, strength, radius}`
- Configurable: strength 0–1 (blend with original), radius 1–4 (brush-stroke size)
- Sits above vignette (z=70), below UI — HUD stays crisp
- Existing grain overlay (`renderer.ts`) complements the canvas-texture feel
- **Performance note:** Canvas2D Kuwahara at full-res is too slow for 60fps gameplay; this
  implementation processes at 1/5 res (~32K px) which is acceptable as a toggle-once "screenshot
  mode." A future WGSL port (WebGPU only) would make it real-time.
- Files: `postprocess.ts` (+162 lines), `main.ts` (+24 lines, V key + NW.painterly)

All systems implemented: C1 echoes, S1 survival pressure (vigor/resolve), U1 Lens UI unification,
U2 grimdark chrome, C2 waystones, C3 Loom passive tree (40 nodes + 4 keystones), C4 Armory
(5 boss relics, 12 silver/star items, 3 new mobs), C5 buildings rework (10 new towers, 4 roles,
LTD2-style upgrade paths), G1/G2 visual upgrade + juice, W6 scoreboards, N3 living network
(jitter→fire, realm→wind), **W7 soul-feeding (feed materials → soul-gear XP + affinity bonuses).**

### W7 — Soul-Feeding ✅ (2026-07-19)
- Consume inventory items to directly grant XP to soul-bound gear slots
- Materials: `xpValue` + `soulAffinity` fields on all 24 MaterialDefs (TS-only, not packed to Rust)
- Items: `soulXp` field on feedable items (ores, bars, herbs, charcoal, torch)
- Affinity system: matching affinity = 1.5× bonus, opposed = 0.5× penalty, neutral = 1.0×
- SoulFeedSystem: `feed()`, `canFeed()`, `affinityLabel()`
- UI: "feed" tag on feedable items in Bag, slot picker popup with affinity highlighting
- 4 Gauntlet tests: basic feed, affinity multipliers, level-up, non-feedable rejection
- Files: `materials.ts`, `items.ts`, `systems/soulfeed.ts` (NEW), `ui.ts`, `styles.ts`, `main.ts`, `regression.ts`

**X1 CONTENT BLITZ (2026-07-18, repaired same day by chief-of-staff review):** 15 new enemies
with data-driven behaviors (ranged w/ sim-clock projectiles, siege, exploder, buffer, healer,
summoner, swarm), wall upgrades (Stone Rampart; Iron Bulwark thorns), 3 traps (spike/tar/flame
— wired: damage/slow/ignite pulses in hordes), utility buildings (Workshop +30% craft xp in
radius, Granary +40% forage yield, Shrine +dmg/+range aura on towers, Signal Beacon = lesser
anchor extending the waystone chain), chain/poison/stun tower roles (arc jumps w/ falloff,
stacking DoT + Plague death-spread, Earthshaker freeze), elemental weapons + trinkets with 8
wired effect keys (fire/chill on hit, lifesteal, chain-on-kill, dodge, gold find, xp boost,
night vision), void_shard drops on 4 high-tier mobs. Review fixes: foe damage was reset to
`def.dmg` every tick (wiped ALL night/network/echo scaling — the game's difficulty curve was
silently flat); projectiles ran on `setTimeout` wall-clock (fired while paused) → sim-tick
Projectile array with spark trails; killed exploders paid no loot/xp; siege/support foes never
fought back in melee; summons now inherit the summoner's night scaling. CUT as designed-but-
unimplementable-today: bomb/repair/war-horn consumables (no use-item targeting hooks — items
that do nothing are worse than none), blessed_steel (dead-end material), biome hazards +
biome-exclusive spawn weighting (fields exist in biomes.ts but NO system consumes them yet —
do not describe them as live).

**X2 AUDIO (2026-07-18):** new `combat` mood, 5 per-boss moods keyed by lord id, death-whistle
SFX (30% on kill). **The X2 "grid subdivision" (4 features per tile at 16px subcells) was
REVERTED by the review:** it drew up to 4 full-size sprites clamped into one 32px tile — the
"dual-footed trees" — and its per-tile depletion silently killed up to 4 features per gather.
One feature per tile is the rule again.

**X3 MEGA FEATURES (2026-07-18, replaces the blitz's draft):** big SQUARE resources — a
feature row can carry `mega: {maxSize, chance}`; a deterministic root lottery merges a
size×size square (2–5 tiles) into ONE resource drawn as a single nearest-neighbor-upscaled
sprite (big visible pixel squares, grid-aligned, feet-anchored, y-sorted with normal
features, seam-free across chunk borders). Mega squares always block; harvest time scales
with the side, loot rolls with the area (a 4×4 tree = 16 loot rolls — jackpots); depleting
fells the whole square (mega stump). Trees (≤4), Ancient Oaks (≤5), stone/copper/iron rocks
(≤3), berry bushes (≤3). Worldgen `tileAt`/`megaClusterAt` are now memoized (the blitz draft
ran a 25-candidate scan with 4 fbm stacks per candidate inside EVERY passability check).

**X1.5 LENS (2026-07-18):** battery + JS-heap ACTUALLY harvested now (10s poll, no permission
prompts; Chrome-only APIs honestly labeled), wired to real consumers: Battery Scarcity →
gather yield, Charging Bonus → day regen, Veil Pressure (heap) → night-foe hp. Geolocation was
DROPPED, not shipped dark: it fires a browser permission prompt, the identity beacons already
show IP-level geo, and the Lens never asks for GPS (recorded in network.ts).

This roadmap is the source of truth for the current batch. Each milestone is built in its
own worktree (see `docs/plans/WORKFLOW.md`) and has a detailed brief `docs/plans/<id>-*.md`
when it becomes the active task.

## Non-negotiables (keep these true)
- **100% procgen** — no hosted image/audio assets; everything is generated from seed + params,
  including UI chrome (CSS-only Grimdark Chrome skin, no image/font dependencies — see U2).
- **Data-driven** — content is a row in `src/game/data/*`; systems are generic functions over one
  `GameState`. Adding content ≠ new engine code.
- Loose-mode TS + Vite + PixiJS v8 (WebGPU, `?gl` forces WebGL). Determinism from seed.
- `npm run typecheck` clean and `npm run build` green before any merge.
- **No persistence.** No save/load, no localStorage/IndexedDB state, no login/logout. The world
  exists only in the currently-open tab; closing/reloading/rebooting loses everything. This is
  *on-theme*: your network state is ephemeral — the world lives exactly as long as your
  connection does. Scoreboard carve-out: finished-run results may persist locally (outcomes,
  not state — a run can never be resumed).
- **Browser-native only.** No native binaries, no local agent, no Node.js backend. All data comes
  from browser APIs (`navigator.connection`, Performance API, `fetch()` timing, WebRTC, real
  clock). A local agent (`nightward-agent`) is a *future stretch goal* for data the browser
  can't see (real ICMP ping, WiFi dBm, ARP table) — but the game must be complete and fun
  without it. Graceful degradation: unsupported APIs → sensible fallback defaults.
- **Static deploy.** The game is a static Vite build with zero backend — GitHub Pages hosts it.
  No server-side network monitoring, no WebSocket relay. Everything runs in the browser.

## Core concept: "The Wire" (replaces "The Dream")
Your internet connection IS the game world. The procgen engine takes a seed as always — but
every live parameter (day/night cycle, resource rates, enemy spawns, terrain properties,
difficulty scaling) is driven by real-time browser network metrics. Two people on the same
seed get totally different worlds because their connections differ.

### Data-flow architecture

```mermaid
flowchart TB
    subgraph BrowserAPIs["Browser APIs (read-only, no permissions)"]
        NC["navigator.connection\n(RTT, downlink, type, effectiveType)"]
        PA["Performance API\n(page DNS, TLS, TTFB)"]
        FT["fetch() timing\n(endpoint latency probes)"]
        RC["Date.now()\n(real clock)"]
        WE["window online/offline\n(connectivity events)"]
        HW["navigator.hardwareConcurrency\nnavigator.deviceMemory"]
    end

    subgraph TSLayer["TypeScript layer (data-driven, live-tweakable)"]
        NS["NetworkSystem\n(poll, compute jitter, detect transitions)"]
        NET["window.NW.NET\n(live snapshot + mappings table)"]
        MAP["NetGameMapping[]\n(data rows: netKey → transform → target)"]
        SYS["Sim Systems\n(daynight, economy, hordes, rules)"]
        HUD["Info HUD\n(3-line readout, toggle I)"]
    end

    subgraph RustCore["Rust/wasm core (nightward-core)"]
        SNP["set_network_params(&[f32])\n(13-float flat-packed array)"]
        ACC["net_rtt(), net_downlink(), …\n(13 accessors, unused until N3)"]
        SIM["Sim engine\n(materials, fire CA, world state)"]
    end

    subgraph Render["PixiJS v8 render pipeline"]
        CHUNK["Chunk baker\n(dual-grid autotile)"]
        PP["Post-processing (G1)\n(bloom, AO, color grading)"]
        PART["Particle system (G1)\n(fire embers, slash trails)"]
    end

    BrowserAPIs -->|"polled at per-metric intervals"| NS
    NS -->|"updates every frame"| NET
    NET -->|"get(key) → transformed value"| MAP
    MAP -->|"multiply CFG fields"| SYS
    SYS -->|"read/write GameState"| SIM
    NS -->|"packForCore(): Float32Array"| SNP
    SNP --> ACC
    ACC -.->|"reserved for N3"| SIM
    SIM -->|"chunk data"| CHUNK
    CHUNK --> PP --> PART
    NET --> HUD
```

**Key data paths (every frame):**
1. `NetworkSystem.update(nowMs)` — polls slow metrics on their own intervals; snap is always current
2. `worldCore.pushNetworkParams()` — uploads 13-float snapshot to Rust (52 bytes/frame, O(1))
3. Sim systems read `net.get(key)` → transform → multiply CFG field (gold rate, sim speed, enemy scale)
4. Rust stores params but does NOT consume them until N3 (same pattern as `fire_params` in R1→R2)

**Key data paths (on transition):**
5. Connection type change → `detectTransitions()` → log event → (N2: rift event + visual flair)
6. Online/offline toggle → snapshot updated → sim pauses / new realm seed

### Why this architecture works
- **Zero new allocations per frame in the hot path.** `Float32Array` is allocated once and reused.
  `NetworkSnapshot` is a plain object mutated in-place — no GC pressure.
- **Rust crossing is O(1).** One `set_network_params` call per frame, same as `set_materials` and
  `set_fire_params`. No per-tile or per-entity network calls.
- **Mappings are data, not code.** The `NetGameMapping[]` table is editable at runtime via
  `NW.NET.mappings`. Adding a new mapping is a single row — no engine changes, no Rust rebuild.
- **Degradation is structural.** If a browser API is missing, the fallback value is the default
  mapping output. The game doesn't branch on "is this API available?" — it just reads values that
  happen to be constants in unsupported browsers.

**The design question:** does driving game parameters from network metrics produce interesting
emergent behavior, or just random noise? The answer depends on the mapping functions. The rule:
every network→game mapping must be **intuitive** (bad connection = harder in a way that makes
sense) and **legible** (the player can look at the HUD and understand WHY the world changed).

**Key insight — we are NOT building a physics engine.** The sim doesn't need rigid-body
dynamics. What it needs is a *parameterized behavior system* where network conditions drive
entity movement rules, spawn rates, and resource flows through the same data-driven machinery
that already exists (`CFG` + `pushMaterials()`/`pushFireParams()` + `window.NW.NET`).

### Network → Game mechanic mapping (design reference)

| Network Metric | Source API | Game Mechanic | Intuition |
|---------------|-----------|---------------|-----------|
| **RTT** (round-trip time) | `navigator.connection.rtt` + fetch timing | Global sim speed. High RTT = slow motion ("lag compensation as game mechanic"). | Bad internet = easier game (more time to react). Good internet = hard mode. |
| **Jitter** (RTT variance) | Computed from periodic fetch samples | Entity wobble / "instability field." Attack spread angle, position jitter. | Stable connection = precise combat. Jittery WiFi = chaotic fights. |
| **Downlink** (bandwidth Mbps) | `navigator.connection.downlink` | Resource regen rate. Gold tribute, HP regen, mana — all scale with downlink. | Fast internet = your territory thrives. Throttled = scarcity mode. |
| **`effectiveType`** | `navigator.connection.effectiveType` ('4g'/'3g'/'2g') | "World tier." 4g = normal. 3g = hard (less resources, tougher enemies). 2g = nightmare. | Your connection quality IS the difficulty setting. |
| **`type`** (connection technology) | `navigator.connection.type` (wifi/ethernet/cellular) | "Realm." Ethernet = stable/civilized. WiFi = wild. Cellular = chaos realm. Switching triggers a "rift" event (world reshuffles). | Moving from desk to coffee shop changes the game world. |
| **Online/offline transitions** | `window` online/offline events | The world ends and reforms. Offline = sim pauses. Coming back = new realm seed, new layout. | Toggling airplane mode = hard reset. |
| **`hardwareConcurrency`** | `navigator.hardwareConcurrency` (CPU cores) | Max simultaneous entities / chunk activation radius. | More cores = bigger world, more enemies. |
| **`deviceMemory`** | `navigator.deviceMemory` (RAM GB) | Inventory capacity / max buildings / soul gear slots. | More RAM = more stuff you can hold. |
| **Real clock** | `Date.now()` | Day/night cycle syncs to real local time. Night = hordes. | Play at 3am = deep night. Play at noon = safe daylight. |
| **Latency to endpoints** | `fetch()` timing to public endpoints (Cloudflare, Google, etc.) | "Distance to neighboring realms." How far the nearest data center is → biome type, trade routes. | Far from internet backbone = isolated realm with unique resources. |
| **DNS resolution time** | DoH fetch timing | "Scrying" skill — reveals map by resolving domains. Fast DNS = more map revealed. | DNS infrastructure becomes a game resource. |
| **Page load Performance API** | `performance.getEntriesByType('navigation')` | "Ancestral memory" — initial page load timing becomes permanent character stats for that run. | Every tab-open is a unique character born from that moment's network conditions. |

### Browser API availability matrix

Not all browsers expose the same network APIs. This matrix documents what's available where, and
what fallback the game uses when an API is missing.

| API | Chrome/Edge | Firefox | Safari | Fallback default | Degradation impact |
|-----|------------|---------|--------|------------------|-------------------|
| `navigator.connection.rtt` | ✅ | ❌ | ❌ | 50 ms | Sim speed = 1× (neutral) |
| `navigator.connection.downlink` | ✅ | ❌ | ❌ | 10 Mbps | Gold rate = 1× (neutral) |
| `navigator.connection.effectiveType` | ✅ | ❌ | ❌ | `'4g'` (tier 1) | Enemy scale = 1× (neutral) |
| `navigator.connection.type` | ✅ | ❌ | ❌ | `'ethernet'` (realm 0) | Stable realm |
| `navigator.hardwareConcurrency` | ✅ | ✅ | ✅ | 4 cores | Moderate world size |
| `navigator.deviceMemory` | ✅ | ❌ | ❌ | 4 GB | Moderate inventory |
| `navigator.onLine` | ✅ | ✅ | ✅ | `true` | Always-online mode |
| `window` online/offline events | ✅ | ✅ | ✅ | never fires | No transition events |
| `performance.getEntriesByType('navigation')` | ✅ | ✅ | ✅ | zeros | No ancestral memory bonuses |
| `fetch()` (for endpoint timing) | ✅ | ✅ | ✅ | 30 ms | Moderate endpoint latency |
| `Date.now()` | ✅ | ✅ | ✅ | — | Always works |

**Design principle for degradation:** every fallback default is the *neutral* value — the one that
produces a 1× multiplier or the "normal" game experience. This means unsupported browsers get a
playable, balanced default game. Supported browsers get the live network-driven experience. No
player is ever locked out.

### What we CANNOT get from a browser (deferred to optional local agent)
- Raw packet capture (pcap), ARP table, LAN device enumeration, port scanning, firewall rules,
  WiFi signal strength (dBm), ICMP ping, process list, active services, DNS cache.
- These require OS-level privileges not exposed to JavaScript. A future `nightward-agent`
  (tiny Rust binary, `ws://localhost:9734`) could expose them — but the game must ship complete
  without it.

## Architectural decisions (carried forward + new)
- **360° animation — SHIPPED THEN REVERTED (2026-07-07).** 4-direction baked frames are the
  baseline. Do not rebuild the rig unless explicitly asked.
- **Weighty combat** — `windup → active(hit-window) → recovery` state machine. Spin/channel
  deferred.
- **Soul Gear** — soul-bound gear with leveling. Materials stay stackable counts.
- **Sound** — WebAudio synth, data-driven SFX recipe table.
- **Event log** — ring-buffer bus + UI panel + `window.__nw.log`.
- **"Tiles ×4" (SUBPIX)** — decouple art-resolution from the 32px sim tile. Prototype ×2/×4
  on a single chunk first, get verdict, THEN migrate the pipeline.
- **No persistence, ever.** Tab-is-the-character. On-theme: your network state is ephemeral.
- **Two-language rule** (carried forward): Rust is generic machinery only (sim engine). ALL
  content, balance, AND network→game mappings stay in TS data rows. Adding a network metric
  mapping must NEVER require touching Rust.
- **Boundary style** (carried forward): batch APIs, zero-copy typed-array views, O(1) per-frame
  crossings. Network metrics upload into the core exactly like `pushMaterials()` /
  `pushFireParams()` already do — one flat-packed `Float32Array` per frame, never per-tile calls.
- **Network params are CFG-tier:** `window.NW.NET` is live-tweakable at runtime, same as
  `NW.CFG` and `NW.MATS`. Every network→game mapping is a data row, not engine code.
- **No "dream realm" / "wire realm" split.** The wire IS the world. The old dream-world flavor
  text is replaced. When network data is unavailable (unsupported browser, offline), the game
  runs on sensible fallback defaults — "local loopback mode" — which is still a playable game,
  just a static one.

## Batch 5 success criteria (how we know we're done)

These are the exit gates for the entire Network batch — the conditions that must be true
before we consider Batch 5 shipped and move on to whatever comes next.

### Primary criteria (must-pass)
1. **The network hook is legible.** A new player can look at the HUD, see "RTT 45ms | WiFi 4g,"
   and understand that their connection is affecting the game. The cause→effect chain is visible.
2. **Different connections = different experiences.** Ethernet (stable, fast sim, normal difficulty)
   vs. throttled 3g (slow sim, hard enemies, scarce resources) vs. offline (static defaults) are
   all playable AND feel distinct. Verified by playing the same `?seed=` on different networks.
3. **Graceful degradation works.** Firefox and Safari produce the same playable game as Chrome —
   just without the live network variance. No errors, no missing UI, no NaN/undefined anywhere.
4. **All existing systems still work.** Gathering, crafting, building, combat, hordes, fire,
   soul gear — the pre-N1 game loop is intact. Network params are multipliers, not replacements.
5. **Live-tuning convention holds.** `window.NW.NET.mappings` is editable at runtime and changes
   take effect next sim tick, same as `NW.CFG` and `NW.MATS`. No reload needed.

### Secondary criteria (should-pass)
6. **The "why" is interesting.** Watching RTT spike (jitter field activates, enemies wobble)
   is more engaging than a static world. The network metrics produce *stories* — "my WiFi
   dropped to 2g and suddenly the horde was 2× size" is a memorable moment.
7. **Visual quality meets the bar.** Post-G1/G2, the game looks significantly better than the
   current `v0.15.1` build. "Better" is defined by the user's playtest verdict — there is no
   objective metric for pixel art.
8. **No performance regression.** With network polling + SUBPIX rendering + post-processing +
   particles, the game still holds 60fps on a mid-range laptop (integrated GPU, 8GB RAM).
   WebGL fallback (`?gl`) must also hold 30fps.

### Stretch criteria (nice-to-have)
9. **The local agent (A1) proves the concept.** A tiny Rust binary serving `ws://localhost:9734`
   with real ICMP ping + WiFi dBm. The game detects it and upgrades its data resolution. This
   validates the two-tier architecture (browser-only baseline + optional native agent) without
   making the agent a dependency.

## Design hypotheses (what we're testing with this batch)

Each hypothesis is falsifiable — if it turns out wrong, we adjust the design rather than
pushing through.

| # | Hypothesis | Test method | Falsification signal |
|---|-----------|-------------|---------------------|
| H1 | Network metrics produce more interesting emergent behavior than pure random seeds | Play same seed on Ethernet vs. throttled 3g; compare experiences | Both feel same-ish → network data is just noise |
| H2 | "Bad connection = easier but weirder" is a fun tradeoff, not a frustration | Playtest on intentionally bad connection; ask: "was this fun?" | Player prefers to disable network features → mapping is wrong |
| H3 | Real-time clock sync makes the day/night cycle feel more grounded | Play at different times of day; ask: "does this matter to you?" | Player doesn't notice or care → revert to fixed day length |
| H4 | Connection-type "rift" events (N2) create memorable moments, not annoying resets | Trigger a type switch mid-session; observe reaction | Player says "that's annoying" → rifts need to be opt-in or rarer |
| H5 | SUBPIX ×2/×4 + post-processing pushes the look from "lil survival game" to something the player is proud to show | Side-by-side screenshot comparison + user verdict | Player can't tell the difference → SUBPIPX isn't worth the complexity |

**When a hypothesis fails:** don't ship that feature. The batch is modular — N1, N2, G1, G2, N3
are independent enough that a failed hypothesis in one doesn't block the others. Remove the
failing mapping/feature, document the lesson, move on.

## Risk register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| `navigator.connection` is removed or restricted by browsers (it's a Chrome-only API with privacy concerns) | Medium | High — core data source gone | Fallback defaults already designed; `fetch()` timing is universal and can replace RTT estimation |
| Network polling causes perceptible jank (fetch() blocking, GC from snapshots) | Low | Medium | Polling is async + low-frequency (1–10s intervals); snap is mutated in-place; verify with profiler in N1 |
| SUBPIX rendering tanks performance (4× tiles = 16× pixels per chunk) | Medium | High — could make G1 unshippable | Prototype gate BEFORE full migration; fall back to ×2 or skip SUBPIX entirely if perf budget blown |
| The "network = world" metaphor doesn't land — players just see random difficulty changes | Medium | High — the whole concept fails | HUD legibility is the defense; if the mapping isn't visible, it's not working. Iterate on HUD + toast messages in N2 |
| WebGPU not available on target hardware (older laptops, some Linux configs) | Medium | Medium | PixiJS v8 already has WebGL fallback (`?gl`); post-processing degrades gracefully (skip bloom/AO, keep basic rendering) |
| Rust/wasm boundary becomes a bottleneck (52 bytes/frame is trivial, but future params could grow) | Low | Low | Current 13-float layout is fixed; if we need more params, use the same `pushMaterials` stride pattern — one upload, not per-entity |
| OneDrive sync corrupts git worktrees (known issue from Batch 4) | Medium | Low — annoying but recoverable | Worktrees live outside OneDrive if possible; `git worktree prune` + `rm -rf` recover; documented in WORKFLOW.md gotchas |

## Performance budget (per frame, target: 16.67ms @ 60fps)

This budget covers the full Batch 5 stack (N1 + N2 + G1 + G2 + N3). Individual milestones
have tighter budgets in their briefs.

| Pipeline stage | Budget (ms) | Notes |
|---------------|-------------|-------|
| Network polling (amortized) | <0.1 | Async fetch() doesn't block; sync polls are field reads |
| `pushNetworkParams()` (Rust crossing) | <0.05 | 52-byte Float32Array copy, O(1) |
| Sim tick (Rust CA + TS systems) | <2.0 | Existing budget from R2; network multipliers are float ops |
| Chunk baking (SUBPIX ×2/×4) | <4.0 | Target: bake 4 chunks/frame max; LOD for distant chunks |
| Post-processing (bloom, AO, grading) | <2.0 | Single full-screen pass; skip AO on WebGL fallback |
| Particle system | <1.5 | Capped at 500 active particles; recycle pool |
| Entity rendering + UI | <2.0 | Existing budget; HUD is text, negligible |
| **Total target** | **<12.0** | Leaves ~4.5ms headroom for spikes + GC |
| WebGL fallback target | **<28.0** | 30fps floor; skip bloom + AO + reduce particles to 200 |

**Profiling discipline:** after every milestone merge, run a 60-second profiled session at
`?seed=1234` with the Chrome Performance tab. If any stage exceeds its budget by >50%, that
becomes the top-priority fix before starting the next milestone.

## Expanded milestone specifications

Each milestone below includes: **dependencies** (what must be merged first), **entry criteria**
(what must be true to start), **exit criteria** (what must be true to merge), **estimated effort**
(rough, for sequencing), **sub-task breakdown** (implementation order), and **risks specific to
that milestone**.

### Milestone dependency graph

```mermaid
flowchart LR
    M3.5["M3.5 — Action-Gated\nNetwork Discovery"] --> M3.6["M3.6 — Attack Speed\n← Probe RTT"]
    M3.6 --> N1["N1 — Network Seed\n(data plumbing)"]
    M3.6 --> N2["N2 — Wire Realm\n(content + theming)"]
    M3.6 --> G1["G1 — Visual Upgrade\n(SUBPIX + post-processing)"]
    N2 --> W6["W6 — Scoreboards\n(breather milestone)"]
    G1 --> G2["G2 — Juice Pass\n(feel + feedback)"]
    N2 --> N3["N3 — Living Network\n(sim integration)"]
    G2 --> N3
    N3 --> A1["A1 — Local Agent\n(stretch, optional)"]
```

M3.5/M3.6 are the new roots — the network discovery system and attack→RTT feedback loop
must be solid before the broader N-batch work begins. They prove the core mechanic: your
connection isn't just background data, it's something you *feel* when you swing. N2 and G1
are parallelizable after M3.6 (content vs. visuals touch different files).

---

## Shipped milestones (historical record — all complete)

### Batch 1–2: Core game (M0–M3)
- **M0 — Walkable world** ✅: infinite seeded overworld, noise biomes, chunk-baked rendering,
  procgen tiles/trees/hero, camera follow, keyboard + touch input.
- **M1 — Skilling & crafting** ✅: gatherable nodes, inventory with equip slots, tools, RS-style
  per-skill leveling, 3 crafting professions, day/night cycle with ambient tint.
- **M2 — The racket** ✅: buildings (hall/hut/wall/tower), placement rules, territory score,
  population, passive tribute income.
- **M3 — Night hordes** ✅: wave spawner scaling with night # + territory value, enemies march on
  hall / chew buildings / bite player, watchtower auto-fire, player arc-melee, armor, death &
  respawn, game over.

### Batch 3: Content & feel (W0–W4.6)
- **W0** ✅ `v0.5-w0`: Foundations & fixes — build-menu input-trap fix, auto-connecting walls,
  event log, data-driven SFX table.
- **W1** ✅ `v0.6-w1-player`, then **reverted**: 360° rig animator — disliked the look, back to
  4-direction baked frames.
- **W2** ✅ `v0.7-w2-soulgear`: Soul Gear — soul-bound weapon/armor/tools with per-slot leveling.
- **W3** ✅ `v0.8-w3-combat`: Weighty combat — `windup → active → recovery` state machine;
  foe telegraph tells.
- **W4** ✅ `v0.9-w4-dayhunts`: Day hunts & balance pass — daytime prey mobs, night retune,
  ×10 xp curves.
- **Fix batches** ✅ `v0.9.1–v0.9.3`: melee aim fix, build placement rework, god mode + logging.
- **W4.5** ✅ `v0.10-w4.5-rpgui`: Pixel UI skin — RPGUI bundled, Press Start 2P font.
- **W4.6** ✅ `v0.11-trinkets`: Trinket gear slots — ring, amulet, charm; danger pass retune.

### Batch 4: The World Engine (R0–R2) — COMPLETE
- **R0** ✅ `v0.12-r0-spike`: Rust toolchain + wasm — `ping()`, zero-copy checkerboard,
  `window.__nw.core`, Vite + deploy.yml integration.
- **R1** ✅ `v0.13-r1-writable-world`: Writable world — 16 materials, sparse override store,
  chunk-slot pool, god brush, speed-from-material, feature-kill rule.
- **R1.5** ✅ `v0.14-r15-painted-world`: Painted World — dual-grid autotile, pseudo-3D cliff
  ledges, contact shadows, animated shoreline foam, material legibility re-ramp, toast fix.
  Playtest gate: user verdict on the look **recorded 2026-07-16 — "needs to look better"**.
- **R2** ✅ `v0.15-r2-fire` + `v0.15.1-r2-fire-fix`: Fire — per-chunk CA (fuel/burn/wet fields),
  wind-driven spread, burnout→override, burn damage, fire glow overlay, firemaking skill,
  campfires, charcoal. Playtest gate: user verdict recorded — fire mechanics work but the
  game still reads as "a lil survival 2D game."

### N1 — Network Seed ✅ `v0.16-n1-network-seed` (2026-07-16)
- Network data plumbing: `NetworkSystem` polls `navigator.connection`, `fetch()` timing,
  `Date.now()`, Performance API — every metric wrapped in fallback defaults
- `NW.NET` exposed at console — live-tweakable snapshot + 13 metric mappings + 5 game mappings
- Rust core: `set_network_params(&[f32])` + 13 accessors + 3 unit tests (23/23 pass)
- Real clock day/night sync (snap on first tick, smooth-lerp 0.5%/tick thereafter)
- Sim speed from RTT (lag compensation), gold rate from downlink, enemy scale from connection tier
- Network info HUD (`F1` toggle): RTT, downlink, connection type, sim×, gold×, enemies×
- Network floaters (WoW-style): floating metric numbers when gathering, gold ticks
- Harvest duration linked to network latency (RTT → gather speed)
- Connection transition logging (debounced 5s stability window)

### Session enhancements (2026-07-16, continued)

- **M1 — Mobile responsiveness** ✅: Dynamic UI scaling via CSS custom properties (`--scale`),
  touch-device detection (`data-touch` / `data-narrow`), icon/label button split for legibility,
  `dvh` viewport height support, font-size floors (`max()` guards). Full brief: `docs/plans/M1-mobile.md`.
- **Regression test suite** ✅: 19 automated tests exercising every game system from the inside
  via `window.__nw`. Run via `?test` URL param or `__nw.regression.run()`. Covers: boot state,
  inventory, world queries, gathering, crafting, building, combat, day/night, damage, god mode,
  equipment, fire, log, XP/leveling. Source: `src/game/systems/regression.ts`.
- **Bag tab navigation fix** ✅: Empty equipment slots no longer trap Tab focus — `focusNext()`
  filters to `tabIndex >= 0` elements only, with a focus-landing guard.
- **M2 — Combat Feel & Network Observatory** ✅ (2026-07-16):
  - **M2.1 — Combat XP floaters:** "+X combat xp" toast on kill, same style as gather XP toasts.
    Makes the existing combat XP system visible. File: `src/game/systems/hordes.ts`.
  - **M2.2 — Combat skill mechanical effect:** Combat level now grants +1 base damage per 5
    combat levels (configurable via `CFG.combat.dmgBonusPerLevel`). Combat skill finally matters!
    Files: `src/game/systems/combat.ts`, `src/game/data/config.ts`.
  - **M2.3 — Network Observatory panel:** New panel toggled with **O** key. Live sparklines
    (canvas-drawn) for RTT, jitter, bandwidth over last 60s. Realm card with biome name &
    stability %. Active modifiers with trend arrows. Files: `src/game/systems/network.ts`,
    `src/main.ts`.
  - **M2.4 — Balance alignment map:** Documented expected player power curve at nights 1/5/10/20.
    Identified and fixed Copper Blade gap (weaponDmg 4→6). Deferred: Iron-tier crafting weapon
    and enemy HP growth cap to M3.
  - Full brief: `docs/plans/M2-combat-network.md`.

- **M3 — Danger & Gold Economy** ✅ (2026-07-16):
  - **Gold = Danger:** Horde size scales with gold hoarded (`CFG.horde.goldThreshold` +
    `goldMultPerThreshold`). At 600+ gold, world-boss-type enemies can appear in night waves.
  - **Gold rouses bosses:** Bosses wake when gold exceeds `worldBoss.wakeGold` (350), regardless
    of territory score. The network senses your wealth.
  - **Gold generation:** Economy tribute logs bandwidth/RTT context. Jitter spikes (>25ms) generate
    bonus "packet scatter" gold. Files: `economy.ts`, `hordes.ts`.
  - **Gold spending — Scatter Cache:** Press **Shift+G** to spend 18% of current gold (min 60) to
    reduce incoming horde by 45%. File: `hordes.ts` → `scatterCache()`.
  - **Network metrics in every log entry:** Combat kills, horde spawns, gather actions, and
    economy ticks all include RTT/bandwidth/jitter context in the log. Every game event is
    traceable to a network metric. Files: `combat.ts`, `hordes.ts`, `gather.ts`, `economy.ts`.
  - **Observatory legibility:** Big-number readouts with explicit units (milliseconds, Mbps),
    danger level indicator showing gold-driven threat (Calm→BOSS), and clearer sparkline layout.
    File: `main.ts`.

- **M3.5 — Action-Gated Network Discovery** ✅ (2026-07-16):
  - **Pool-based endpoint discovery:** Replaced passive 30s auto-polling of all 14 global
    endpoints with action-gated pools. Each action category randomly picks from its themed
    pool. Attack pool: 6 endpoints (Yandex, Naver, Baidu, Yahoo JP, Cloudflare, Microsoft).
    Gather/build/craft/damage/economy/explore/survive_night each have 3–6 endpoint pools.
  - **Only attacks make HTTP requests:** `fetch()` probes fire exclusively from the attack
    action. All other actions sample passive browser APIs (zero HTTP requests).
  - **Observatory shows discovery progress:** Discovered endpoints show flag + RTT bar.
    Undiscovered show 🔒 `???` with endpoint descriptions. Network map fills in as you play.
  - Full brief: `docs/plans/M3.5-action-network.md`. Files: `network.ts` (data + system),
    `gather.ts`, `combat.ts`, `build.ts`, `crafting.ts`, `economy.ts`, `main.ts`.

- **M3.6v2 — Sync RTT → Damage + Resonance Crits** ✅ (2026-07-16, SHIPPED):
  - **DEVIATION from original M3.6:** The original M3.6 brief described attack-speed
    modulation from async probe RTT. During implementation, this felt "wonky" — the async
    probe fed back to the NEXT swing, not the current one, and speed changes were too subtle.
    **M3.6v2 replaces attack-speed modulation with:**
  - **Sync damage multiplier:** `navigator.connection.rtt` → immediate damage multiplier
    (≤20ms→1.4×, 20-40ms→1.2×, 40-80ms→1.05×, 80-200ms→1.0×, 200-400ms→0.85×, >400ms→0.7×).
    Later rebased to beacon-echo latency in N1.5-F4.
  - **Resonance crits:** Attack probe resolving <30ms during windup → 1.5× bonus
    (later gated behind route warmth in N1.5-F3).
  - **Attack volley:** Every swing fires 1 echo (was 3); full volley throttled to 1/1.5s
    (N1.5-F3).
  - **Observatory** shows ⚔ Damage Mod row with sync RTT + multiplier + resonance label.
  - Recorded here so the roadmap reflects what actually shipped.

---

## Batch 5 — The Wire (N-batch: Network-driven world) — ACTIVE (2026-07-16)

User verdict on the current state (2026-07-16): "it's just a lil survival 2D game. You can
build a house which attracts bosses, can't really see beyond that." The core loop exists but
lacks a hook that makes it *interesting to look at and think about*. The answer: **replace the
dream-world theming entirely with live network metrics as the world's driving force.**

This is not a "network hacking sim." It's a world simulator where your internet connection
IS the physics. The Rust/wasm core (R0–R2) already has the machinery: live-uploadable params
(`pushMaterials`, `pushFireParams`), a writable world with per-tile overrides, a cellular
automaton, and an event system. Network metrics are just another data feed into the same
pipes — `window.NW.NET` alongside `NW.CFG` and `NW.MATS`.

**The design bet:** driving game parameters from real network conditions produces more
interesting emergent behavior than pure random seeds, because network conditions are
*structured* (geography, time of day, ISP routing, WiFi vs. Ethernet) and *personal*
(your connection is different from everyone else's). Two players on the same world seed
get totally different experiences — and that's the point.

### Non-negotiables (this batch)
- **Browser-native network data only.** `navigator.connection`, Performance API, `fetch()`
  timing, `Date.now()`, WebRTC (local IP discovery). No native binaries — the game ships
  as a static site on GitHub Pages. A local agent is a documented stretch goal (A1), not a
  dependency.
- **Graceful degradation.** Every network metric has a documented fallback default. If
  `navigator.connection` is unavailable (Firefox), the game runs in "local loopback mode"
  with sensible static defaults — still a playable game, just not live-driven.
- **Network→game mappings are data rows.** `src/game/data/network.ts` is the single table.
  Adding a new metric mapping is a row edit, never engine code. The mappings are live-
  tweakable at runtime via `window.NW.NET`.
- **No privacy leak.** No data leaves the browser except the implicit IP in HTTP requests
  to the listed public endpoints (ipify.org, ipapi.co, cloudflare.com, and the favicon/CDN
  endpoints in action echo pools); nothing is stored server-side. Identity probes (IP, city,
  ISP, ASN) are gated behind the first `explore` action. A full endpoint disclosure is
  logged to the browser console at boot and documented in README.md.
- **Two-language rule stands.** Rust never sees network metrics directly — TS polls, packs
  into a `Float32Array`, and uploads via `core.set_network_params()` (same pattern as
  `set_materials` / `set_fire_params`).

### Re-sequencing the queue
- **Old W5–W8 and R3–R5 are shelved** (see "Shelved" section below). They were designed for
  a dream-world survival RPG — the network pivot changes what's worth building.
- **Old W5 (zoom/LOD)** is folded into G2 (SUBPIX + post-processing) since both touch the
  render pipeline.
- **W6 (scoreboards)** stays as an independent breather milestone, re-themed as "connection
  age" leaderboards.
- **G1 (graphics upgrade)** runs early — the user explicitly asked for better visuals
  ("Legion TD 2 level" is the aspiration; realistic target is high-quality 2D with post-
  processing, see the G1 brief).
- **A1 (local agent)** is the last milestone — a stretch goal that only matters once the
  browser-only experience is shipped and fun.

### Brief convention (this batch)
N-briefs follow the same implementation-grade standard as the R-briefs: exact file contents/
contracts, Acceptance checklist at the bottom, single-eval verification at `?seed=`. G-briefs
(visual) include a **prototype-first gate**: bake 2–3 representative samples, get the user's
verdict, THEN build the full pipeline — the W1 lesson applied to art.

### Milestones (one worktree each, in order)

> **Note (2026-07-16):** Early G1 (particles, postprocess) and early N2 (biomes, rift plumbing)
> are already in the tree as part of the N1-batch checkpoint (tagged `v0.16-n1-network-seed`).
> G1's remaining scope is bloom/LUT/SUBPIX-prototype/drop-shadows. N2's remaining scope is
> N2a (theming + rifts + realm HUD) and N2b (material effect hooks — real engine work).

---

#### M3.6v2 — Sync RTT → Damage + Resonance Crits ✅ SHIPPED (2026-07-16)

> **Brief:** `docs/plans/M3.5-action-network.md` (bottom section, recorded as M3.6v2)

**Shipped as M3.6v2 — sync damage multiplier + resonance crits instead of attack-speed
modulation. See deviation note in "Shipped milestones" above. Post-N1.5 cleanup applied
(F1–F9, tagged `v0.16.1-n15-ground-truth`).**

---

#### N1 — Network Seed (the data plumbing)

> **Brief:** `docs/plans/N1-network-seed.md`

**Dependencies:** none (builds on `v0.15.1-r2-fire-fix` baseline).

**Entry criteria:**
- `v0.15.1-r2-fire-fix` merged and tagged
- `npm run typecheck` clean, `npm run build` green, `cargo test` passing on main

**Exit criteria:**
- All 12 acceptance checklist items pass at `?seed=1234`
- `window.NW.NET` is live-tweakable (edit a mapping → next sim tick reflects it)
- HUD readout toggles with `I` key, shows RTT/downlink/connection type + sim/gold/enemy multipliers
- Day/night syncs to real clock (when enabled — toggled via `NW.NET.mappings` entry)
- Sim speed, gold rate, enemy scale all respond to network data within 1 sim tick
- Offline mode runs with fallback defaults — no errors, playable game
- Firefox (no `navigator.connection`) runs identically to Chrome with defaults — no errors
- `cargo test` passes (core accepts `set_network_params`, accessors return defaults)

**Estimated effort:** 2–3 sessions.

**Sub-tasks (implementation order):**
1. Create `src/game/data/network.ts` — `NetworkSnapshot`, `NetMapping`, `NetGameMapping` interfaces + `NET_METRICS` (13 metric rows) + `NET_GAME_MAP` (6 system mapping rows)
2. Create `src/game/systems/network.ts` — `NetworkSystem` class: constructor (fresh snapshot with fallbacks), `update(nowMs)` (poll cycle), `pollConnection()`, `pollEndpoint()`, `computeJitter()` (rolling window of 30 RTT samples, mean absolute deviation), `detectTransitions()` (debounced — don't fire on sub-second flaps), `get(key)`, `packForCore()` (13-float layout)
3. Add `set_network_params(&[f32])` to Rust `Core` + `net_params: Vec<f32>` field + 13 accessor methods (`net_rtt()`, `net_downlink()`, etc.) — all return `f32`, all have fallback defaults
4. Add `pushNetworkParams()` passthrough to `WorldCore` (`src/game/world/core.ts`)
5. Wire into `main.ts`: construct `NetworkSystem` after system init, expose `NW.NET`, call `net.update(nowMs)` + `worldCore.pushNetworkParams()` in render loop, apply game mappings in sim step
6. Add 3-line info HUD in `src/game/ui/ui.ts` — Press Start 2P at 8px, top-left, toggle with `I` key, shows RTT/downlink/type line + multipliers line
7. Wire sim systems: `daynight.ts` (real clock sync), `economy.ts` (gold rate × downlink mapping), `hordes.ts` (enemy scale × effectiveType mapping), `rules.ts` or sim loop (sim speed × RTT mapping), `log.ts` (new `'network'` LogKind for transitions)
8. Static verify: `npm run wasm` + `npm run typecheck` + `npm run build` green, `cargo test` green
9. Live verify all 12 checklist items, fix forward on main, tag `v0.16-n1-network-seed`

**Per-milestone risks:**
- `fetch()` to `cloudflare.com/cdn-cgi/trace` may be blocked by corporate proxies or ad-blockers → fallback endpoint list (also try `google.com/generate_204`, `azure.com`); if ALL fail, endpointLatency stays at fallback (30ms)
- `navigator.connection` may return `0` for RTT on some Chrome versions → treat 0 as "unknown," use fallback
- Jitter computation on first few frames (not enough samples) → return fallback (5ms) until ≥3 samples accumulated
- Real clock sync may feel weird if player expects fixed day length → make the `timeOfDay` mapping toggleable (set `transform` to return constant for fixed cycle)

---

> ## Direction update (2026-07-16, evening — supersedes the queue order below)
>
> N2a SHIPPED (`v0.17-n2a-veil-lens` + hotfixes; verified scrub-clean, known gaps recorded
> in `docs/plans/P1-platform-hardening.md`). User's direction after shipping:
>
> 1. **Scaling is the joy.** Feel-polish gates are RELAXED until the content batch exists —
>    we are "playing a level-1 character over and over." Content pillars (design session
>    with the user required before briefing): Vampire-Survivors-style abilities from boss
>    kills, PoE-like passive tree, Terraria-like gear tiers, **Legion TD 2-style building
>    variety** (current buildings verdict: "shit" — full rework, our own art style).
>    Endgame fantasy: a vast map covered in buildings. ⚠️ Reality check recorded: the map
>    IS infinite (worldgen pure fn of tile+seed) but `CFG.build.maxDistFromHall = 18` caps
>    building sprawl — the content batch needs a territory-extension mechanic (outposts /
>    waystones) to honor that endgame.
> 2. **D5 (recorded):** outcome modifiers widen to ~0.3–1.5× with damage as a per-swing
>    ROLL (PoE-lightning feel, width scales with flux); time-feel modifiers (simSpeed,
>    moveSpeed) deliberately stay tight — wide swings there read as lag (D4 rationale).
> 3. **QA is the answer to shipped-with-gaps:** the Gauntlet (behavioral suite — fights a
>    boss, fights each mob, walks into stuff, exercises every recipe/building/feature) +
>    a definition-of-done rule in WORKFLOW.md.
> 4. **Painterly look:** investigate a classical-painting filter over the pixel art
>    (Kuwahara-style oil-paint pass in `postprocess.ts` + canvas grain/LUT) — lives under
>    G1's prototype-first gate: 2–3 baked samples for the user's verdict BEFORE any pipeline.
>
> **P1 SHIPPED + VERIFIED (2026-07-16, `v0.18-p1-platform`):** N2a gaps closed (cold-route
> inversion, real moveSpeed/xpRate mappings, Lens inspect mode, styled feed), D5 lightning
> bands live (per-swing seeded damage roll 0.30–1.50), the Gauntlet (34 behavioral tests) +
> definition-of-done rule in WORKFLOW.md. One post-ship catch: the first `testMobBirthStats`
> was a tautology — rewritten same day to exercise the real birth path (`4915909`).
>
> **Queue now: Batch C "The Character" — taste verdicts IN (quiz 2026-07-16, see
> `C-batch-quiz.md`): fixed signature echoes · Loom points from nights survived ·
> all 4 keystones v1 · waystone loss = full collapse-decay · Cinder Trail ignites the
> REAL fire CA day one · C1 first. Order: C1 echoes → C2 waystones → C3 loom →
> C4 armory → G1-P painterly prototype verdict → C5 buildings rework.
> N2b/G1-remainder slot in where they fit.**
>
> **❗ C1 PLAYTEST VERDICT (2026-07-17):** C1 echoes built + verified on branch `c1-echoes`
> (37/37 Gauntlet, 165 assertions, static trio green). Live playtest revealed a PRE-EXISTING
> crash (resonance crit floater referenced `ctx.camera` instead of `ctx.cam` — fixed,
> `ca60e70`). More critically, the playtest exposed a missing design pillar: **survival
> pressure.** The user walled in their hall with 7 walls (260 HP each), survived 3 nights
> with zero threats, and had no reason to fight, hunt, or expand. The game has no teeth.
>
> **NEW PRIORITY — S1 "Survival Pressure" inserted BEFORE C2:**
> The C-batch builds progression systems (echoes, passives, gear, buildings) — but
> progression needs a PROBLEM to solve. S1 creates that problem: two survival stats
> (Vigor + Resolve) that decay and must be restored by hunting, killing, building, and
> surviving nights; a 10× horde rebalance making nights genuinely dangerous; walls that
> actually break. Brief: `docs/plans/S1-survival-pressure.md`.
>
> **✅ S1 SHIPPED (2026-07-17, branch `s1-survival`):** VitalsSystem, horde/dayspawn
> rebalance, foeDmgToBuildings, night-RTT stability tracker, all 9 vitals NET_GAME_MAP
> rows wired (non-dormant), HUD chips, vital floaters, 6 new Gauntlet tests (44/44 green).
> Combat: attack() now restarts swing on windup/active click (spam-click = rapid DPS).
>
> **Revised order: C1 (echoes) → S1 (survival pressure) → C2 (waystones) → C3 (loom)
> → C4 (armory) → G1-P (painterly verdict) → C5 (buildings rework).**
>
> **🔍 C1 PLAYTEST — LENS VERDICT & UI DIRECTION (2026-07-17, same session):**
> The user loves the Lens (observatory, O key): "i love the lens. it is AWESOME!"
> Two UI directives from this:
>
> 1. **The popup info menu goes offscreen** — the RPGUI-styled panels (Bag/Craft/Skills/Log)
>    have no viewport clamping and overflow on small/narrow viewports. The Lens handles
>    this correctly (centered, scrollable, viewport-unit-bounded). Fix: apply the same
>    clamping to all panels.
> 2. **Replace RPGUI with Lens aesthetic** — "the lens' ui is pretty good, we could
>    probably start the ui update by just replacing the rest of the rpgui stuff with the
>    lens' ui." The dark, clean, technical Lens style (monospace fonts, subtle 1px borders,
>    dark translucent backgrounds, no pixel-art chrome) becomes the universal UI skin.
>    This supersedes W4.5 (pixel UI skin plan). New milestone: **U1 — Lens UI Unification**
>    (`docs/plans/U1-lens-ui-unification.md`).
>
> **Revised order: C1 (echoes) ✅ → S1 (survival pressure) ✅ → U1 (lens UI
> unification) ✅ → U2 (grimdark chrome) ✅ → C2 (waystones) ✅ → C3 (loom) ✅
> → C4 (armory) ✅ → G1-P (particles/post-proc/juice) ✅ → C5 (buildings rework) ✅
> → W6 (scoreboards) ✅ → N3 (living network) ✅**
>
> **ALL MILESTONES SHIPPED (2026-07-18, bulk session).** **✅ VERIFIED 2026-07-18:**
> typecheck clean, build green (779 modules, 5.42s), Gauntlet **ALL 1161 TESTS PASSED**
> (62 functions, 4703ms, 0 page errors). Two worldgen-dependent skips only (`testGathering`,
> `testFireIgnite` — no feature/flammable tile near spawn on seed 1234). Smoke test clean:
> game boots, renders, gathers, enters night cycle without JS errors.
>
> **Rationale for U1 before C2:** S1 adds vital chips to the HUD — they should debut in
> the new style. C2–C5 all add new panels (Loom tree, Armory slots, Buildings upgrade UI)
> — they should be authored against the final look. U1 is small (~1 session) and won't
> delay the content batch.
>
> **🪓 ANIMATIONS / MINING / LUMBERJACKING (2026-07-17):** User asked if animations,
> mining, and lumberjacking are planned. Status:
> - The W1 360° parametric character rig was SHIPPED THEN REVERTED (user disliked the
>   look). Current baseline is 4-direction baked frames.
> - Combat has windup→active→recovery phase visuals (W3: tint/scale/slash/desaturate on
>   the existing sprite). Spin attack deferred.
> - Mining, Woodcutting, Foraging (renamed in N2a from network jargon) all use the generic
>   gather progress bar — no per-skill animation exists.
> - **Action-specific animations (mining swing, lumberjack chop, foraging kneel, etc.)
>   are a future "Action Feel" milestone** — not in the current batch. They should land
>   AFTER the UI is unified (U1) and combat feel is solid (S1 horde rebalance), and
>   probably after G1 (particles can enhance them). Candidate slot: between C4 and G1-P,
>   or as part of G2 (Juice Pass). Not scheduled yet — needs user priority call.
>
> **🧰 EVENING REVIEW (2026-07-17, chief-of-staff session, on `c1-echoes`):** the day's
> commits reviewed and repaired. (1) The crash fix `ca60e70` is correct and complete —
> no other `ctx.camera` references exist. (2) **Three of the six S1 stub mapping rows
> were dead or wrong** (effectiveType tier off-by-one → 4g players got ×1.5 resolve
> decay; `echoJitter` and `hardwareConcurrency` aren't metric keys → rows frozen at
> ×1.4/×0.7): fixed, `echoJitter` promoted to a real NET_METRICS row (`Echo Flux`),
> three more vitals rows added (gather/campfire/night), all nine tagged `dormant` and
> rendered dimmed in the Lens THREADS until S1 wires them. New Gauntlet test #38
> (`testNetMapIntegrity`) pins all of it. (3) The user's "popup goes offscreen" repro
> traced to the **Lens inspect box**, not the RPGUI panels — fixed with real-size
> viewport clamping; U1 brief corrected. Full record: S1/U1 briefs' review sections.
>
> **🔁 VERIFICATION PASS (2026-07-17, later same session):** the above batch was re-run
> headlessly (raw-CDP Chrome + vite, `?gl&seed=1234&test`) and ground-truthed. All the
> S1/inspect-box/crash claims hold; `testNetMapIntegrity` passes. **(4) One pre-existing
> Gauntlet failure surfaced — NOT caused by this batch** (confirmed by stashing the
> working tree: it also fails on committed HEAD): `testGathering`'s step budget
> `ceil(need·30)+10` assumed gather progress advances at raw `dt`, but it advances at
> `effectiveDt = dt·simSpeed`, and `need` already folds `simSpeed` in — so real
> frames-to-complete scale ~`need·30/simSpeed`. Under live `rtt≈100ms → simSpeed 0.85`
> the budget fell exactly **one frame short** (need 2.07 → budget 73, actual 74). The
> overnight run passed only because its live `rtt` gave `simSpeed≈1`. Fixed: the test now
> steps-until-clear with a `need`-scaled cap (robust to any clamped `simSpeed`). Suite is
> green again: **200 assertions / 38 functions, 0 page errors, deterministic**.
> **(5) FLAG FOR USER (balance, not fixed):** that bug exposed that `simSpeed` is applied
> to **gather twice** — once in `need` (gather.ts `speed *= getGameValue('simSpeed')`,
> the N1 line) and again via the universal `effectiveDt`. Gather is the *only* gameplay
> system that double-applies it (combat/hordes/fire/echoes each apply `effectiveDt`
> only), so gather time is uniquely ~`1/simSpeed²` sensitive to lag. Likely an
> unintended overlap from threading `effectiveDt` through `gather.update` after N1 added
> the gather-specific term — but removing N1's line changes gather feel, so it's the
> user's call (see `docs/plans/S1-survival-pressure.md` review record for options).
> **→ RESOLVED (user chose option b, 2026-07-17):** dropped the N1 gather line; gather
> now scales `1/simSpeed` like everything else. Verified `need` 2.07→1.76 & frames
> 74→63 at simSpeed 0.85; suite green (200/38). Own commit.
>
> **✅ U1 SHIPPED (2026-07-18, branch `u1-lens-ui`):** styles.ts fully rewritten to the
> Lens aesthetic — rpgui + Press Start 2P gone (dependency removed from package.json and
> lockfile), flat dark chrome, mono stack, system cursors; M1 machinery and all DOM IDs
> preserved; Lens observatory verified byte-identical in computed style. Zero gameplay
> files touched.
>
> **🔍 U1 REVIEW (2026-07-18, chief-of-staff session):** the implementer's shipped claim
> — "Gauntlet 42/45, 3 pre-existing hidden-tab failures in spawn/gather/equip,
> documented in WORKFLOW.md" — was **false** (second milestone in a row with fabricated
> test evidence; no such failures are documented, none reproduce). Headless re-run
> (raw-CDP, `document.hidden === false`): 44/45 — the single real failure was
> `testVitalsHUD`, a **frame-timing race in the test** (chip text is written by
> `ui.refresh()` in `render()`/rAF, not by `__nw.step()`; a stray frame at an `await`
> boundary in `testVitalsRestore` painted a transient 50). Not a U1 regression — the U1
> diff is CSS-only. Fixed: the test forces `nw.ui.refresh()` before reading. Final:
> **ALL 228 ASSERTIONS / 45 FUNCTIONS PASSED, 0 page errors**; static trio green
> (typecheck, build post-rpgui-removal, cargo 23/23); acceptance evidence re-gathered
> via CDP probes incl. 320×400 fit. Full record: U1 brief's shipped section.
>
> **✅ MERGE (2026-07-18):** the chain `c1-echoes` → `s1-survival` → `u1-lens-ui`
> merged to `main` (`cb040a1`) and pushed after user sign-off; static trio re-verified
> post-merge (typecheck clean, build 775 modules, cargo 23/23).
>
> **🎨 U2 DIRECTION — GRIMDARK CHROME (2026-07-18, user verdict on the merged U1
> look):** stripping RPGUI exposed that the flat Lens chrome reads as dev tooling,
> not a game — "meh. looks kinda shitty tbh… maybe a poe/diablo like frame could work
> better? smaller buttons? … current ui's gotta go, the rpgui stuff was hiding how
> shitty it actually is currently lol." New milestone: **U2 — Grimdark Chrome**
> (`docs/plans/U2-grimdark-chrome.md`): keep U1's architecture (one stylesheet, CSS
> vars, no assets), swap the aesthetic — warm iron near-black surfaces, brass
> box-shadow-ring plaque frames + corner brackets, blood-gradient HP, serif
> small-caps display type over a sans body (mono retires to the Lens), and the
> action bar compacted to Diablo-style 44px icon sockets with corner keybind tags
> (labels → title/aria tooltips). All pure CSS gradients/shadows — the
> no-hosted-assets rule is back to full strength. **The Lens stays exempt**
> (diegetic instrument; ground-truthed: its styles are hard-coded in `main.ts`,
> zero CSS-var coupling). Slot: **U2 before C2**, same rationale as U1 — C2–C5
> panels should be authored against the final look. Handoff:
> `docs/plans/HANDOFF-U2-deepseek.md` (now with a raw-evidence hard gate: full
> Gauntlet console output pasted or the claim counts as no evidence; the review
> pass re-runs headlessly via CDP regardless).
>
> **✅ SHIPPED (2026-07-18, `u2-grimdark`):** full styles.ts rewrite (235+/116−)
> + 3-line ui.ts edit. warm iron (#14100b) palette, brass plaque frames (stacked
> inset box-shadow rings, corner brackets, fading gold headers), serif display
> type over sans body, Diablo 38−44px action sockets, blood-gradient HP with
> gloss line, `.res-abbr`→`.net-abbr` dead-selector fix. Static trio green
> (typecheck/build/cargo 23/23). Gauntlet: **ALL 228 TESTS PASSED (4089ms).**
> All 15 acceptance items verified via DOM probes. Awaiting user audit + merge.

---

## 🚀 BULK IMPLEMENTATION — "SPEED AND POWER" (2026-07-18)

User requested full-speed implementation of all remaining milestones in one session.
All systems built spec-first, data-driven, with zero testing (per user instruction:
"don't bother testing, just build the specs"). Testing/debugging loop deferred to
a subsequent session.

### C2 — Waystones ✅
- New `waystone` building (400 HP, iron/stone/copper cost, 8 territory)
- Placement validation: within range of hall OR any waystone (chain)
- Disconnect decay: destroying a waystone cascades — disconnected buildings lose 8 HP/s
- New waystone reconnects decaying buildings in range
- `World.inRangeOfAnchor()`, `World.findDisconnected()`
- `BuildSystem.updateDecay()`, `BuildSystem.markDisconnected()`
- Files: `buildings.ts`, `build.ts`, `world.ts`, `hordes.ts`, `main.ts`

### C3 — The Loom ✅
- 36 small nodes × 3 branches (War/Field/Ward) + 4 keystones
- `data/loom.ts`: `LoomNode[]`, `LoomModifiers`, `computeModifiers()`
- `systems/loom.ts`: `LoomSystem` — allocate, canAllocate, ensureMods
- Keystones: Glass Echo (top-half D5, half HP), Deep Roots (+50% building HP, -12% speed),
  Night Market (+40% gold, halved boss wake gold), Long Thread (+1 pt/4 total levels, skills cap 80)
- Points from nights survived (1/night) + Long Thread bonus
- Modifiers applied to: combat (dmg/arc/swing speed), economy (territory income),
  gather (speed/double yield), move speed, D5 roll floor
- Files: `data/loom.ts`, `systems/loom.ts`, `state.ts`, `main.ts`, `combat.ts`,
  `economy.ts`, `gather.ts`, `rules.ts`

### C4 — The Armory ✅
- `ItemDef.effects: string[]` — data-driven behavior hooks
- `systems/effects.ts` — `EffectFn` registry: thorns_reflect, fire_aura, chill_aura,
  regen_boost, move_burst_on_kill, see_foe_hp, resonance_boost
- 5 boss relics (1 per lord, 100% drop): Bramble Heart, Ember Core, Frost Shard,
  Ebb Pendant, Hollow Eye
- New `player.relic` 6th equip slot (separate from Equip object)
- 3 new mobs: Spitter (night 4), Burrower (night 6), Tower-Hunter (night 8)
- Silver & Star-Metal tiers: 2 new ores, bars, weapons, armor, trinkets (12 new items)
- 12 new crafting recipes (silver/star tiers, smithing 20–35)
- Files: `items.ts`, `effects.ts`, `enemies.ts`, `recipes.ts`, `rules.ts`, `state.ts`

### G1/G2 — Visual Upgrade & Juice ✅ (extended)
- Screen shake: `Camera.shake()` already existed; now called on player hits (3px) and
  resonance crits (5px)
- Particles: `ParticleSystem` with 9 particle kinds (poof, ember, slash, spark, wisp,
  rift, death, heal, crit) — spawned from combat, gather, build, fire, rifts
- Post-processing: `BloomPass` (additive glow from fire/torches/beacons),
  color grading via biome + time-of-day tint overlay, vignette via `Fog`
- Tower roles handled in combat (splash/slow/sniper/aura targeting and effects)
- Files: `camera.ts`, `combat.ts`, `particles.ts`, `postprocess.ts`, `fog.ts`

### W6 — Scoreboards ✅
- `ScoreboardSystem`: tracks connection uptime, realm tally, peak RTT, lowest downlink,
  kills, buildings, rifts
- `RunScorecard` snapshot on death with 13 fields
- Death screen enhanced: shows connection age, nights, kills, buildings, gold, realm,
  rifts, peak RTT, lowest bandwidth, loom points
- `localStorage` leaderboard: top 50 runs by connection age
- `formatAge()` helper for human-readable uptime
- Files: `systems/scoreboard.ts`, `ui.ts`, `main.ts`

### C5 — Buildings Rework ✅
- 10 new tower types with LTD2-style upgrade paths (Watchtower → A/B → ultimate)
- Tower roles: splash (Emberkiln→Inferno/Forge), slow (Frostspire→Glacier/Hail),
  sniper (Longeye→Eagle/Deadeye), aura (Warbanner)
- Splash: 50% AoE damage in 2-tile radius; fire towers ignite ground
- Slow: 40% move speed debuff for 2s
- Sniper: targets highest-HP foe; Deadeye executes below 30% HP
- Aura: +20% damage, +1 range to nearby towers
- Files: `buildings.ts`, `combat.ts`, `hordes.ts`

### N3 — Living Network ✅
- Jitter → fire spread: `spreadMul = 1 + jitter/50` (clamped 3× max)
- Realm → wind: Cellular Chaos 2×, WiFi Wilds 1.2×, Ethernet/other 1×
- Fire params re-pushed every 2 sim-seconds with network multipliers
- `WorldCore.pushFireParams()` now accepts optional `{spreadMul, windMul}`
- Files: `core.ts`, `main.ts`, `config.ts`

### Files touched (total): 20+
`buildings.ts`, `build.ts`, `world.ts`, `hordes.ts`, `combat.ts`, `main.ts`,
`state.ts`, `config.ts`, `items.ts`, `enemies.ts`, `recipes.ts`, `rules.ts`,
`styles.ts`, `ui.ts`, `camera.ts`, `core.ts`, `data/loom.ts` (NEW),
`systems/loom.ts` (NEW), `systems/effects.ts` (NEW), `systems/scoreboard.ts` (NEW),
`data/echoes.ts`, `systems/echoes.ts`, `systems/vitals.ts`,
`systems/network.ts`, `systems/economy.ts`, `systems/gather.ts`,
`engine/particles.ts`, `engine/postprocess.ts`

---

#### N2 — split: N2a "The Veil & the Lens" ✅ SHIPPED (2026-07-16, `v0.17-n2a-veil-lens`) + N2b (material hooks)

> **N2a brief (ACTIVE, NEXT MILESTONE):** `docs/plans/N2a-veil-and-lens.md` — written
> 2026-07-16 from the user's playtest verdict on `v0.16.1-n15-ground-truth`. **Supersedes the
> theming direction in `N2-wire-realm.md`** (which put network terminology INTO the fiction —
> the verdict inverts that). N2b (material effect hooks) stays in `N2-wire-realm.md`,
> unscheduled, own playtest gate.

**Playtest verdict (2026-07-16):** network jargon leaked into the fiction (zone names, boss
toasts, skills, buildings, the death screen) and must be scrubbed to pure fantasy — while ALL
raw data (per-URL latency, bandwidth, IP/geo/ISP, device info) gets a real home in the O-key
observatory. The variables keep driving the game (naming conventions, mob hp/damage/defense/
specials derived from the operation that spawned them, move/gather/xp modifiers) but are never
*named* in fiction. Two-layer law: **the Veil** (fiction) / **the Lens** (truth panel) /
invisible bridge. Includes Lens **inspect mode** — highlight any row → SOURCE (browser API) /
ACTION (game action that drives it) / FLOWS INTO (game values it feeds).

**Parked idea (2026-07-16, user):** "network monitoring automation" as gameplay — e.g.
buildings that auto-probe routes on a schedule, threshold alerts that fire game events (build
your own monitoring dashboard out of base-building). Candidate for a post-N2a slice or N3
flavor; not scheduled, needs its own brief.

**D1 update:** Rift trigger = realm-profile change (beacon-echo median+variance band crossing,
debounced ≥30s), not connection.type. Realms derived from echo profile, not connection type.
Connection.type switches (Android only) are a bonus path.

**D3 update:** Material/skill/building rename tables (Wood→"Copper Packet" etc.) are DROPPED.
Flavor is mystical resonance; the physical world stays physical. The network theme lives in
the overlay systems: Pulse/Flow/Flux, beacons, echoes, rifts, realms, resonance crits.

**Note:** The N2 brief's claim that material `onEnter/onStay/onExit` hooks are "existing R1
infrastructure" is FALSE. R1 materials have static props like `speedMult` — active hooks do
not exist and require real engine work (N2b scope).
- Rift events on WiFi (which can flap between `wifi` and `unknown`) could fire too frequently → 30s debounce is essential; also ignore `unknown`→`wifi` transitions (only fire on actual type changes between known types)
- Material properties with `onStay` hooks could be expensive if checked every tick for every entity → only check when entity moves to a new tile; cache the material at entity's current position

---

#### G1 — Visual Upgrade (SUBPIX + post-processing)

> **Brief:** `docs/plans/G1-visual-upgrade.md` (to be created)

**Dependencies:** N1 merged (needs the HUD baseline — post-processing must not break it). Can run
in parallel with N2 (touches different files: renderer vs. content).

**Entry criteria:**
- N1 merged and tagged (`v0.16-n1-network-seed`)
- Current render pipeline understood and profiled (where does chunk baking spend its time?)
- Prototype environment ready: ability to render a single chunk at ×1, ×2, and ×4 side-by-side

**Exit criteria:**
- **Prototype gate passed:** user has seen ×1/×2/×4 side-by-side comparison screenshots and given
  a verdict on which SUBPIX factor to use (or whether to skip SUBPIX entirely)
- Chunk baker migrated to the chosen SUBPIX factor (unless skipped): tile sprites rendered at
  higher resolution, dual-grid autotile rules applied at the sub-pixel level, contact shadows
  and cliff ledges scaled accordingly
- WebGPU post-processing pipeline: **bloom** (threshold-based — fire glow, torches, tower beacons,
  soul gear crits; Gaussian blur at 2 scales, additive blend), **ambient occlusion** (cheap SSAO
  from `heightClass` — not a full depth pass, just darken tiles adjacent to higher-height-class
  tiles), **color grading** (3D LUT — 16×16×16 identity LUT with network-condition-driven tint
  shifts: warm for Ethernet, cool for WiFi, harsh for Cellular), **vignette** (darken screen
  edges at night, intensify during low-bandwidth or offline)
- Particle system: `ParticleContainer` with pool of 500 reusable particles. Particle types:
  gather poof (brown dust, 8 particles), fire ember (orange, upward drift, 4 particles/sec from
  burning tiles), slash trail (white arc, 12 particles along swing path), build spark (yellow,
  6 particles on construction complete), night wisp (blue, slow drift, spawns during night near
  player). Each particle: position, velocity, lifetime, color, alpha, scale — updated CPU-side
  (not GPU), rendered as tinted 4×4 sprite
- Entity directional drop shadows: replace current contact-blob approach with a dark 50%-opacity
  ellipse offset 2px opposite the light source (light source = top-left for daytime, center for
  night). Shadows rendered in a dedicated `Container` below the entity layer
- All post-processing degrades gracefully under `?gl` (WebGL fallback): skip bloom, skip AO,
  keep color grading (via tinted overlay instead of LUT shader), keep vignette, keep particles
  (but cap at 200), keep drop shadows
- Performance: 60fps on mid-range hardware with WebGPU; 30fps on WebGL fallback

**Estimated effort:** 4–5 sessions (largest milestone in the batch).

**Sub-tasks (implementation order):**
1. **Prototype:** bake ONE chunk at ×2 and ×4. Render the same viewport at ×1 (current), ×2, and ×4
   side-by-side. Take screenshots. Get user verdict. **Do not proceed past this step without
   explicit approval.** If SUBPIX is rejected, skip to step 4 (post-processing only).
2. **SUBPIX migration (if approved):** update `ChunkBaker` to render tiles at the chosen scale
   factor. Update dual-grid autotile rules (adjacency checks still at sim-tile resolution, but
   output sprites are scaled). Update contact shadow rendering. Update cliff ledge rendering.
   Verify tile legibility at the new resolution — if individual tiles become hard to distinguish,
   scale back. Profile chunk bake time at the new resolution; if >4ms per chunk, implement LOD
   (distant chunks baked at 1×, near chunks at chosen SUBPIX factor).
3. **Post-processing setup:** create `src/engine/postprocess.ts` — `PostProcessPipeline` class.
   Bloom: render fire/torch/beacon layer to a separate render texture, apply two-pass Gaussian
   blur (horizontal then vertical, 9-tap kernel), composite additively over main scene. AO:
   sample neighboring tile `heightClass` values in a 1-tile radius, darken tile by 0–15% based
   on neighbor height difference. Color grading: apply 3D LUT as a full-screen shader (identity
   LUT at boot, tint-adjusted per network conditions). Vignette: multiply by radial gradient
   (center-bright, edges-dark).
4. **Particle system:** create `src/engine/particles.ts` — `ParticlePool` class with `spawn(type, x, y, count)` and `update(dt)`. Each particle type has a `ParticleDef` (lifetime range, velocity range, color, alpha curve, scale curve). Pool allocates 500 particles upfront (never grows). `spawn()` finds inactive particles and initializes them. `update()` steps position + lifetime + alpha, deactivates expired particles. Rendered as `ParticleContainer` with tinted sprites.
5. **Directional drop shadows:** update `src/game/world/art.ts` — `drawShadow(entity, lightDir)`. For each entity, render a dark ellipse at `entity.pos + shadowOffset` where `shadowOffset` is opposite `lightDir`. Shadow container sits below entity container in the display list.
6. **Integration:** wire post-processing after chunk render but before UI. Wire particle spawns into system hooks (gather complete → poof, fire ignite → embers, combat hit → slash trail, building placed → sparks, night tick → wisps). Wire drop shadows into entity render loop.
7. **WebGL fallback:** detect WebGPU support at boot. If unavailable (or `?gl` flag), disable bloom, disable AO, replace LUT shader with tinted overlay, cap particles at 200, keep vignette and shadows.
8. **Performance profiling:** 60-second session at `?seed=1234`, Chrome Performance tab, verify all pipeline stages within budget. If any stage exceeds budget by >50%, optimize before merge.
9. **Playtest gate:** user verdict on the visual upgrade. Is the game no longer "just a lil survival 2D game"? Can they see the difference? This is a hard gate — if the visual upgrade doesn't land, we need to understand why before proceeding to G2.

**Per-milestone risks:**
- SUBPIX ×4 makes tiles unrecognizable (too much detail obscures the game grid) → prototype gate catches this early; fall back to ×2 or skip
- Post-processing on WebGL fallback looks bad (tinted overlay is a poor substitute for LUT) → acceptable; WebGL users are on older hardware and expect degradation
- Particle pool too small for intense scenes (boss fight + fire + multiple rifts) → cap at 500 with priority system: embers > slash trails > wisps > poofs > sparks; if pool exhausted, oldest low-priority particle is recycled
- Bloom on integrated GPU may be expensive (two-pass blur on full render texture) → reduce blur kernel to 5-tap, reduce render texture to half-resolution, or skip bloom in the "low" quality preset

---

#### W6 — Lifespan & Scoreboards (breather milestone)

**Dependencies:** N2 merged (needs the re-themed terminology for scoreboard labels).

**Entry criteria:**
- N2 merged and tagged
- Network theming is coherent (biomes, material names, log messages all use network terminology)

**Exit criteria:**
- HUD shows "connection uptime" (elapsed wall-clock since tab opened) in the info readout —
  formatted as `12h 34m 56s`
- Death screen (game over) shows a **run scorecard**:
  - Connection age (how long the run lasted)
  - Dominant connection type (ethernet/wifi/cellular — whichever had the most uptime)
  - Rifts survived (count of connection-type transitions)
  - Peak RTT / lowest downlink (network "low points" survived)
  - Buildings constructed, enemies killed, soul gear leveled
  - Final realm (the biome at time of death)
- Local leaderboard stored in `localStorage`: top 10 runs by connection age. Each entry:
  scorecard summary (the same fields as the death screen). Displayed on the title screen as
  a scrollable list
- Leaderboard data format is forward-compatible with a remote backend (each entry is a JSON
  blob with a version field — `v: 1`). No remote backend is built in W6 — this is purely
  about shaping the record format so a remote one slots in later
- Leaderboard respects the no-persistence rule: run STATE is never saved (no resume), but
  run OUTCOMES (the scorecard) may be persisted. Clear distinction: scorecard = historical
  record, not game state

**Estimated effort:** 1 session (breather — intentionally scoped small).

**Sub-tasks (implementation order):**
1. Add `connectionUptime` to `GameState` — increments by real dt each frame (not sim dt). Survives
   death (reset only on page reload — the tab-is-the-character rule).
2. Death screen: on game-over, capture a `RunScorecard` snapshot from current state + network
   history. Render as a styled panel (RPGUI frame, Press Start 2P font, scrollable if content
   overflows).
3. Network history tracking: `NetworkSystem` accumulates a ring buffer of `{timestamp, type,
   rtt, downlink}` entries (one per significant change — type switch, RTT spike >2×, downlink
   drop >50%). Used to compute "dominant connection type" and "peak/low" stats on death.
4. Local leaderboard: `localStorage.setItem('nw.leaderboard', JSON.stringify(entries))`. Read on
   title screen, display top 10. Entries are `RunScorecard[]` with a max of 50 stored (prune
   shortest runs when exceeding 50).
5. Title screen integration: add "Leaderboard" tab/section below the start button. Shows
   connection age, dominant realm, date of run.
6. Verify: play a run, die, check death screen fields are populated. Reload page, check
   leaderboard persists. Play another run, check leaderboard updates.

**Per-milestone risks:**
- `localStorage` quota exceeded (5–10MB typical) → 50 entries × ~500 bytes = ~25KB, well within
  limits. If quota is somehow hit, prune to 25 entries.
- Privacy: `localStorage` data never leaves the browser. The scorecard contains no PII — just
  connection type names and numeric stats. Document this in the scorecard UI.

---

#### G2 — Juice Pass (feel + feedback)

> **Brief:** `docs/plans/G2-juice-pass.md` (to be created)

**Dependencies:** G1 merged (post-processing pipeline must exist — juice builds on it). N2
merged (network theming needed for ambient effects).

**Entry criteria:**
- G1 merged and tagged
- N2 merged and tagged
- Post-processing pipeline, particle system, and drop shadows are functional

**Exit criteria:**
- **Screen shake:** configurable per-event (heavy hit: 3px amplitude, 100ms; boss stomp: 8px,
  300ms; building collapse: 5px, 200ms). Camera offset applied in render, not sim — doesn't
  affect gameplay. Shake decays exponentially over duration. Multiple shakes compose (max
  amplitude clamped at 12px to prevent nausea).
- **Hit-stop:** on impactful hits (player crit, boss hit, building destroyed), freeze the render
  for 50–100ms. Sim continues during freeze — only the camera/render is paused. Hit-stop
  queue: if a second hit-stop triggers during an active one, extend by the longer duration
  (don't stack).
- **Entity knockback:** on melee hit, push the hit entity away from the attacker by 1–2 tiles
  over 150ms (smooth lerp). Knockback is cosmetic — the entity's sim position snaps to the
  final tile immediately, but the render position animates. Only applies to entities that
  can be knocked back (enemies, not buildings or stationary nodes).
- **Attack trails:** procgen slash arcs — on melee swing, spawn a fading arc sprite (white→transparent,
  200ms) along the swing path. Arc shape is a quadratic bezier (start→mid→end) derived from
  the attack direction + a slight random offset for variety. Rendered in the particle container
  as a stretched/tinted 8×8 sprite.
- **Building damage states:** buildings at 50% HP show cracked-wall overlay (tint toward gray,
  add crack sprite — 2 variations, chosen deterministically from building position). At 25%
  HP: add fire/smoke particles (embers, 1/sec). At 0 HP: collapse animation (particle burst
  + screen shake + building sprite fades out over 500ms).
- **Day→night transition:** not an instant tint change — twilight shader ramp over 5 real-world
  seconds. The ambient tint lerps from day→night palette. Fire/torch glow intensity increases
  inversely. Night wisps begin spawning. Transition trigger: when `dayPhase` crosses the
  dusk threshold (configurable, default ~0.75 = 6pm in real-clock mode).
- **Sound polish:** add 10+ new SFX recipe rows: rift tear (low rumble + white noise burst),
  jitter spike (glitchy stutter), connection drop (descending tone), packet-loss zone enter
  (muffled filter on ambient), bandwidth bloom (harmonic chime), hit-stop (brief silence +
  bass hit), building crack (wood/stone crunch), day→night transition (slow chord shift).
  Add "network hum" — a low continuous synth tone (sine wave, ~60Hz) whose pitch tracks RTT
  (higher RTT = lower pitch). Hum is subtle (10% volume), can be toggled in settings.
- All juice effects respect a **"juice level" setting** (0 = none, 1 = minimal (no shake/hit-stop),
  2 = full). Default is 2. Setting persisted in `localStorage` (this is a preference, not game
  state — consistent with the no-persistence rule's carve-out for non-state UI preferences).

**Estimated effort:** 2–3 sessions.

**Sub-tasks (implementation order):**
1. Screen shake system: `Camera.shake(amplitude, durationMs)`. Shake state: current offset,
   remaining duration, amplitude. Updated each render frame (not sim frame). Multiple shakes
   compose by tracking max amplitude per axis. Rendered as a translate on the stage container.
2. Hit-stop system: `HitStop.trigger(durationMs)`. Freeze the render timestamp for the duration —
   `requestAnimationFrame` still fires, but the render pass checks `hitStop.active` and skips
   scene update (only UI updates during hit-stop). Sim continues unaffected.
3. Knockback animation: entity renderer stores `knockbackTarget` (world position) and
   `knockbackRemaining` (ms). Each render frame, lerp render position toward target. When
   remaining reaches 0, snap to sim position. Cosmetic-only: the entity's sim position is
   never modified by knockback animation.
4. Attack trails: on `combat.ts` swing event, emit a `{type: 'swing', origin, direction, weapon}`
   event. Trail renderer spawns a bezier arc particle: compute start (attacker pos), end
   (target pos + overshoot), mid (perpendicular offset × weapon weight). Arc rendered as
   8×8 sprite stretched along bezier path, 200ms lifetime.
5. Building damage states: update `world/art.ts` building renderer. Check `building.hp / building.maxHp`.
   At ≤50%: apply gray tint + crack overlay (deterministic from `(building.x * 31 + building.y * 17) % 2`).
   At ≤25%: add ember particles. At 0: trigger collapse sequence.
6. Twilight transition: update `daynight.ts` to emit `'dusk-start'` and `'dawn-start'` events
   when crossing thresholds. Renderer listens and applies a 5-second lerp on the ambient tint
   uniform + fire glow intensity.
7. Sound: add SFX rows to `src/game/data/config.ts` SFX table. Implement network hum in
   `src/engine/audio.ts` — a `OscillatorNode` (sine, ~60Hz base) + `GainNode` (0.1 volume).
   Pitch bends via `frequency.linearRampToValueAtTarget()` each frame based on `net.snap.rtt`.
8. Juice level setting: add to `NW.CFG` (or new `NW.SETTINGS`). Read at boot from `localStorage`.
   Systems check juice level before triggering effects. HUD toggle in settings panel (future
   UI task — for G2, set via console: `NW.CFG.juiceLevel = 0`).
9. Playtest gate: user verdict on feel. Are the effects satisfying? Is screen shake nauseating?
   Is hit-stop disorienting? Adjust amplitude/duration/levels based on feedback.

**Per-milestone risks:**
- Screen shake may cause motion sickness → juice level setting is the escape hatch; default
  amplitudes are conservative (3px for hits, 8px max)
- Hit-stop may feel like a bug (game freezing) → ensure the HUD continues updating during
  hit-stop so the player knows the game is still running. Hit-stop duration is capped at 150ms
  (never longer than a blink)
- Knockback animation desyncs if entity moves again before knockback completes → if a new
  knockback triggers, overwrite the previous (don't stack). Snap to sim position on new knockback
- Network hum may be annoying → very low volume (10%), toggleable, and the pitch range is
  constrained (40–200Hz, never enters piercing territory)

---

#### N3 — The Living Network (sim integration)

> **Brief:** `docs/plans/N3-living-network.md` (to be created)

**Dependencies:** N2 merged (realm theming needed for biome-driven sim params). G2 merged
(visual juice for network-driven CA effects). All previous milestones merged — N3 is the
capstone.

**Entry criteria:**
- N2, G1, W6, G2 all merged and tagged
- Rust core has `net_params` field + 13 accessors (from N1 — reserved for N3)
- Fire CA, wetness system, and wind system are functional (from R2)
- Particle system and post-processing are functional (from G1)

**Exit criteria:**
- **Jitter → fire spread:** fire CA spread probability is multiplied by `1 + (jitter / 50)`.
  High jitter = fire spreads more erratically (more rolls, but also more burnout). The "feel":
  on WiFi, fires are unpredictable — they might fizzle or explode. On Ethernet, fires are
  steady and controllable.
- **Bandwidth → wetness diffusion:** the rate at which wetness spreads to neighboring tiles is
  scaled by `downlink / 10`. High bandwidth = water flows faster. Low bandwidth = water pools
  and stagnates. (Requires R4's wetness spread to be implemented — if not, this mapping is
  deferred and documented.)
- **Connection type → wind:** wind strength is set by realm: Ethernet = calm (0.2×), WiFi =
  variable (0.5–1.5×, sinusoid over time), Cellular = gusty (1.5× with ±0.5 jitter). Wind
  direction changes on rift events. Fire spread direction is wind-biased.
- **Packet loss → dead zones:** when jitter > 50ms AND endpoint latency > 100ms, tiles within
  a radius of the player have a chance (jitter/200 per tick) of becoming "dead zones" — sim
  skips these tiles for one tick (no fire spread, no wetness diffusion, no entity movement).
  Visually: dead-zone tiles flicker with a glitch particle. Dead zones clear when network
  conditions improve.
- **Data storm weather event:** when jitter > 80ms AND packet loss (dead zones) affects >10%
  of active chunks, a "data storm" triggers. Visual: screen-wide particle storm (200+ particles,
  harsh color palette), ambient tint shifts to harsh blue/white, all entities take 1 damage
  per second (minor — storm is an atmospheric threat, not a killer). Storm ends when jitter
  drops below 40ms for 10 consecutive seconds.
- All network→CA mappings are data rows in `src/game/data/network.ts` (new `NetCAMapping`
  interface), editable at runtime via `NW.NET.caMappings`. No hardcoded mappings in Rust —
  the mapping values are uploaded as part of the network params pack and read by the CA
  systems as config.
- Rust `fire_step()` and (if implemented) `wetness_step()` read from `self.net_params` via
  the accessors. The accessors return the TS-uploaded values (not hardcoded defaults). All
  existing R2 fire tests still pass (network params default to neutral values that don't
  change fire behavior).
- Visual feedback for all CA changes: fire spread acceleration → ember particle burst;
  wetness pooling → blue particle drip; dead zone → glitch flicker; data storm → full-screen
  particle storm. All using the G1/G2 particle + post-processing pipeline.

**Estimated effort:** 2–3 sessions.

**Sub-tasks (implementation order):**
1. Data: add `NetCAMapping` interface + `NET_CA_MAP` table to `src/game/data/network.ts`.
   Each mapping: `netKey`, `caTarget` (fireSpread, wetnessRate, windStrength, deadZoneThreshold,
   stormThreshold), `transform` function. Upload CA mappings to core via an extended
   `packForCore()` that appends CA params after the 13 base fields.
2. Rust: extend `net_params` layout from 13 to ~20 floats (add fireSpreadMul, wetnessRateMul,
   windStrength, deadZoneThreshold, stormThreshold at the end). Update `set_network_params()`
   to accept the longer array (backward-compatible — if only 13 floats sent, CA params default
   to neutral). Add accessors: `net_fire_spread_mul()`, `net_wetness_rate_mul()`,
   `net_wind_strength()`, `net_dead_zone_threshold()`, `net_storm_threshold()`.
3. Rust: update `fire_step()` to read `self.net_fire_spread_mul()` and multiply spread
   probability. Update wind to read `self.net_wind_strength()`. These are one-line
   multiplications — the CA algorithm doesn't change, just its parameterization.
4. TS: update `packForCore()` in `NetworkSystem` to pack 13 base + N CA params. Update
   `WorldCore.pushNetworkParams()` to use the new length.
5. TS: implement dead zone logic in `NetworkSystem` — each tick, check jitter + endpoint
   latency against thresholds. If exceeded, compute dead-zone tiles (random subset of active
   chunks, weighted by jitter). Push dead-zone list to core (as a new `set_dead_zones()`
   method — a list of chunk indices + tile offsets, or skip if the overhead is too high
   and keep dead zones purely TS-side).
6. TS: implement data storm detection in `NetworkSystem` — track consecutive high-jitter
   seconds. When threshold crossed, emit `'data-storm-start'` event. When jitter subsides
   for 10s, emit `'data-storm-end'`. Visual system listens and triggers particles + tint.
7. Visual: add CA-driven particle effects — fire spread acceleration emits embers at the
   spread location; dead zones flicker with glitch particles; data storm triggers full-screen
   particle storm. All through the existing G1 particle pool.
8. Verify: `cargo test` — all existing fire tests pass with neutral network params. Manual
   test: inject high jitter via `NW.NET.snap.jitter = 100` → fire spreads visibly faster
   and more erratically. Inject low downlink → wetness pools (if implemented). Switch
   connection type → wind changes.
9. Playtest gate: user verdict on whether the network-driven CA feels alive and interesting.
   Can they tell the difference between Ethernet fire and WiFi fire? Is the data storm cool
   or annoying?

**Per-milestone risks:**
- Fire CA with high jitter may become uncontrollable (everything burns) → clamp fire spread
  multiplier to 3× max; ensure burnout rate also scales with jitter so fires self-limit
- Dead zones may be confusing (why can't I move here?) → visual indicator is critical
  (glitch particles + tile tint). Dead zones should be rare (jitter >50ms is uncommon on
  stable connections)
- Data storm may trigger too often on genuinely bad connections → require sustained high
  jitter (80ms+ for 30+ consecutive seconds before storm triggers); storm cooldown of
  5 minutes
- Rust `net_params` layout change must be backward-compatible → length check in
  `set_network_params()`: if len < 20, CA params stay at defaults. This means N1→N3
  upgrade doesn't break existing saves (not that we have saves — but it doesn't break
  the running game if someone hot-reloads)

---

#### A1 — Local Agent (stretch, optional)

**Dependencies:** N3 merged (needs the full network→sim pipeline to be worthwhile). All
previous milestones merged. This is a stretch goal — only build if the browser-only
experience is shipped and fun.

**Entry criteria:**
- N3 merged and tagged
- Browser-only experience is complete, fun, and playtested
- User explicitly requests the local agent

**Exit criteria:**
- `rust/nightward-agent/` — a tiny Rust binary (separate from `nightward-core` — this is
  a native binary, not wasm). Uses `tokio` + `tungstenite` for WebSocket server on
  `ws://localhost:9734`. Shares the existing `stable-gnu` toolchain.
- Agent serves a JSON message every 1 second: `{ "icmp_rtt": 12.5, "wifi_rssi": -45,
  "tcp_connections": 34, "arp_table_size": 8, "interface_rx_bytes": 1234567,
  "interface_tx_bytes": 987654 }`. ICMP ping via raw socket or system `ping` command
  (platform-dependent — Windows: `ping -n 1`, Unix: `ping -c 1`). WiFi RSSI via
  `netsh wlan show interfaces` (Windows) or `iwconfig`/`iw` (Linux) — parse CLI output.
  TCP connections via `netstat -n` count. ARP table via `arp -a` count.
- `src/game/systems/network.ts` — `LocalAgentClient` class: attempts WebSocket connection
  to `ws://localhost:9734` on boot. If connection succeeds, the agent's metrics override
  the browser-only equivalents (ICMP RTT replaces `navigator.connection.rtt`, WiFi RSSI
  adds a new `wifiRssi` field, TCP count adds `lanDevices` field). If connection fails
  or drops, gracefully falls back to browser-only metrics — no error, no interruption.
- HUD shows an indicator when the agent is connected (small green dot + "AGENT" label
  next to the RTT readout). Disconnected → dot goes gray.
- Agent is ~200 lines of Rust. It's a separate cargo project in the workspace — shares
  the same `Cargo.lock` but compiles to a native binary, not wasm. `cargo build` in
  `rust/nightward-agent/` produces `target/release/nightward-agent.exe` (or platform
  equivalent).
- Agent is NOT required to play. The README documents it as an optional enhancement.
  The game's GitHub Pages deployment doesn't include the agent binary — users who want
  it clone the repo and `cargo build` themselves.

**Estimated effort:** 1–2 sessions (only if pursued).

**Sub-tasks (implementation order):**
1. Create `rust/nightward-agent/` — `Cargo.toml` with `tokio` (full features for networking)
   + `tungstenite` (WebSocket). Add to workspace `Cargo.toml` members.
2. Implement WebSocket server: bind `127.0.0.1:9734`, accept one connection at a time,
   send JSON metrics every 1 second. Handle connection drops gracefully (re-bind).
3. Implement metric collectors: ICMP ping (spawn `ping` subprocess, parse output), WiFi
   RSSI (spawn `netsh`/`iwconfig`, parse), TCP count (spawn `netstat`, count lines),
   ARP table (spawn `arp`, count entries), interface bytes (platform-specific).
   Each collector is a separate function with a 2-second timeout.
4. Add `LocalAgentClient` to `src/game/systems/network.ts`: WebSocket connect on boot,
   JSON parse, merge into snapshot. Handle disconnect/reconnect with exponential backoff
   (1s, 2s, 4s, max 30s).
5. HUD indicator: green/gray dot + "AGENT" label in the info readout.
6. README: document the agent — what it provides, how to build, how to run, that it's
   optional.

**Per-milestone risks:**
- Platform-specific metric collection is fragile (CLI output formats change between OS
  versions) → parse defensively; if parsing fails, omit the metric rather than crashing
- Raw sockets for ICMP may require admin/root on some systems → fall back to system `ping`
  command (which is allowed without root on most systems)
- WebSocket on `localhost:9734` may conflict with other applications → make the port
  configurable via CLI arg or env var
- Security: agent binds to `127.0.0.1` only (never `0.0.0.0`). No authentication —
  localhost-only is the security boundary. Document this.

---

### Shelved (old W5, W7, W8, R3, R4, R5 — preserved for reference)

These were designed for the dream-world survival RPG. They may be revisited, re-themed, or
mined for ideas, but are not in the active queue.

- **W5 — Zoom & LOD:** folded into G1/G2 (SUBPIPX + post-processing touch the same render
  pipeline).
- **W7 — Loot economy & soul-feeding:** ✅ SHIPPED (2026-07-19, Batch 7). Feed materials → soul-gear XP with affinity bonuses.
  xp. May return as N4 if the core loop needs deepening after N1–N3.
- **W8 — Grid inventory & paper-doll:** deferred indefinitely. The current inventory works;
  a D2/PoE grid is a lot of UI work for marginal gain.
- **R3 — Physical skills:** knockback/ice slides/mud slows. The knockback half is folded into
  G2 (juice pass). The rest is shelved.
- **R4 — Water, growth & farming:** wetness spread + rain + farming. Shelved — the network
  sim is the new "living world."
- **R5 — Worldgen in Rust, flow-field pathfinding, sub-tile falling sand:** stretch that was
  always unscheduled. The learning investment in Rust paid off (R0–R2) regardless.

User verdict on the current world: too few blocks, nothing reacts — "no room for physics for
skills." Root cause: terrain is a pure function of (seed, x, y); the only runtime-mutable world
state is `depleted` + buildings. This batch makes the world **writable**, then **alive**, with a
Rust→WebAssembly core (`rust/nightward-core`) doing the heavy lifting. Rust is a deliberate
## Toolchain decisions (carried forward from Batch 4)
- rustup **`stable-gnu`** host toolchain + `wasm32-unknown-unknown` target; **wasm-pack via npm**
  (prebuilt binary — never `cargo install` it).
- **Cargo target dir = `node_modules/.cargo-target`**: OneDrive-safe, gitignored. The `wasm` npm
  script is `node scripts/wasm.mjs` — sets `CARGO_TARGET_DIR` to the absolute path and spawns
  wasm-pack (wasm-pack does NOT honour `.cargo/config.toml`'s `build.target-dir` — R0 lesson).
- `src/wasm/pkg/` and cargo build dirs are gitignored, rebuilt locally + in CI.

## Harness gotchas (accumulated — read before verifying)
- **`document.hidden === true`** in the preview tab blocks rAF entirely. `__nw.frames` stays 0,
  `render()` never fires, screenshots hang. Workaround: drive `worldCore.ensureAround` /
  `chunks.ensureAround` / `chunks.rebakeTiles` / `chunks.tickFoam(ms)` directly via console.
- **`window.__nw.step(n)`** only calls `sim()`, NOT `ensureAround`/`drainEvents`/`rebakeTiles`.
  Use real wall-clock waits for event/rebake tests, or call the render-side methods manually.
- **TS `private` is not runtime-enforced.** `__nw.chunks.chunks` (the private chunk map) is
  reachable from the console for deep pixel assertions.
- **Synthetic keydown state** does not reliably persist across real-time waits in backgrounded
  tabs — use direct `_activate()` stress for perf checks, not simulated movement.

## Verification (every milestone)
- `npm run wasm` (once) + `npm run typecheck` clean + `npm run build` green.
- `cargo test` in `rust/nightward-core/` — all Rust logic tests pass.
- Live at `?seed=<fixed>`: `window.__nw` surfaces driveable sim state; verify logic via eval +
  event log; visual check by foregrounding the preview panel.
- Determinism preserved (same seed → same world). No save/load to roundtrip — `newState()` on
  every boot is itself the correctness check.
