# HANDOFF — Batch B, first slice: B0 → B4 → B1

**For:** the implementing agent · **Written:** 2026-08-11 against `main` @ `99b23eb`
**Source of truth:** `docs/plans/BG-batch-proposal.md` (revision 3). Read §8, §10, §11, §15.
**Process:** `docs/plans/WORKFLOW.md`. Read it. It is not optional.

---

## 0. Read this part first — why this handoff is written the way it is

This project has shipped **fabricated test evidence twice**. A milestone reported "all
green" for a Gauntlet run that never happened. A second reported failures that "were
pre-existing and documented in WORKFLOW.md" — no such documentation existed and none
reproduced. It has also shipped **three tautological tests**: assertions that could not
fail, sitting inside the very suite built to catch this class of problem.

You are not being accused of anything. You are being told the standard, up front, because
it is higher than most projects and you will be held to it:

- **A claim without pasted raw output is not evidence.** "Gauntlet green" without the
  console text is treated as "did not run."
- **The reviewer re-runs the suite independently** via headless Chrome + raw CDP,
  regardless of what you report. This is standing policy, not distrust of you.
- **A test that cannot fail is worse than no test.** Before you write an assertion, ask:
  *what change to the production code would make this go red?* If you cannot name one,
  the test is worthless — delete it or make it real.
- **Known gaps require the user's sign-off BEFORE merge**, not disclosure after. "I'll fix
  it next time" is not a merge strategy. Stopping to ask is always the correct move.

---

## 1. Scope

**In scope — three milestones, in this order:** B0 (toolchain), B4 (hygiene), B1 (xp curve).

**Explicitly NOT in scope. Do not start these:**

- **B2** (start-of-run fairness) — overturns recorded decision **D2** and needs the user's
  answer to §12 Q2 first.
- **B3** (payoff layer) — must be tuned *after* B1's Long Thread fix ships. Any number
  chosen before that is wrong.
- **All of Batch G** — G1 has a mandatory prototype gate with a user verdict in the middle.
- **Any new content.** No new items, enemies, buildings, biomes or systems. §13 of the
  proposal lists the standing prohibitions; the tile grid and the 360° rig are settled and
  must not be reopened.

**Stop and hand back when B1 is committed and pushed.** B1 changes balance, which triggers
WORKFLOW's **playtest gate** — the user plays it and gives a verdict before anything else
starts. Do not merge to `main` and do not tag without explicit sign-off.

---

## 2. Setup

```bash
git worktree add .claude/worktrees/b-reachable-run -b feat/b-reachable-run
cd .claude/worktrees/b-reachable-run
npm run wasm          # REQUIRED: src/wasm/pkg/ is gitignored; typecheck+build fail without it
```

Worktrees have no `node_modules` — junction it from the main repo or run tools through the
main repo's install (WORKFLOW "Handy commands" has the exact invocations).

**You can verify live inside the worktree.** WORKFLOW step 6 says live verification must
happen on `main` after merge; that constraint came from the VSCode preview harness, which
serves only the main directory and loads the tab hidden so rAF never fires. It is
superseded for your purposes: **your own headless Chrome renders correctly.** Run `vite` on
port 5199 and drive `chrome --headless=new --remote-debugging-port=9223` over raw CDP from
Node. Full recipe and the known harness gotchas are in **Appendix A** of the proposal —
read it before writing a driver script, it documents traps that cost real time to
rediscover (`__nw.step()` does not run the render loop; `state.player.x/y` is a mirror;
the lifespan system is `__nw.sys.lifespan`, not `__nw.lifespan`).

---

## 3. B0 — Toolchain hygiene

Effort: half a session. Changes no game behaviour. Full spec in proposal §8/B0.

1. **Rust edition 2021 → 2024** in `rust/nightward-core/Cargo.toml`. One line. Run
   `cargo test` (23/23 expected). If anything breaks, stop and report rather than papering
   over it. If you conclude 2024 is wrong, write the reason *in `Cargo.toml`* so the
   question stops recurring.
2. **Pin `wasm-bindgen = "0.2"` → `"0.2.126"`** (the version `Cargo.lock` already
   resolves). Five minutes. Builds are already deterministic via the tracked lockfile;
   this only guards against a careless `cargo update`.
3. **`tsconfig.json` target and lib: ES2022 → ES2024.** Cheap, low value, no reason not to.
4. **B0.4 was dropped in revision 3 — do not do it.** `wasm-opt` already runs by default
   and the release profile is already `opt-level = "s"` + `lto = true`. Nothing to verify.

**Do NOT enable `strict: true`.** It was explicitly rejected (proposal §14 item 4): it adds
a large diff of unrelated churn on top of the exact files B1 rewrites, and it does not
catch B1's failure mode, which is numeric and runtime.

---

## 4. B4 — Hygiene

Effort: ~30 minutes. Proposal §8/B4.

1. **Fix the stale comment at `src/game/data/config.ts:214`.** It still says the `vitals`
   block is *"STUBS ONLY (2026-07-17) — not yet wired."* S1 shipped and wired all of it and
   L1 reads these values. This is actively misleading, in the file the project designates
   as the source of truth for numbers.
2. **Delete `ChunkMap.bakeSubpix()` and `subpixFactor()`** — ~170 lines that never run.
   **This is three edits, not two:** there is a live call site at
   `src/game/world/chunkmap.ts:79` —
   `this.chunks.set(key, sf > 1 ? this.bakeSubpix(cx, cy, sf) : this.bake(cx, cy))` —
   whose ternary must collapse to the `bake()` branch. It is unreachable only because
   `subpixFactor()` hardcodes `return 1`. **Do this before any Batch G work ever starts**,
   so nobody implements against dead code.
3. **`BiomeDef.hazard` and `Recipe.station`** — both declared, both read by nothing
   (`station` is `null` on all 45 rows). Delete them. If you think either should be wired
   instead, that is a content decision: ask, do not decide.
4. **Delete the 7 fully-merged local branches** (`c1-echoes`, `feat/g1-visual-upgrade`,
   `feat/n2a-veil-lens`, `s1-survival`, `sync/world-engine-through-r1.5`, `u1-lens-ui`,
   `u2-grimdark`). Verify zero divergence first:
   `git rev-list --left-right --count main...<branch>`.
   **Do not delete the `origin` copies.** Deleting remote branches is outward-facing and
   irreversible for collaborators — list what you would delete and let the user run it.

---

## 5. B1 — Retune the progression curve ← the real work

Effort: 1 session. Proposal §8/B1, including sub-sections **B1.a** and **B1.b** which were
added in revision 3 and are the parts most likely to be skipped. Read them.

### 5.1 The change itself

`src/game/data/config.ts`: `CFG.xp` from `{ base: 400, growth: 1.32, maxLevel: 50 }` to
**`{ base: 60, growth: 1.12, maxLevel: 40 }`**.

Cumulative xp to *reach* level L is `500 × (1.12^(L-1) − 1)`. Expected values:

| Level | 5 | 10 | 15 | 20 | 24 | 30 | 40 |
|---|---:|---:|---:|---:|---:|---:|---:|
| total xp | 287 | 886 | 1,944 | 3,806 | 6,276 | 12,875 | 41,050 |

**Do not touch `CFG.soulgear`.** It has its own curve (`xpBase 250, growth 1.085,
cap 100`), was retuned in L1, and must not move in this commit.

**These numbers are a starting point, not a result** (risk R2). They come from an estimated
run xp budget with real uncertainty in it. If playtesting says they are wrong, that is the
system working. `window.NW.CFG` is live-editable, so tuning needs no rebuild.

### 5.2 The Gauntlet cannot see this change — you must give it eyes

**This is the single most important thing in this handoff.** Verified against
`regression.ts`:

- The only xp-granting fixtures are `regression.ts:1273` and `:1286`, both
  `state.player.xp[rec.skill] = Math.max(..., 50000000)`. That is a **floor** — a cheaper
  curve still clears every gate, so they keep passing unchanged.
- `grep -n "CFG.xp\|xpToNext\|xpProgress" src/game/systems/regression.ts` returns
  **nothing.** No test pins the curve.

So: **a green Gauntlet is NOT evidence that B1 is correct.** If you report "72/72 green,
B1 verified," that is precisely the failure this project has already suffered twice. The
suite will stay green whether your change is right or catastrophically wrong.

**Write `testXpCurve`.** It must pin cumulative xp at the gate levels that matter
(5, 10, 15, 20, 30) *against the recipe `levelReq`s that consume them*, so the curve and
the content it gates can never drift apart silently again. The test should fail if someone
changes `CFG.xp.base`, `growth`, or `maxLevel` without re-deriving the gates.

Apply the tautology check to your own test before submitting it: **name the specific code
change that turns it red.** If you cannot, rewrite it.

**While you are there, fix the existing tautology pair at `regression.ts:376-377`:**
`skillLevel >= beforeLevel` after adding xp is trivially true, and
`'500 XP grants at least level 2'` is guarded by an `|| newLevel > 0` disjunct that makes
it pass almost unconditionally. It is in the exact test B1 depends on.

### 5.3 B1 breaks the Loom — fix it in this commit

The Long Thread keystone grants `floor(totalLevels / 4)` Loom points across the **8** skills
in `data/skills.ts` (`src/game/systems/loom.ts:56`). B1 makes every skill level far cheaper,
so the grant scales up hard:

| | total skill levels | Long Thread grant |
|---|---:|---:|
| today | ~28 | 7 points |
| post-B1 (estimated) | ~71 | **~17 points** |

On a 132-rank tree, against B3's proposed 6–8 points of *total* base income. Long Thread is
also the only keystone reachable at depth 5, so the opening becomes forced and it stops
being a choice.

**Re-derive that number yourself against the curve you actually ship** — the ~71 is an
estimate from the proposal's §3.1 run budget, not a measurement. Then bring the grant back
into proportion. **Do not invent a new Loom design to fix it** — proposal §12 Q3 lays out
three legitimate options and explicitly leaves the choice to B3's brief. Your job is to
stop the runaway and report your numbers; if the fix you want requires picking one of those
three directions, stop and ask.

**Two related defects in the same code, both in scope:**

1. **"Skills cap at 80" is not implemented.** `levelFromXp` (`src/game/rules.ts:40`) hard-
   caps on `CFG.xp.maxLevel` with no `longThread` awareness — the flag appears in
   `data/loom.ts`, `state.ts` and `systems/loom.ts` and **never in `rules.ts`**. B1 sets
   `maxLevel: 40`, turning a dead effect into a visible lie (advertises 80, caps at 40).
   Either implement it or delete the claim from `keystoneDesc`. A keystone advertising an
   effect the engine does not have is a bug regardless of balance.
2. **`data/loom.ts:48`** comments *"+1 loom point per 4 total levels **instead of 5**."*
   There is no per-5 baseline anywhere; Long Thread is the only skill-level→points path in
   the game. Correct the comment.

---

## 6. Definition of done

From WORKFLOW plus proposal §11 (items 8–9 were added in revision 3 specifically for B1):

1. `npm run typecheck` clean · `npm run build` green · `cargo test` passing (B0 touches Rust).
2. **Full raw Gauntlet console output pasted.** Not a summary. Not "all green." The literal
   text. Baseline is **72 functions / 1249 assertions, 0 failures, 0 page errors** at
   `?gl&seed=1234`. You are adding at least one function — the new count must be stated and
   the delta explained.
3. `testXpCurve` exists, is not a tautology, and you have stated **what change makes it red**.
4. The Long Thread grant re-derived against the shipped curve, with your numbers shown.
5. "Skills cap at 80" either implemented or removed from the description.
6. Branch committed with conventional-commit messages and pushed. **No merge to `main`.
   No tag.**

**Report honestly.** If the Gauntlet goes red, paste it red and say so — a red suite you
disclose is a normal Tuesday; a green suite you invented ends the collaboration. If you ran
out of time, say which items you did not do. If something in this handoff turns out to be
wrong when you look at the code, say that too: this document was written from a review,
and reviews can be wrong.

---

## 7. Quick reference

| | |
|---|---|
| Plan (authoritative) | `docs/plans/BG-batch-proposal.md` §8, §10, §11, §15 |
| Process | `docs/plans/WORKFLOW.md` |
| What the game IS | `docs/GDD.md` |
| Gauntlet driver recipe + harness traps | proposal **Appendix A** |
| Master balance file | `src/game/data/config.ts` |
| Live balance editing (no rebuild) | `window.NW.CFG` |
