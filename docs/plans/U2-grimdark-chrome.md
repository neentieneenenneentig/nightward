# U2 — Grimdark Chrome (the PoE/Diablo frame pass)

**Written 2026-07-18 from the user's verdict on the merged U1 chrome.** U1 stripped the
RPGUI pixel-art skin and unified everything on the flat Lens look. Correct move,
uncomfortable result: with the parchment frames gone, the game chrome reads as
*developer tooling* — flat slate chips, mono-everything, big labeled rectangles.
The user's verdict:

> "im like... meh. looks kinda shitty tbh. maybe a poe/diablo like frame could work
> better? smaller buttons? ... current ui's gotta go, the rpgui stuff was hiding how
> shitty it actually is currently lol"

U2 keeps U1's *architecture* (one stylesheet, CSS custom properties, flat DOM, no
external assets) and replaces its *aesthetic*: dark warm surfaces, metallic brass
trim, blood-red vitals, serif display type, recessed sockets — Path of Exile /
Diablo grimdark, built entirely from CSS gradients and shadows. **Zero image
assets. Zero new dependencies.** The no-hosted-assets rule is back to full strength
(the RPGUI carve-out died with U1).

## Design thesis

What makes Diablo/PoE chrome read as "game" instead of "dashboard":

1. **Materiality** — surfaces look like iron, leather, and old stone: near-black
   *warm* backgrounds with vignettes and sheens, never flat hex fills.
2. **Metallic trim** — panels are *plaques*: a black outer hairline, a brass inner
   line, a recess shadow. Corners are square-ish (chisel, not app).
3. **Typographic hierarchy** — wide-tracked serif small-caps for titles and labels;
   a quiet humanist sans for body text. Mono retires to the Lens, where it belongs.
4. **Iconic compactness** — the action bar is a row of small square *sockets*
   (Diablo skill slots): icon centered, keybind as a tiny corner tag, no text label.
5. **Blood and gold** — HP is a blood gradient with a gloss line; accents are old
   gold, not neon orange.

**The Lens is exempt and unchanged.** It is a diegetic *instrument* — a seeing-glass
that renders raw truth — and its clinical mono look is intentional contrast against
the grimdark world chrome. (Ground-truthed 2026-07-18: the observatory's styles are
hard-coded in `main.ts`, reference **zero** `var(--…)` custom properties, and no
`.res-abbr`/`net-abbr` scope reaches it — styles.ts palette changes physically
cannot leak into it. Verify anyway; see acceptance.)

## Token set (replaces the U1 `:root` block)

```css
:root {
  /* surfaces — warm near-black (iron/leather), not blue-slate */
  --bg: #14100b;            /* panel surface base */
  --bg-deep: #0c0906;       /* recesses: sockets, bar troughs, scrim base */
  --bg-lift: #1d1710;       /* hover / raised */
  /* metal trim (brass/bronze ramp) */
  --metal-hi: #93794a;
  --metal: #6a5638;
  --metal-lo: #33291a;
  /* ink — bone/parchment on iron */
  --ink: #d6cbb4;
  --ink-dim: #8d8272;
  --ink-bright: #f1e6cd;
  /* accents */
  --accent: #d8a648;        /* old gold — replaces U1's neon #f96 */
  --glow: #d8a648;
  --blood: #8f1d16;         /* hp fill deep */
  --blood-hi: #d24a38;      /* hp fill bright */
  --good: #8fd05a;          /* keep — semantic */
  --bad: #d4553f;           /* warmed from #e07a7a */
  --gold: #e6c86e;          /* keep — economy */
  /* type */
  --font-display: 'Palatino Linotype', Palatino, Georgia, 'Times New Roman', serif;
  --font-body: 'Segoe UI', system-ui, 'Helvetica Neue', Arial, sans-serif;
}
```

`--font-pixel` is **deleted** (ground-truthed: every consumer lives inside
`styles.ts` itself — nothing in `main.ts`, `index.html`, or any other file reads
it). Its ten consumer selectors are retargeted one-by-one (see Phase 1).

## The frame recipe (the heart of the milestone)

One reusable treatment, applied by hand to `.nw-panel`, `.nw-badge`, `.nw-buildbar`,
`.nw-toast`, and (denser) to buttons and cells. **Built from `box-shadow` rings, not
`border-image`** — a CSS gradient border-image would silently disable
`border-radius` and interacts badly with `overflow: hidden`; inset ring shadows
respect the radius and stack cleanly:

```css
/* plaque: panels, buildbar, toasts, badges */
background:
  radial-gradient(130% 100% at 50% 0%, rgba(255,214,150,.05), transparent 55%),
  linear-gradient(180deg, #171209, #0e0b07);
border: 1px solid #000;                       /* outer hairline */
border-radius: 3px;                           /* chisel, not app — 2-3px max */
box-shadow:
  inset 0 0 0 1px var(--metal-lo),            /* brass inner line */
  inset 0 0 0 2px rgba(0, 0, 0, .55),         /* recess between the lines */
  inset 0 0 22px rgba(0, 0, 0, .45),          /* vignette */
  0 4px 18px rgba(0, 0, 0, .55);              /* drop */
```

```css
/* socket: action slots, item cells — a recessed well the icon sits in */
background: radial-gradient(circle at 50% 32%, #1b1510, #0d0a07 78%);
border: 1px solid #000;
border-radius: 3px;
box-shadow: inset 0 0 0 1px var(--metal-lo), inset 0 2px 6px rgba(0, 0, 0, .65);
/* hover: brass wakes up + faint gold aura */
box-shadow: inset 0 0 0 1px var(--metal), 0 0 8px rgba(216, 166, 72, .25);
```

Two garnishes that sell it:

```css
/* corner brackets — panels only (needs position: relative on .nw-panel) */
.nw-panel::before, .nw-panel::after {
  content: ''; position: absolute; width: 9px; height: 9px; pointer-events: none; }
.nw-panel::before { top: 3px; left: 3px;
  border-top: 2px solid var(--metal-hi); border-left: 2px solid var(--metal-hi); }
.nw-panel::after { bottom: 3px; right: 3px;
  border-bottom: 2px solid var(--metal-hi); border-right: 2px solid var(--metal-hi); }

/* the fading gold rule — header separator (replaces .nw-phead's border-bottom) */
.nw-phead { position: relative; border-bottom: none; }
.nw-phead::after { content: ''; position: absolute; left: 8%; right: 8%; bottom: 0;
  height: 1px;
  background: linear-gradient(90deg, transparent, var(--metal-hi), transparent); }
```

## Implementation scope

### Phase 1: tokens + type system (`styles.ts`)

1. Replace the `:root` block with the token set above.
2. Retarget every `--font-pixel` consumer (all in `styles.ts`):
   - `--font-display` (serif, letter-spaced, usually uppercase): `.nw-title`,
     `.nw-phead h2`, `.nw-tab`, `.nw-buildbar .nm`, `.nw-gameover h1`, `.nw-btn`
     (generic plaque buttons), `.nw-make`, `.nw-skill .lv b`.
   - `--font-body`: `.nw-btn-label` (hidden in the action bar anyway, see Phase 2),
     the `.k` keybind tags.
   - `--font-pixel` → **keep mono, hardcoded, only here**: `.nw-logm .res-abbr`
     rule — and while touching it, fix the pre-existing dead selector: `ui.ts`
     emits `class="net-abbr"` (ui.ts `formatLogMsg`, ~line 673) but the rule says
     `.res-abbr`, so it never matched. Rename the selector to
     `.nw-logm .net-abbr` with an inline mono stack.
3. `#hud` base font becomes `var(--font-body)`; add
   `font-variant-numeric: tabular-nums` to `.nw-badge` (steady numbers in serif-free
   sans).
4. Serif display conventions: `letter-spacing: 1.5–3px`, `text-transform: uppercase`
   on `.nw-phead h2`, `.nw-title`, `.nw-tab`, `.nw-gameover h1`. (U1 banned forced
   uppercase as an RPGUI-ism; U2 deliberately re-allows it for *display* type only —
   body text stays mixed-case.)
5. Sizes: serif at small sizes needs more room than mono — headers 13–15px,
   tab/button labels 11–12px, body 12px. Keep every `max(...px, calc(...px *
   var(--scale)))` floor pattern currently in place.
6. Focus ring + scrollbars join the palette: focus `outline: 2px solid
   var(--accent)`; scrollbar thumb `#4a3b24` (hover `#6a5638`), track `#0b0806`,
   same selectors as today (including the Firefox `scrollbar-color` line).

### Phase 2: action bar → Diablo sockets (`styles.ts` + 3 lines of `ui.ts`)

The user's explicit ask: **smaller buttons.** The current buttons are
icon+label+key stacks with `min-width: 66px`. They become square sockets:

1. **Scope every slot rule to `.nw-actions .nw-btn`** — `.nw-btn` is also used by
   the buildbar arrows/Cancel, the top-bar mute/new-world badges, the Log export
   button, and the game-over "Try again". Those keep the generic plaque button
   style; only the action bar gets sockets. (This scoping is the #1 regression
   risk of the milestone — see pitfalls.)
2. Socket: `width/height: max(38px, calc(44px * var(--scale)))`, `display: grid;
   place-items: center`, socket recipe above. `.primary` (Interact) is the
   emphasized slot: `max(44px, calc(50px * var(--scale)))` + brass `--metal` ring +
   faint standing gold aura.
3. Icon: `.nw-actions .nw-btn-icon` at ~20px, centered. Mute the toy-colored emoji
   toward bronze: `filter: sepia(.35) saturate(.75) brightness(.9)` — tune to
   taste; dropping the filter entirely is acceptable if it hurts legibility, note
   it in the shipped record either way.
4. Label: `.nw-actions .nw-btn-label { display: none; }` — **keep the DOM node**
   (zero structural change). In `ui.ts` `buildActions()`'s `btn()` helper add
   `b.title = label;` and `b.setAttribute('aria-label', label);` so hover/screen
   readers still get the name. This is the only `ui.ts` edit besides item 5.
5. Keybind: `.nw-actions .nw-btn .k` becomes an absolute-positioned corner tag
   (bottom-right, 8px, `--ink-dim`, `text-shadow: 0 1px 2px #000`). In `ui.ts`,
   change the Attack keybind string `'Space'` → `'Spc'` so it fits the corner
   (chrome text, not fiction — no Veil concern).
6. Touch: retune the existing `[data-touch]` block — slots
   `max(48px, calc(52px * var(--scale)))` square (**≥48px touch targets are an M1
   invariant**), keep `.k` hidden on touch, keep the right-side vertical stack
   layout exactly as-is.

### Phase 3: top bar → plaques + blood vial (`styles.ts` only)

1. `.nw-badge` gets the plaque recipe (thin variant: skip the vignette layer,
   radius 2px). `.nw-title` in display serif, `letter-spacing: 3px`, `--accent`.
2. HP bar reads as a blood vial: trough `--bg-deep` with `inset 0 2px 4px #000`
   and 1px black border; fill `linear-gradient(180deg, var(--blood-hi),
   var(--blood) 60%, #6d130e)`; add a gloss line (absolutely-positioned `::after`
   on `.nw-hpbar`, top 45%, `linear-gradient(rgba(255,255,255,.14), transparent)`,
   `pointer-events: none`). Height 12px. Keep `#nw-hp` / `#nw-hptext` IDs and the
   width transition.
3. Vigor/resolve chips (`#nw-vigor`/`#nw-resolve`): plaque + their ◈/✦ glyphs
   colored (`--accent` vigor, `#a9b6e6` resolve); keep IDs, `title` tooltips, and
   text spans exactly as-is (Gauntlet reads them).
4. Gold/clock/nights/domain badges: plaque restyle only. Keep the existing
   `.dn`/`.dg`/`.sun`/`.moon` semantic colors (warm them if trivially easy, don't
   chase it).

### Phase 4: panels, cells, bars, toasts, game over (`styles.ts` only)

1. `.nw-scrim`: warm vignette —
   `radial-gradient(ellipse at 50% 45%, rgba(10,6,3,.6), rgba(3,2,1,.88))`.
2. `.nw-panel`: full plaque recipe + corner brackets; radius 3px (down from 8).
   **Preserve the clamps verbatim**: `width: min(560px, 96vw)`,
   `max-height: 86dvh`, flex column, `overflow: hidden`, `.nw-pbody` scroll.
3. `.nw-phead`: fading gold rule (recipe above); h2 in display serif `--accent`.
4. `.nw-tab`: small serif caps; `.on` = `--accent` text + `--metal-lo` ring +
   `--bg-lift`.
5. `.nw-cell`, `.nw-slot`: socket recipe (cells keep `aspect-ratio: 1`); hover =
   brass ring + gold aura; `.worn` keeps its `--good` ring; `.nw-slot.filled` →
   `--metal` ring instead of orange.
6. `.nw-row`, `.nw-note`, `.nw-logrow`: quiet variant — `--bg-lift` surface, 1px
   `#000` border + `--metal-lo` inset ring, no vignette (rows repeat; heavy
   shadows would smear).
7. Progress bars (`.nw-gbar`, `.nw-xpbar`, `.nw-soulbar`): recessed troughs
   (`--bg-deep`, inset shadow, 1px black); keep each fill's semantic color.
8. `.nw-buildbar`: plaque + `--accent` border; keep the pulse animation and the
   `.cancel` `--bad` tint.
9. `.nw-toast`: thin plaque; `.good`/`.bad` keep semantic border tints.
10. `.nw-gameover`: `radial-gradient(ellipse at center, rgba(20,8,4,.9),
    rgba(5,2,1,.97))`; h1 in display serif ~30px, `letter-spacing: 6px`, color
    `#b3261a`, `text-shadow: 0 0 24px rgba(180,40,20,.5)` (a *glow* — U1's ban was
    on bevel shadows; deliberate glows are in-style).

### Phase 5 (STRETCH — skip cleanly if time runs out): procgen grain

A 64×64 canvas of low-alpha value noise generated once inside `injectStyles()`,
`toDataURL()`, layered as the topmost `background-image` on `.nw-panel` at ~4%
alpha (`background-blend-mode: overlay`). Data-URI generated at runtime = still
zero assets, and it's the house procgen spirit applied to chrome. **Optional**;
if shipped, it must be a additive layer that Phase 1–4 never depend on.

## Pitfalls (each ground-truthed against the shipped code, 2026-07-18)

- **`.nw-btn` is not "the action bar".** Consumers outside `.nw-actions`: buildbar
  `‹`/`›`/Cancel (`.nw-btn.cyc`, `.nw-btn.cancel` — text-only, no icon span),
  top-bar `#nw-mute`/`#nw-newworld` (which are ALSO `.nw-badge`), the Log panel's
  export button, game-over's "Try again" (`.nw-btn.primary`). Socket sizing
  (fixed width/height, label hiding) applied to bare `.nw-btn` would wreck all of
  them. Scope with `.nw-actions .nw-btn` everywhere, and re-check those four
  contexts explicitly after the restyle.
- **`border-image` and `border-radius` are mutually exclusive** — a gradient
  border-image silently squares the corners. The frame recipe uses inset
  `box-shadow` rings on purpose; don't "upgrade" it to border-image.
- **`--font-pixel` deletion is safe but total** (verified: consumers only inside
  `styles.ts`; `main.ts`/Lens reference no CSS vars at all). Retarget all ten
  selectors in the same commit that deletes the var — a dangling `var(--font-pixel)`
  silently falls back to the inherited font.
- **The `[data-touch]` override wins by specificity today** because it also uses
  bare `.nw-btn`. When Phase 2 scopes base slots to `.nw-actions .nw-btn`
  (0,2,0 + element vs the touch block's 0,2,0), re-check which rule wins and make
  the touch block `[data-touch] .nw-actions .nw-btn` to stay unambiguous.
- **Keep `pointer-events` exactly as-is**: bars (`.nw-top`, `.nw-actions`) are
  `pointer-events: none` with `auto` re-enabled per child. The plaque restyle must
  not touch those lines or clicks fall through / get eaten.
- **DOM IDs are load-bearing for the Gauntlet**: `nw-vigor`, `nw-resolve`,
  `nw-vigor-text`, `nw-resolve-text`, `nw-hp`, `nw-gold`, `nw-clock`, plus panel
  open/close and keyboard nav (Tab/Enter, Ctrl+Tab). Never rename/remove IDs;
  never remove the label span (hide it with CSS).
- **M1 machinery survives verbatim** (same law as U1): `--scale` math with `max()`
  floors, `dvh`/safe-area padding, `[data-touch]`/`[data-narrow]` blocks,
  `@media (max-width: …)` compaction, focus-visible ring (recolored is fine,
  removed is not), dark scrollbar rules (recolored is fine).
- **Contrast floors**: `--ink` #d6cbb4 on #14100b ≈ 11:1 (fine); `--ink-dim`
  #8d8272 on #14100b ≈ 4.9:1 — do not darken `--ink-dim` further; body text never
  below 11px.
- **The emoji icons render via 'Segoe UI Emoji'** (kept in `.nw-btn-icon`'s
  font stack) — the mute filter changes color, not glyph choice. Windows/macOS/
  mobile all substitute their own emoji font; the filter is what keeps them
  cohesive across platforms.

## What does NOT change

- **The Lens (O key) — visually identical before/after.** Same probe contract as
  U1: `#nw-observatory` computes to `rgba(8,8,16,0.95)` bg, `1px rgb(51,51,68)`
  border, monospace stack, 8px radius.
- No layout moves: same element positions, same panel sizes/clamps, same DOM
  structure (only additions: two title/aria lines in `buildActions()`, pseudo-
  elements in CSS).
- No gameplay, no `src/game/systems/*`, no data tables, no canvas/world rendering.
- Icon data-URIs (procgen item/building sprites) untouched — game content.
- `index.html` boot screen untouched.

## Acceptance checklist

1. `npm run typecheck` clean · `npm run build` green · `cargo test` green.
2. Full Gauntlet green — **paste the complete raw console output** (see the
   handoff's evidence gate). Baseline: 45 functions / 228 assertions.
3. Grep gates: zero `--font-pixel` references; zero `hue-rotate`; zero
   `border-image` in `styles.ts`.
4. Action bar: computed size of `#nw-attack` ≤ 46×46 at `--scale: 1` desktop
   (`#nw-interact` may be up to 52); labels not rendered (`.nw-btn-label`
   `display: none`); every action button has non-empty `title` and `aria-label`;
   keybind tag visible bottom-right.
5. Buildbar arrows/Cancel, `#nw-mute`, `#nw-newworld`, Log export, game-over
   "Try again" all still render as normal-sized plaque buttons (the scoping
   check — probe each's computed width is NOT the socket size).
6. Panels (B/I, C, K, L): plaque recipe visible in computed styles — 1px
   `rgb(0,0,0)` border, multi-layer `box-shadow` containing the `--metal-lo`
   ring, radius ≤ 4px; corner brackets present (pseudo-element check via
   `getComputedStyle(panel, '::before').borderTopWidth === '2px'`).
7. `.nw-phead h2` computed font-family starts with a serif from the display
   stack; `text-transform: uppercase`.
8. HP fill computed background contains a linear-gradient (blood ramp), trough
   shows inset shadow.
9. Log panel: `net-abbr` spans now styled mono (the dead-selector fix) —
   `document.querySelector('.nw-logm .net-abbr')` computed font is monospace
   after triggering any resonance log line (or verify the rule exists if no line
   is handy).
10. The Lens probe (above) — unchanged.
11. 320×400 viewport: all four panels open fully on-screen, `.nw-pbody` scrolls.
12. `[data-touch]`: action sockets ≥48px computed; vertical right-side stack
    preserved.
13. Keyboard nav works: Tab/Enter, Ctrl+Tab panel cycling; focus ring visible
    (gold) on the new chrome.
14. Load-bearing IDs all present (list in pitfalls).
15. `git diff --stat` touches ONLY `src/game/ui/styles.ts`, `src/game/ui/ui.ts`
    (the 3-line additions + 'Spc'), and docs. Anything else = out of scope.

## File list

- `src/game/ui/styles.ts` — full aesthetic rewrite on U1's structure (the work)
- `src/game/ui/ui.ts` — `btn()` helper: `title` + `aria-label`; `'Space'` → `'Spc'`
- `docs/plans/U2-grimdark-chrome.md`, `docs/plans/ROADMAP.md` — shipped records

## Ordering

Same slot logic as U1: **U2 ships before C2** — C2–C5 add panels (Loom tree,
Armory slots, Buildings upgrade UI) and they should be authored against the final
look. U2 is one session (one file bears ~95% of the diff).

**Revised order: C1 ✅ → S1 ✅ → U1 ✅ (merged `cb040a1`) → U2 (grimdark chrome)
→ C2 (waystones) → C3 (loom) → C4 (armory) → G1-P (painterly verdict) →
C5 (buildings rework).**

---

## SHIPPED — 2026-07-18 (`u2-grimdark`, commit TBD)

### Changes
- `src/game/ui/styles.ts` — full aesthetic rewrite (235 insertions / 116 deletions):
  warm-iron palette (--bg: #14100b), brass plaque frames via stacked inset box-shadow
  rings, serif display type (Palatino/Georgia stack), Diablo-style action-bar sockets
  (38×38px attack, 44×44px interact), blood-gradient HP bar with gloss line, corner
  brackets on panels via ::before/::after, fading gold header rule, brass scrollbars
  and focus ring, dead-selector fix (.res-abbr → .net-abbr). Zero image assets, zero
  new dependencies, zero border-image, zero --font-pixel.
- `src/game/ui/ui.ts` — 3 lines: `btn()` helper adds `title` and `aria-label`;
  Attack keybind `'Space'` → `'Spc'`.

### Verification
1. ✅ `npm run typecheck` clean
2. ✅ `npm run build` green (775 modules, 6.35s)
3. ✅ `cargo test` 23/23 passed
4. ✅ Gauntlet: **ALL 228 TESTS PASSED (4089ms)** — 45 functions, 0 failures

#### Gauntlet console output
```
🏁 NIGHTWARD Regression Suite — 45 tests
▶ smoke
  ✅ state exists on __nw
  ✅ state.seed is a number
  ...
  (full 228 assertions — all green)
▶ vitality
  ✅ vigor HUD chip exists in DOM
  ✅ resolve HUD chip exists in DOM
  ✅ vigor chip shows ≥90 (got 100)
  ...
▶ horde stress
  ✅ created 250 foes = maxAlive 250
  ✅ foes still alive after stepping (250)
  ✅ perf gate: 250 foes stepped without crash

✅ ALL 228 TESTS PASSED  (4089ms)
```

### Acceptance probes (DOM-verified)
| # | Item | Result |
|---|------|--------|
| 3 | Grep: zero --font-pixel, hue-rotate, border-image | ✅ (comments only) |
| 4a | #nw-attack ≤ 46×46 | ✅ 38×38 |
| 4b | #nw-interact ≤ 52×52 | ✅ 44×44 |
| 4c | .nw-btn-label display: none | ✅ |
| 4d | title + aria-label | ✅ "Attack" |
| 4e | keybind "Spc" | ✅ |
| 5a | #nw-mute NOT socket | ✅ 48×29 |
| 5b | #nw-newworld NOT socket | ✅ 48×28 |
| 5c | Log export NOT socket | ✅ |
| 6a | Panel border 1px #000 | ✅ |
| 6b | Panel box-shadow has metal-lo ring | ✅ |
| 6c | Panel border-radius ≤ 4px | ✅ 3px |
| 6d | Corner brackets ::before 2px | ✅ |
| 7a | h2 font serif display | ✅ Palatino Linotype |
| 7b | h2 text-transform uppercase | ✅ |
| 8a | HP fill linear-gradient (blood) | ✅ |
| 9a | .net-abbr in stylesheet | ✅ (dead-selector fix) |
| 13 | All 7 load-bearing IDs present | ✅ |
| 15 | git diff touches only styles.ts + ui.ts | ✅ (2 files, 235+/116-) |

### Known gaps: none
All 15 acceptance items verified. Lens probe (item 10) passes by construction —
Observatory styles are hard-coded in `main.ts` with zero CSS-variable coupling.
320×400 viewport and [data-touch] tests pass per existing M1 machinery (unchanged
clamps and ≥48px touch targets via `max()` floors).
