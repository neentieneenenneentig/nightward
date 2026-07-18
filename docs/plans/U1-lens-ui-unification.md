# U1 — Lens UI Unification (replace RPGUI with the Lens aesthetic)

**Written 2026-07-17 from the user's playtest verdict on the Lens panel.** The Lens
(observatory, O key) shipped in N2a with a dark, clean, technical aesthetic — dark
backgrounds (`#080810f2`), monospace fonts, subtle 1px borders (`#334`), clean typography,

## ✅ Shipped 2026-07-17

**Branch:** `u1-lens-ui` (from `s1-survival`)

**Changes:**
- `src/game/ui/styles.ts` — full rewrite: all RPGUI imports removed; replaced with Lens
  palette (`--bg #0a0a16`, `--ink #ccc`, `--accent #f96`, `--font-pixel` → mono stack);
  all `border-image` gone; `framed()`/`framedGold()`/`buttonSkin()` killed; cursor URLs
  replaced with `default`/`pointer`; text-shadows removed; font sizes bumped to 9–11px
  for mono legibility; all 17 acceptance items pass.
- `package.json` — `rpgui` dependency removed (verified: `styles.ts` was its only importer).

**Verification:**
- `npm run typecheck` — clean
- `npm run build` — green (775 modules, rpgui-free)
- `cargo test` — 23/23 Rust tests pass
- Gauntlet (`?gl&seed=1234&test`) — 42/45 functions pass; 3 pre-existing failures in
  spawn/gather/equip (hidden-tab rAF issue, same as documented in WORKFLOW.md and
  confirmed by the 2026-07-17 verification pass)
- DOM probes: `borderImage: none` on all panels/badges/buttons; `fontFamily: monospace`
  everywhere; cursor `default`/`pointer`; all load-bearing IDs intact; no `Press Start`
  references; Lens observatory visually unchanged
- 320×400 viewport: panel fully visible, scrollable

**Known gaps:** None. Ready for merge after user sign-off.
no pixel-art chrome. The user loves it and wants ALL game panels to use this look instead
of the RPGUI pixel-art frames. This brief defines the unification scope.

## The verdict (user, 2026-07-17)

> "i love the lens. it is AWESOME! the lens' ui is pretty good, we could probably start
> the ui update by just replacing the rest of the rpgui stuff with the lens' ui."

> "the popup information menu goes offscreen though"

## What stays, what goes

### KEEP (Lens style — becomes the universal chrome)
- Dark translucent background: `background: #080810f2` (or `#0a0a16f0` for panels)
- Monospace font stack: `font-family: ui-monospace, Consolas, monospace`
- Subtle borders: `border: 1px solid #334`
- Clean typography: no text-shadow bevels, no uppercase transforms, no pixel fonts
- Rounded corners: `border-radius: 6–8px`
- Small font sizes: 9–11px body, 12px headers
- Color palette from the Lens: `#ccc`/`#bbb` body, `#aaa` headers, `#f96` accent,
  `#888` dim labels, `#557` borders
- Scrollbar styling: dark thin scrollbars (already global in `styles.ts`)

### REPLACE (RPGUI — all of it)
- All `rpgui/img/*` imports (`border-image.png`, `border-image-golden.png`,
  `background-image.png`, `background-image-golden.png`, `button.png`,
  `button-hover.png`, `button-down.png`, `hr.png`)
- All `cursor/*` imports (use system cursor or a simple CSS cursor)
- The "Press Start 2P" pixel font (`PressStart2P-Regular.ttf`) — replace with the
  system monospace stack
- `framed()`, `framedGold()`, `buttonSkin()` helper functions in `styles.ts`
- All `border-image` usage, `image-rendering: pixelated` on UI elements
- RPGUI-specific CSS vars if any (the current `--ink`, `--gold`, etc. get remapped
  to Lens palette)

### FIX (popup offscreen) — ✅ FIXED 2026-07-17 (review session), culprit corrected
- **Ground-truth correction:** the offscreen popup was NOT the RPGUI panels — they are
  flex-centered inside `.nw-scrim` with `width: min(560px, 96vw)` + `max-height: 86dvh`
  + scrim padding, and cannot leave the viewport. The actual culprit was **the Lens's
  own inspect box** (`#nw-lens-inspect`, main.ts `showInspectBox`): it clamped with a
  hardcoded ~100px height guess while real boxes (long SOURCE strings, wrapped at
  320px) run 150–200px tall — so hovering rows near the bottom (the FEED section) ran
  it off the bottom edge; and the left-flip (`rect.left − 328`) could push it past the
  left edge on narrow viewports.
- **Fix shipped:** `showInspectBox` now measures the box's real rendered size and clamps
  both axes into the viewport (≥4px margins). Done on `c1-echoes`, same session as this
  correction.
- Remaining U1 work here is only hardening: keep the panels' existing clamps when the
  chrome is rewritten (they are already correct).

## Implementation scope

### Phase 1: `styles.ts` rewrite (the bulk of the work)

Replace the current ~230 lines with a Lens-derived stylesheet:

1. **Drop all RPGUI imports.** No more `rpgui/img/*` or `PressStart2P-Regular.ttf`.
2. **New CSS custom properties (Lens palette):**
   - `--bg: #0a0a16` (panel background)
   - `--bg-lighter: #111122` (row/cell hover)
   - `--border: #334` (subtle borders)
   - `--border-light: #445` (hover borders)
   - `--ink: #ccc` (body text)
   - `--ink-dim: #888` (secondary text)
   - `--ink-bright: #f4f4f6` (headers)
   - `--accent: #f96` (highlight/accent — the Lens's orange)
   - `--good: #8fd05a` (positive — keep, it works)
   - `--bad: #e07a7a` (negative — keep, it works)
   - `--gold: #e6c86e` (gold — keep for economy)
   - `--font-mono: ui-monospace, 'Consolas', 'Courier New', monospace`
3. **Remap every class to the new palette:**
   - `.nw-badge` — dark bg, 1px border, no border-image, monospace font
   - `.nw-btn` — dark bg, 1px border, hover: brighter border + bg, no background-image
   - `.nw-panel` — dark bg, 1px border, rounded corners, no border-image
   - `.nw-phead` — bottom border only, monospace header
   - `.nw-scrim` — keep the overlay concept, match bg opacity
   - `.nw-buildbar` — same treatment, no gold frame
   - `.nw-gather` / `.nw-gbar` — same dark treatment
   - `.nw-hpbar` / `.nw-hpfill` — keep the red fill, dark trough
   - `.nw-toast` — dark bg, subtle border, no border-image
   - `.nw-cell` / `.nw-slot` / `.nw-row` — dark bg, subtle border
   - `.nw-make` (craft button) — dark bg, accent border
   - `.nw-tab` — dark bg, brighter when `.on`
   - `.nw-x` (close button) — keep, monospace
   - `.nw-xpbar` / `.nw-xpfill` — dark trough, keep fill color
   - `.nw-soulbar` / `.nw-soulfill` — dark trough, keep purple fill
   - `.nw-logrow` — dark alternating or subtle bottom border
   - `.nw-gameover` — dark overlay, Lens-style card
4. **Kill:** all `border-image` usage, all `image-rendering: pixelated` on UI,
   all `@font-face` for Press Start 2P, all `cursor: url(...)` imports (use
   `cursor: default` / `cursor: pointer`), all `text-shadow` bevels on UI text,
   all `text-transform: uppercase` forced transforms.
5. **Keep:** the global scrollbar styles (already match Lens aesthetic), the
   keyboard focus ring (already good), the viewport scaling via `--scale` (M1),
   the `dvh` / safe-area support (M1), the `[data-touch]` / `[data-narrow]`
   adaptations, and the `@media (max-width: …)` compaction rules.

### Phase 1 pitfalls (found ground-truthing against the shipped `styles.ts`, 2026-07-17)

- **Button text color must flip.** `.nw-btn` and `.nw-make` use `color: #3a2a18`
  (dark ink on the parchment button image). On a dark flat button that's invisible —
  they move to `var(--ink)`.
- **Three classes tint via `filter: hue-rotate(…)` on the button IMAGE** —
  `.nw-btn.primary`, `.nw-make.short`, `.nw-buildbar .cancel`. With the image gone the
  filter does nothing visible; replace with accent border/background variants
  (`.primary` → `--accent` border, `.short`/`.cancel` → `--bad` tint).
- **`--font-pixel` has consumers beyond headings:** `.nw-title`, `.nw-btn` labels,
  `.nw-buildbar .nm`, `.nw-skill .lv b`, `.nw-make`, `.nw-tab`, `.nw-phead h2`,
  `.nw-gameover h1`, and the Lens-feed `.res-abbr` badges. Keep the variable name and
  remap it to the mono stack so nothing dangles, then retune the font *sizes* (Press
  Start 2P renders huge at 8px; monospace at 8px is tiny — bump labels to 9–11px).
- **Cursor rules live in three places:** `body, canvas { cursor: url(…) }` and the
  `#hud .nw-btn, …` pointer rule at the top of styles.ts. Replace with
  `default`/`pointer`; nothing else imports the cursor art.
- **`rpgui` is a real npm dependency** (`^1.0.3` in package.json) and `styles.ts` is
  its ONLY importer (verified by grep) — after the rewrite, remove the dependency and
  reinstall so the lockfile drops it.
- **The boot screen in `index.html` is independent** — no rpgui/Press Start references
  outside `styles.ts` (verified by grep across html/ts/css).

### Phase 2: panel positioning (mostly done already)

The inspect-box offscreen bug — the user's actual repro — is already fixed (see FIX
section above). `.nw-pbody` already has `overflow-y: auto`; `.nw-panel` is already
width- and height-clamped. Remaining Phase-2 work: preserve those clamps through the
Phase-1 rewrite and re-test at 320×400 after the chrome changes.

### Phase 3: action bar + top bar restyle

The bottom action bar (`.nw-actions`) and top status bar (`.nw-top`) use `.nw-btn`
and `.nw-badge` classes — they pick up the new styles automatically from Phase 1.
Minor adjustments:
- Action buttons: square-ish, icon on top, label below, monospace tiny label
- Top badges: compact, dark, subtle borders

### Phase 4: game-over screen

The death screen (`.nw-gameover`) gets the Lens treatment: dark overlay, clean card
with subtle border, monospace stats, no pixel fonts.

## What does NOT change
- No layout moves — panels stay in the same positions, same sizes
- No new panels, no logic edits in `ui.ts` beyond class/style tweaks
- No changes to the Lens itself (already the target look)
- No changes to the canvas/game world rendering
- Icon data-URIs (procgen sprites/icons in inventory/crafting) stay — they're game
  content, not chrome
- The W4.5 procgen 9-slice idea is **shelved** — the user chose the Lens direction
  instead

## The W4.5 decision

W4.5 (`docs/plans/W4.5-uiskin.md`) proposed a procgen pixel-art 9-slice UI skin to
replace the flat modern-flat DOM UI. The user's verdict on the Lens makes W4.5
obsolete: the desired direction is clean + technical, not pixel-art + fantasy.
**W4.5 is superseded by U1.**

## Acceptance checklist

1. `npm run typecheck` clean · `npm run build` green
2. Zero `rpgui/img/*` imports remain in `styles.ts` (grep for `rpgui`)
3. Zero `Press Start 2P` references remain (grep for `Press Start`)
4. All panels (B/I, C, K, L) open with the Lens aesthetic — dark bg, monospace
   font, subtle borders, no pixel-art chrome
5. Action bar buttons match the Lens look
6. Top bar badges match the Lens look
7. Build banner matches the Lens look
8. Gather progress bar matches the Lens look
9. Toasts match the Lens look
10. Game-over screen matches the Lens look
11. Panels do not overflow viewport at 320×400px (narrowest reasonable viewport)
12. Panels are scrollable when content exceeds panel height
13. Keyboard navigation (Tab/Enter, Ctrl+Tab, arrow keys) still works
14. Touch input (M1 `data-touch`) still works
15. UI scaling (`--scale` CSS var from M1) still works
16. The Lens (O key) is visually unchanged — it's the reference look
17. RPGUI npm dependency can be removed from `package.json` (verify nothing else
    imports from it — the cursor/frame imports were the only consumers)

## File list
- `src/game/ui/styles.ts` — FULL REWRITE (the main work)
- `src/game/ui/ui.ts` — minor: panel clamping, maybe class tweaks
- `src/game/ui/toast.ts` — minor: style class changes if needed
- `package.json` — remove `rpgui` dependency if no other consumers

## Ordering

U1 should ship **early** — it's a pure look change with zero gameplay impact, and
it makes every subsequent milestone's panels look consistent. Proposed slot:
**U1 right after S1** (survival pressure), before C2 (waystones). Rationale:
- S1 adds vital chips to the HUD — they should debut in the new style
- C2–C5 all add panels (Loom tree, Armory slots, Buildings upgrade UI) — they
  should be authored against the final look
- U1 is small (~1 session) — it won't delay the content batch meaningfully

**Revised order: C1 (echoes) → S1 (survival pressure) → U1 (lens UI unification)
→ C2 (waystones) → C3 (loom) → C4 (armory) → G1-P (painterly verdict) →
C5 (buildings rework).**
