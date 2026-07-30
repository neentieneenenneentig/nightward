# W6 — Scoreboards (Connection-Uptime Leaderboards)

**Status: SUPERSEDED by L1 (2026-07-31).** This milestone's leaderboard panel work (uncommitted
on `u2-grimdark`) was finished and folded into `docs/plans/L1-lifespan-perfect-run.md` — the
sort key changed from connection-uptime (rewarded being AFK — see L1's review notes) to a
legacy score. Kept here as historical record of what was already built going in.

Goal: a "breather" milestone — scoreboard infrastructure already exists (ScoreboardSystem
tracks connection uptime, kills, bosses, buildings, rifts, RTT peaks, bandwidth lows;
snapshots run outcomes to localStorage). This milestone adds the **player-facing UI**:
a leaderboard panel viewable during gameplay, and a polished death scorecard.

Prereq: none (standalone). N2b shipped. Typecheck clean, build green.

## What already exists

- `ScoreboardSystem` (`src/game/systems/scoreboard.ts`) — fully built:
  - `updateReal(ms)` called every frame from the render loop
  - Tracks: `connectionUptime`, `dominantRealmTally`, `riftsSurvived`, `peakRtt`,
    `lowestDownlink`, `enemiesKilled`, `bossesSlain`, `buildingsBuilt`
  - `snapshot()` → `RunScorecard` with all 14 fields
  - `saveToLeaderboard()` → pushes to localStorage (top 50, sorted by connection age)
  - `loadLeaderboard()`, `formatAge()` exported helpers
- Hooks wired:
  - `onKill(isBoss)` in `hordes.ts` (line 759)
  - `onBuild()` in `build.ts` (line 190)
  - `onRift()` in `main.ts` (line 201)
  - `saveToLeaderboard()` in `triggerGameOver()` (main.ts line 375)
- `showGameOver(onRestart, card)` already displays scorecard fields on the death screen
  (`ui.ts` line 693)
- Regression tests: `testScoreboardSnapshot` + `testLeaderboardPersist` in `regression.ts`

## What's missing (this milestone)

1. **Leaderboard panel** — a viewable panel (key `L` or HUD button) showing the top-N
   runs from localStorage. Styled consistently with existing panels (bag, craft, skills,
   log). Each entry shows: rank, connection age, nights survived, enemies killed, bosses
   slain, gold, dominant realm.
2. **Current-run stats** — a small widget in the leaderboard panel showing the CURRENT
   run's accumulated stats (so far), distinct from the historical leaderboard.
3. **Death screen polish** — the existing `showGameOver` already displays scorecard data;
   this milestone adds a "View Leaderboard" button on the death screen that shows the
   full leaderboard (with the just-ended run highlighted).
4. **Empty-state UX** — first run ever: show a message like "No runs recorded yet.
   Survive, and your name will be written in the static."

## Non-goals (explicitly out of scope)

- No online leaderboard / server — localStorage only (no-persistence rule carve-out)
- No run names or player identities — runs are anonymous, identified by date + stats
- No filtering/sorting options — leaderboard is sorted by connection age (descending),
  which is the game's primary measure of "how long you held the connection"
- No export/import — runs live in the browser that created them

## Implementation plan

### Step 1: Add leaderboard panel to UI
- Add `'leaderboard'` to the `Panel` union type in `ui.ts`
- Add `L` key binding to toggle the leaderboard panel
- Build the panel body: a scrollable list of leaderboard entries
- Style with existing CSS variables (use `.nw-panel` conventions)

### Step 2: Add current-run stats section
- At the top of the leaderboard panel, show the current run's live stats
- Read directly from `ctx.scoreboard` (same instance already tracking everything)
- Show: connection age (live), enemies killed, bosses slain, buildings, rifts, peak RTT

### Step 3: Wire "View Leaderboard" on death screen
- Add a secondary button on `nw-gameover`: "Leaderboard" next to "Try again"
- Clicking it shows the leaderboard panel overlaid on the death screen
- The just-ended run is highlighted (it's the freshest entry)

### Step 4: Regression test
- Add `testLeaderboardUI` — verify the leaderboard panel renders entries correctly
  after saving a few runs

### Files touched
- `src/game/ui/ui.ts` — panel logic, leaderboard body builder, death screen button
- `src/game/ui/styles.ts` — leaderboard panel CSS
- `src/game/systems/regression.ts` — new UI test
- `src/game/systems/scoreboard.ts` — maybe a `getStats()` helper for current-run display

## Acceptance checklist

1. [ ] `npm run typecheck` clean
2. [ ] `npm run build` green
3. [ ] `cargo test` all pass (no Rust changes expected)
4. [ ] `L` key opens/closes the leaderboard panel
5. [ ] Leaderboard shows "No runs recorded yet" on first ever run
6. [ ] After a death, leaderboard shows the just-ended run
7. [ ] Current-run stats section updates live during gameplay
8. [ ] Death screen has "Leaderboard" button
9. [ ] All existing Gauntlet tests pass at `?seed=1234&test`
10. [ ] Regression: `testLeaderboardUI` passes
