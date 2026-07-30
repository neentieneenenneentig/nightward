# L1 — The Lifespan: a hard 15-minute "perfect run" loop

**Status: SHIPPED ✅ (2026-07-31).** Implemented overnight per user direction ("plan, implement,
develop, build all of it"). Absorbed the in-flight W6 (scoreboards) work already sitting
uncommitted on `u2-grimdark` — W6's leaderboard panel became this milestone's Legacy Board.
Verified: typecheck clean, build green, Gauntlet 72/72 functions / 1249/1249 assertions, 3×
consecutive clean live runs via headless Chrome + raw CDP at `?gl&seed=1234`. Full record in
`docs/plans/ROADMAP.md`.

## Why (user's ask, restated precisely)

Open-ended survival with no real end condition. User wants: a **hard ~15-minute session**, a
**character lifespan** (flavor: "10 years per minute") that ends in **death of natural causes**
— not just combat death — and a **scored, replayable "perfect run" chase**, which means
**rebalancing** so meaningful things can actually happen inside that window.

## Review findings that motivate this design (see chat for the full audit)

1. **The existing scoreboard rewards being AFK.** `ScoreboardSystem.connectionUptime` only
   stops accruing on `gameOver`; the leaderboard sorts by it descending. A player who walls
   themselves in and never engages the horde currently has the *dominant* strategy for a "high
   score" — literally leave the tab open and do nothing. There is no hard end condition at all
   except the hall being destroyed, which a passive turtle never risks. This is the single
   biggest design flaw the user's ask fixes: bound the session, and score what you *do* within
   it, not how long the tab sat open.
2. **God mode (`state.god`, key `U`) is real and unflagged.** It correctly zeroes all incoming
   damage (`combat.ts` `damagePlayer`) and grants +99999 gold / 9999 of every item / maxed
   skills. `ScoreboardSystem.saveToLeaderboard()` has no idea a run ever had it on — a god-mode
   run posts a top score indistinguishable from a legitimate one. Confirmed: nothing in
   `scoreboard.ts`/`ui.ts` reads `state.god`.
3. **Confirmed NOT a bug (checked because a past incident here was exactly this shape):** the
   spam-click swing-restart in `combat.ts` (`restartSwing()`) is rate-capped at
   `CFG.combat.restartMinIntervalSec` (0.12s) — the autoclicker-DPS exploit flagged in project
   history is actually fixed in the current tree. No action needed.
4. **Soul Gear — the marquee "gear that levels forever" system — is unreachable in one run.**
   `CFG.soulgear.xpBase=900, xpGrowth=1.085`, but `weaponXpPerSwing=3`. Soul level 2 needs 300
   landed swings. In a 15-minute run that's most of the session spent exclusively swinging, at
   the cost of every other system. This is the concrete "rebalance some stuff" the user asked
   for: the curve is tuned for an open-ended session that no longer exists.
5. **The Loom (C3 passive tree) grants 1 point per night survived.** A 15-minute run spans
   ~2–3 nights (`daySec=240 + nightSec=100` = 340s/cycle). 2–3 points into a 40-node/4-keystone
   tree is barely a taste. Needs another income source that fits a single run.

## Design

### Lifespan (`CFG.lifespan`, new `LifespanSystem`)
- Character starts at `startAge` (16). Ages via **real wall-clock time** (like
  `ScoreboardSystem.updateReal`, paced off `performance.now()`, not sim-dt) at
  `yearsPerRealMinute` (10) — this is deliberately *not* tied to `simSpeed`/network jitter: the
  hard cap must hold regardless of connection jank. It also means the Gauntlet's `nw.step()`
  synchronous tests (which don't advance real time) never accidentally trigger old-age death.
- Target death age is rolled once per run, seeded (`state.seed`) so a given `?seed=` is
  reproducible: `startAge + yearsPerRealMinute × (baseRunMinutes ± varianceMinutes)`, i.e. a
  14–16.5 minute window around the 15-minute target — "hard" but not a robotic identical
  stopwatch every time.
- **Aging rate only ever speeds up, never slows below 1×** — driven by current vigor/resolve
  (the existing S1 survival vitals): full vigor+resolve = base pace (the 15-min ceiling);
  neglect (starving, broken resolve) accelerates aging up to `vitalsSwingPct` (12%) faster.
  This makes a *skilled, well-fed* run hit exactly the intended ceiling, while a careless run
  can die of old age noticeably early — a real skill expression that can only shorten the run,
  never extend it past the hard cap.
- Warning UX: inside `warnMinutesRemaining` of death, a one-time toast + HUD tint shift; inside
  `criticalMinutesRemaining`, a slow heartbeat vignette (same pattern as vitals' resolve-zero
  vignette).
- Natural death is a **second terminal condition** alongside hall-destruction (previously the
  only one). It does not scatter gold or count as a loss — it's the intended "you made it"
  ending, with its own Veil-appropriate flavor text (no network jargon, matches N2a fiction
  law).

### Legacy score & scoreboard v2 (`src/game/systems/scoreboard.ts`)
- `RunScorecard` bumped to `v: 2`: adds `age`, `causeOfDeath: 'old_age' | 'hall_fallen'`,
  `legit` (false if `state.everGod` was ever set), `legacyScore`.
- `legacyScore` is a transparent weighted sum (`CFG.legacy.weights`, data-driven/tunable) over
  the stats already tracked: nights survived, kills, bosses, buildings, loom points, gold, and
  a bonus for reaching old age at all (finishing the run beats being cut short). Shown with a
  breakdown in the UI, not just a magic number — matches the Lens's "legible" design law.
- Leaderboard sorts by `legacyScore` descending, **legit runs ranked separately from flagged
  (god-mode) runs** — closes finding #2 without deleting the debug tool.
- `loadLeaderboard()` migrates old `v:1` entries in place (best-effort `legacyScore` without
  the age/old-age terms) instead of discarding the user's existing local run history.

### Rebalance
- `soulgear.xpBase` and per-action soul-xp grants retuned so first soul level-up is reachable
  in a few minutes of normal play, not 5+ minutes of uninterrupted attacking.
- Loom gains a second income source (boss kills) so a full run can meaningfully engage the
  tree, not just sample it.
- Horde/day-night pacing is NOT overhauled — S1's numbers already produce a real climax by
  night 2–3, which now lines up with the run's natural endgame.

### Non-goals
- No change to the no-persistence rule (still only outcome scorecards persist).
- No network-driven lifespan pacing — deliberately independent of `NW.NET` for reliability;
  the hard cap must hold even in a bad-connection run.
- Not attempting a full economy rewrite tonight — scoped to what's load-bearing for "a run has
  a shape and an ending you can optimize against."

## Acceptance checklist
1. `npm run typecheck` clean, `npm run build` green.
2. A run run to completion via accelerated real-time (or a debug age-skip hook) ends in an
   old-age game over distinct from hall-destruction, with correct flavor text and a saved
   scorecard.
3. God-mode runs are saved but visibly flagged, not mixed unmarked into the top legit ranking.
4. Leaderboard panel shows legacy score + breakdown; old v1 localStorage entries still load
   without crashing.
5. Soul weapon reaches level 2 well within a normal single run's combat budget (verified via
   the exhaustive-playthrough Gauntlet test).
6. Full Gauntlet green at `?seed=1234&test` (live, headless-Chrome-verified, evidence pasted
   into the shipped record — per WORKFLOW.md's definition-of-done, no unverified claims).
