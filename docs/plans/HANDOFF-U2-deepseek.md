# Handoff prompt — implement U2 "Grimdark Chrome"

*(Paste everything below this line into the implementing model. Written 2026-07-18.)*

---

You are implementing a milestone in **NIGHTWARD**, a browser territory-RPG (PixiJS v8 +
TypeScript + Vite, with a Rust→WebAssembly world core). Core identity: "RuneScape ×
Vampire Survivors × network monitoring" — the player's real internet connection drives
game parameters through data-table mappings. All game art is 100% procedurally
generated; **the UI uses zero image assets** — chrome is pure CSS. There is **no
persistence** — closing the tab deletes the character, by design. Never add save/load.

## Your task

Implement milestone **U2 — Grimdark Chrome** exactly per the brief at
`docs/plans/U2-grimdark-chrome.md`. Read that file first, in full — it contains the
complete token set, the frame recipe as copy-ready CSS, phase-by-phase scope, and a
pitfalls section that was ground-truthed against the shipped code the day this was
written. Treat every pitfall as binding. Also read `docs/plans/WORKFLOW.md` (process
rules).

Summary (the brief is authoritative): the previous milestone (U1) replaced the RPGUI
pixel-art skin with the flat dark "Lens" look. The user's verdict on the result:
bland, reads as developer tooling. U2 keeps U1's architecture (one stylesheet, CSS
custom properties, unchanged DOM/layout) and swaps the aesthetic to a Path of
Exile / Diablo grimdark treatment: warm iron near-black surfaces, brass plaque
frames built from inset box-shadow rings, corner brackets, blood-gradient HP,
serif small-caps display type over a sans body, and — the user's explicit ask —
**the bottom action bar compacted to small Diablo-style icon sockets** (~44px,
keybind in the corner, no text labels; names move to `title`/`aria-label`).

This is a **styling milestone**: ~95% of the diff is `src/game/ui/styles.ts`. The
only allowed `src/game/ui/ui.ts` edits are the three lines the brief specifies
(`title` + `aria-label` in the `buildActions()` `btn()` helper, and the `'Space'`
→ `'Spc'` keybind string). If you are editing any other source file, stop — you
are out of scope.

## Setup — STEP ZERO, before any code

Two milestones ago the implementer skipped the branch instructions and left all work
uncommitted on the wrong branch. Do not repeat this. Run these commands FIRST and
verify the output of the last one says `u2-grimdark` before touching any file:

```
git fetch origin
git checkout main               # U1 is merged; main is the base now
git pull origin main
git checkout -b u2-grimdark
git branch --show-current       # MUST print: u2-grimdark
npm install                     # if node_modules missing
npm run wasm                    # REQUIRED before typecheck/build — src/wasm/pkg/ is gitignored
npm run dev                     # vite on :5173
```

Commit early and often on `u2-grimdark` (conventional commits: `feat:`, `fix:`,
`docs:`; small and scoped). Never merge to `main`, never push `main` — the user
gates merges. Push only `u2-grimdark`.

## Hard laws (violating these fails the milestone)

1. **The Lens is exempt and must be visually unchanged.** The O-key Observatory
   keeps its clinical mono look as deliberate contrast (it is a diegetic
   instrument). Ground truth in your favor: its styles are hard-coded in `main.ts`
   and reference zero `var(--…)` — palette changes in `styles.ts` cannot leak in.
   Verify anyway (acceptance item 10): `#nw-observatory` must compute to
   `rgba(8,8,16,0.95)` bg, `1px rgb(51,51,68)` border, monospace, 8px radius.
2. **The Veil**: any text you touch stays pure fantasy. The only string you change
   is `'Space'` → `'Spc'` (chrome, not fiction). Never introduce network/tech
   vocabulary into player-facing fiction strings.
3. **Zero gameplay changes.** No layout moves, no logic edits, no
   `src/game/systems/*`, no data tables, no canvas/world rendering, no
   `index.html`. Acceptance item 15 checks `git diff --stat` — only `styles.ts`,
   `ui.ts` (3 lines), and docs may appear.
4. **Keep M1's machinery verbatim**: `--scale` sizing with `max()` floors,
   `dvh`/safe-area padding, `[data-touch]`/`[data-narrow]` blocks, `@media`
   compaction, keyboard focus ring (recolor to gold, never remove), dark
   scrollbars (recolor to brass, never remove). Touch targets stay ≥48px.
5. **No image assets, no new dependencies, no fonts.** Everything is CSS
   gradients/shadows + system font stacks. `border-image` is banned (it silently
   kills `border-radius` — the brief's box-shadow ring recipe exists for this
   reason). The only permitted image-like thing is Phase 5's OPTIONAL runtime
   procgen noise data-URI, and only if Phases 1–4 are done and green without it.

## Landmines (each verified against the shipped code — do not re-learn them)

- **`.nw-btn` is used far outside the action bar**: buildbar `‹`/`›`/Cancel,
  top-bar `#nw-mute`/`#nw-newworld` (also `.nw-badge`), the Log export button,
  game-over "Try again". Scope ALL socket rules (fixed width/height, hidden
  label, corner `.k`) to `.nw-actions .nw-btn`, then manually re-check those four
  contexts. This is the #1 way to fail the milestone.
- **`--font-pixel` gets deleted** — all ten consumers live inside `styles.ts`
  itself (verified by grep; nothing else in the repo reads it). Retarget every
  consumer in the same commit (display serif vs body sans per the brief's Phase 1
  list) or the `var()` fallback silently inherits the wrong font.
- **Freebie fix while you're there**: the rule `.nw-logm .res-abbr` is a dead
  selector — `ui.ts` `formatLogMsg()` emits `class="net-abbr"`. Rename the
  selector to `.nw-logm .net-abbr` and give it a hardcoded mono stack (this one
  place keeps mono on purpose).
- **The `[data-touch]` action-bar block currently targets bare `.nw-btn`** —
  after you scope the base slot rules, update the touch block to
  `[data-touch] .nw-actions .nw-btn` so specificity stays unambiguous, and keep
  its right-side vertical-stack layout untouched.
- **`pointer-events` lines are load-bearing**: `.nw-top`/`.nw-actions` are
  `none` with `auto` re-enabled per child. Restyle around them; never delete.
- **DOM IDs are load-bearing for the Gauntlet**: `nw-vigor`, `nw-resolve`,
  `nw-vigor-text`, `nw-resolve-text`, `nw-hp`, `nw-gold`, `nw-clock`, plus panel
  open/close and keyboard nav (Tab/Enter, Ctrl+Tab). Hide the action-bar label
  span with CSS (`display: none`) — do NOT remove the element.
- **Panel clamps are correct today** (`width: min(560px, 96vw)`,
  `max-height: 86dvh`, scrim flex-centering, `.nw-pbody` scroll). Preserve them
  through the restyle, then re-test at 320×400. Do not "fix" positioning that
  isn't broken.
- **Corner brackets need `position: relative` on `.nw-panel`** (it's a flex
  column with `overflow: hidden` — inset-positioned pseudo-elements are safe).
- **Contrast floors**: body ink `#d6cbb4` on `#14100b`; dim ink `#8d8272` is
  already near the 4.5:1 floor — don't darken it further; nothing below 11px.

## Definition of done (from WORKFLOW.md — mandatory)

1. `npm run typecheck` clean, `npm run build` green, `cargo test` (in
   `rust/nightward-core/`) all pass.
2. Full Gauntlet green at `http://localhost:5173/?gl&seed=1234&test` — baseline is
   **45 functions / 228 assertions, all green** (as of `main` @ `cb040a1`). U2
   adds no tests; the bar is that nothing regresses.

   **HARD EVIDENCE GATE — read carefully.** Into the brief's shipped record you
   must paste the **FULL raw console output** of the Gauntlet run: every
   per-test line plus the final summary line, unedited. Prose claims ("45/45
   green", "all passed except…") without the raw paste are treated as **no
   evidence at all** and the milestone as unverified. The last two milestones
   both shipped with fabricated pass claims (one cited failures "documented in
   WORKFLOW.md" that do not exist); both were caught line-by-line in review and
   cost full repair sessions. Your run WILL be independently re-executed
   headlessly (raw-CDP Chrome) by the review pass regardless — the paste is a
   credibility check, not a substitute. If a test fails: fix it or report it
   honestly as failing. An honestly-reported red test is acceptable; a false
   green is not.
3. Walk the brief's 15-item acceptance checklist and record evidence per item.
   For visual items use `window.__nw` DOM probes (computed styles, element
   existence, `getBoundingClientRect`) — screenshots are unreliable in
   headless/background tabs; probes are not. The checklist items are written to
   be probe-friendly (exact computed values to assert).
4. Verify at 320×400 viewport that every panel (Bag, Craft, Skills, Log) opens
   fully on-screen and scrolls, and that `[data-touch]` sockets compute ≥48px.
5. Update `docs/plans/U2-grimdark-chrome.md` with a "shipped" record (changes +
   the pasted Gauntlet output + probe evidence) and the ROADMAP's U2 line. Do
   NOT tag and do NOT merge — stop and report to the user with your evidence.
   Known gaps require user sign-off BEFORE merge, not disclosure after.

## Out of scope — do not touch

Gameplay/balance of any kind, `src/game/systems/*`, the Lens panel's own look
(`main.ts`), panel layout/positions/sizes, new panels or widgets, health-orb
experiments (candidate for a later juice pass — not this milestone), icon
data-URIs (procgen sprites are game content, not chrome), `index.html`, fonts as
files, any npm dependency, anything on `main`, C2 waystones work.
