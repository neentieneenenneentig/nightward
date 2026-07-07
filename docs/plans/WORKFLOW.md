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
4. **Verify** (all must pass):
   - `npm run typecheck` → clean
   - `npm run build` → green
   - `preview_start nightward-dev`, then exercise logic via `window.__nw.step(n)` + eval and the event log
     (the harness tab renders hidden, so don't rely on screenshots).
   - No save/load — there is no persistence layer (see ROADMAP: no-persistence decision). Don't add one.
5. **Commit** (conventional messages), then merge back and clean up:
   ```
   git -C <repo> merge --no-ff feat/w<n>-<slug>
   git worktree remove .claude/worktrees/w<n>-<slug>
   git branch -d feat/w<n>-<slug>
   ```
6. **Tag** notable states (e.g. `v0.5-rig`, `v0.6-soulgear`).

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
