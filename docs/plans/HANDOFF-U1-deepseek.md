# Handoff prompt — implement U1 "Lens UI Unification"

*(Paste everything below this line into the implementing model. Written 2026-07-17.)*

---

You are implementing a milestone in **NIGHTWARD**, a browser territory-RPG (PixiJS v8 +
TypeScript + Vite, with a Rust→WebAssembly world core). Core identity: "RuneScape ×
Vampire Survivors × network monitoring" — the player's real internet connection drives
game parameters through data-table mappings. All game art is 100% procedurally
generated. There is **no persistence** — closing the tab deletes the character, by
design. Never add save/load.

## Your task

Implement milestone **U1 — Lens UI Unification** exactly per the brief at
`docs/plans/U1-lens-ui-unification.md`. Read that file first, in full. It is a **pure
chrome swap**: the RPGUI pixel-art skin (border-images, Press Start 2P font, cursor
art) is replaced everywhere by the Lens aesthetic (dark translucent panels, monospace
stack, 1px `#334` borders) that already ships in the O-key Observatory. The brief's
"Phase 1 pitfalls" section was ground-truthed against the shipped `styles.ts` — every
item in it is real; treat it as binding. Also read `docs/plans/WORKFLOW.md` (process
rules) and skim the direction-update block in `docs/plans/ROADMAP.md` (context).

## Setup — STEP ZERO, before any code

The previous milestone's implementer skipped the branch instructions and left all work
uncommitted on the wrong branch. Do not repeat this. Run these commands FIRST and
verify the output of the last one says `u1-lens-ui` before touching any file:

```
git fetch origin
git checkout s1-survival        # U1 builds on S1 — the vigor/resolve HUD chips it
git checkout -b u1-lens-ui      # restyles live there, NOT on main
git branch --show-current       # MUST print: u1-lens-ui
npm install                     # if node_modules missing
npm run wasm                    # REQUIRED before typecheck/build — src/wasm/pkg/ is gitignored
npm run dev                     # vite on :5173
```

Commit early and often on `u1-lens-ui` (conventional commits: `feat:`, `fix:`,
`docs:`; small and scoped). Never merge to `main`, never push `main`, never commit to
`s1-survival` or `c1-echoes` — the user gates merges. Push only `u1-lens-ui`.

## Hard laws (violating these fails the milestone)

1. **The Lens is the reference, not a target.** The O-key Observatory panel must be
   **visually unchanged** when you're done (acceptance item 16). You are copying its
   look outward, not editing it. Careful: remapping shared CSS vars (`--font-pixel`)
   touches Lens-feed elements like `.res-abbr` — keep the variable *name*, remap its
   value to the mono stack, and verify the Lens still renders identically.
2. **The Veil**: any text you touch stays pure fantasy — vigor, resolve, Watchfire,
   beacon, echo, resonance, thread, rift, realm. Never introduce network/UI-tech
   vocabulary into player-facing fiction strings.
3. **Zero gameplay changes.** No layout moves, no new panels, no logic edits in
   `ui.ts` beyond class/style tweaks, no canvas/world rendering changes, no CFG or
   data-table changes. If you find yourself editing a system file under
   `src/game/systems/`, stop — you are out of scope.
4. **Keep M1's machinery**: the `--scale` viewport scaling, `dvh`/safe-area support,
   `[data-touch]`/`[data-narrow]` adaptations, `@media` compaction rules, keyboard
   focus ring, and the global scrollbar styles all survive the rewrite untouched.

## Landmines (each verified against the shipped code — do not re-learn them)

- **Button ink is dark-on-parchment today.** `.nw-btn` and `.nw-make` use
  `color: #3a2a18` — invisible on a dark flat button. They move to `var(--ink)`.
- **Three classes tint via `filter: hue-rotate(…)` on the button IMAGE** —
  `.nw-btn.primary`, `.nw-make.short`, `.nw-buildbar .cancel`. With the image gone the
  filter does nothing; replace with variants (`.primary` → `--accent` border,
  `.short`/`.cancel` → `--bad` tint).
- **`--font-pixel` has many consumers**: `.nw-title`, `.nw-btn` labels,
  `.nw-buildbar .nm`, `.nw-skill .lv b`, `.nw-make`, `.nw-tab`, `.nw-phead h2`,
  `.nw-gameover h1`, and the Lens `.res-abbr` badges. Keep the var, remap the value,
  then retune SIZES: Press Start 2P renders huge at 8px, monospace at 8px is tiny —
  bump labels to 9–11px.
- **Cursor rules live in three places** (`body, canvas` url cursors + the `#hud`
  pointer rule at the top of `styles.ts`). Replace with `default`/`pointer`; nothing
  else imports the cursor art.
- **`rpgui` is a real npm dependency** (`^1.0.3`) and `styles.ts` is its only importer
  (verified by grep). After the rewrite: remove it from `package.json` and reinstall
  so the lockfile drops it. The `index.html` boot screen is independent — no rpgui or
  Press Start references exist outside `styles.ts` (verified).
- **DOM IDs are load-bearing for the Gauntlet.** `testVitalsHUD` reads `#nw-vigor`,
  `#nw-resolve`, `#nw-vigor-text`; other tests query panel elements and drive
  keyboard nav (Tab/Enter, Ctrl+Tab). Restyle classes freely; never rename or remove
  an element ID, and never break tab-focusability of interactive elements.
- **The panels' viewport clamps are already correct** (`width: min(560px, 96vw)`,
  `max-height: 86dvh`, scrim flex-centering; the Lens inspect box got real-size
  clamping in the review session). Your job is to *preserve* those clamps through the
  rewrite, then re-test at 320×400. Do not "fix" positioning that isn't broken.

## Definition of done (from WORKFLOW.md — mandatory)

1. `npm run typecheck` clean, `npm run build` green, `cargo test` (in
   `rust/nightward-core/`) all pass. Build must succeed AFTER the rpgui dependency is
   removed — that's the proof nothing else imported it.
2. Full Gauntlet green at `http://localhost:5173/?gl&seed=1234&test` — the suite is
   currently **45 functions / 228 assertions, all green**. U1 adds no new tests; the
   bar is that **nothing regresses**. Paste the ACTUAL console output into your
   session record — the previous milestone's "all green" claim was audited
   line-by-line and found false, which cost a full repair session. Claims without
   pasted evidence will be treated as failures.
3. Walk the brief's 17-item acceptance checklist. For the visual items, capture
   evidence via `window.__nw` DOM probes (computed styles, element existence) — e.g.
   `getComputedStyle(document.querySelector('.nw-panel')).borderImage` must be
   `none`, `fontFamily` must not contain `Press Start`. Screenshots are unreliable
   in headless/background tabs; probes are not.
4. Verify at 320×400 viewport that every panel (Bag, Craft, Skills, Log) opens fully
   on-screen and scrolls (items 11–12).
5. Update `docs/plans/U1-lens-ui-unification.md` with a short "shipped" record and
   the ROADMAP's U1 line. Do NOT tag and do NOT merge — stop and report to the user
   with your evidence. Known gaps require user sign-off BEFORE merge, not disclosure
   after.

## Out of scope — do not touch

Gameplay/balance of any kind, `src/game/systems/*` (except zero-diff), the Lens
panel's own look, panel layout/positions, new panels or widgets, the W4.5 procgen
9-slice idea (superseded), icon data-URIs (procgen sprites are game content, not
chrome), anything on `main`, C2 waystones work.
