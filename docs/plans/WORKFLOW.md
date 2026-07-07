# Changing pattern — one milestone, one worktree

Formalized workflow so each milestone is isolated, verifiable, and mergeable on its own.

## Per-milestone loop
1. **Branch a worktree from `main`:**
   ```
   git worktree add .claude/worktrees/w<n>-<slug> -b feat/w<n>-<slug>
   ```
   (`.claude/worktrees/` is gitignored.) Work happens inside that directory.
2. **Read the brief:** `docs/plans/ROADMAP.md` for the whole picture, `docs/plans/W<n>-*.md` for the task.
3. **Implement** to the spec. Keep the non-negotiables (procgen, data-driven, determinism).
4. **Verify in the worktree** (static checks only — live preview CANNOT run here, see note):
   - typecheck → clean, build → green. Worktrees have no `node_modules`; junction it from main
     (`New-Item -ItemType Junction`) or run tools via the main repo's install, e.g.
     `node <mainrepo>/node_modules/typescript/bin/tsc --noEmit -p <worktree>/tsconfig.json`.
   - No save/load — there is no persistence layer (see ROADMAP: no-persistence decision). Don't add one.
5. **Commit** (conventional messages), then merge back and clean up:
   ```
   git -C <repo> merge --no-ff feat/w<n>-<slug>
   git worktree remove .claude/worktrees/w<n>-<slug>
   git branch -d feat/w<n>-<slug>
   ```
   (`git worktree remove` sometimes hits a transient "Permission denied" from OneDrive sync —
   retry `rm -rf` on the leftover folder a few seconds later + `git worktree prune`;
   `git worktree list` is the authoritative check.)
6. **Live-verify on main, AFTER the merge**: `preview_start nightward-dev` always serves the main
   project directory, never a worktree — this is a harness fact, confirmed twice. Exercise logic via
   `window.__nw.step(n)` + eval and the event log (the harness tab renders hidden, so don't rely on
   screenshots). If live verification fails, fix forward on main (or revert the merge).
7. **Tag** the verified state (e.g. `v0.5-w0`, `v0.7-w2-soulgear`).
8. **Playtest gate for look/feel milestones**: if the milestone changes how the game looks, feels, or
   sounds (art, animation, combat feel — W3/W4/W6 all qualify), STOP after tagging and get the user's
   playtest verdict before starting the next milestone. W1 shipped a visual overhaul, chained straight
   into W2, and then had to be surgically reverted around W2's changes when the user disliked it —
   a plain `git revert` would have worked if we'd paused for feedback first.

## Conventions
- One milestone = one branch = one worktree. Don't mix milestones.
- Conventional commits: `feat:`, `fix:`, `refactor:`, `chore:`, `docs:`.
- Data-first: add a row in `src/game/data/*` before touching a system; systems stay generic.
- Every new player-facing action should emit a `log` event (after W0) and play an SFX.

## Handy commands
- Dev server: `preview_start` with `nightward-dev` (`.claude/launch.json`), port 5173. Add `?gl` to force WebGL.
- Typecheck: `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json`
- Build: `node node_modules/vite/bin/vite.js build`
- Dev test hook: `window.__nw` — `.state`, `.ctx`, `.sys.*`, `.step(n, dt)` (advance sim deterministically),
  `.craft(id)`. Live balance: `window.NW.CFG`. Debug hotkeys: `.` `n` `g` `m` `h` `j` `y`.
