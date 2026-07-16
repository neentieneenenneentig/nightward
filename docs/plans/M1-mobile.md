# M1 — Mobile Responsiveness & Touch Controls

**Status**: done ✅ — dynamic scaling, icon/label split, touch layout, font floors all implemented 2026-07-16.  
**Prereq**: none (standalone UX pass)  
**Target**: game works on a 375px-wide phone without squinting, and touch players can perform all actions without a keyboard.

---

## Problem Statement

1. **No dynamic scaling** — all font sizes are hardcoded `px` values. Only one media query exists (`max-width: 520px`), and it just hides the title + nudges button padding. RPGUI (v1.0.3, 10 years old) has no responsive features; we use it only for image assets.

2. **Icons are illegible** — action buttons use emoji characters rendered at `font-size: 8px` (the pixel font size). At that size emoji are ~6 actual pixels. On orange/brown RPGUI button backgrounds they're totally washed out.

3. **Too many individual buttons** — 8 action buttons (Interact, Attack, Ignite, Build, Bag, Craft, Skills, Log) crowd the bottom bar. On mobile they wrap into 3 rows, creating tiny tap targets.

4. **No touch controls for actions** — the virtual joystick handles movement but there's no way to interact, attack, or ignite without a keyboard.

---

## RPGUI Assessment

**What RPGUI provides that we use:**
- `rpgui/img/border-image.png` — sliced border frames (6px slice)
- `rpgui/img/border-image-golden.png` — gold variant (4px slice)
- `rpgui/img/background-image.png` — dark parchment background
- `rpgui/img/background-image-golden.png` — gold parchment background
- `rpgui/img/button.png` / `button-hover.png` / `button-down.png` — 9-slice button skins
- `rpgui/img/hr.png` — horizontal rule
- `rpgui/img/cursor/default.png` / `point.png` — pixel cursors

**What RPGUI does NOT provide (and we're NOT importing its CSS/JS):**
- Any responsive/scaling system
- Any mobile layout primitives
- Any touch-event handling
- Any icon system beyond the bundled sprite
- Any dynamic font sizing

**Verdict**: RPGUI is purely an asset pack for us. We build ALL layout, responsiveness, and interaction ourselves. This is fine — we have full control.

---

## Plan

### Phase 1 — Dynamic Scaling System

**Goal**: One JS-driven scale factor that everything respects.

**Approach**: Set a CSS custom property `--scale` on `:root` computed from `Math.min(innerWidth / 800, innerHeight / 600, 1.5)`. All pixel values in CSS become `calc(N * var(--scale))`. A `ResizeObserver` on `<html>` keeps it updated.

**Files changed:**
- `src/game/ui/scale.ts` (NEW) — `initScale()` sets `--scale` on `:root`, watches resize
- `src/game/ui/styles.ts` — convert fixed `px` values to `calc()` expressions using `--scale`
- `src/main.ts` — call `initScale()` early in boot

**Base reference**: 800×600 logical pixels → `--scale = 1.0`. iPhone SE (375×667) → `--scale ≈ 0.47`. iPad (1024×768) → `--scale ≈ 1.0`.

**Caveats:**
- `border-image` slice widths must stay integer pixels (no `calc()` in `border-image-width`). Round via JS and set separate custom props: `--frame-slice`, `--frame-gold-slice`.
- The pixel font "Press Start 2P" looks bad below ~7px real size. Floor the game's base font at `max(7px, 8px * var(--scale))`.
- Canvas (PixiJS) is already resolution-independent; this only affects the DOM HUD overlay.

### Phase 2 — Action Bar Redesign

**Goal**: Fewer, larger, clearer buttons.

**Desktop (unchanged)**: Keep the full 8-button bar with keyboard hints.

**Mobile/tablet** (`pointer: coarse` media query OR `max-width: 768px`):
- **Collapse to 4 primary buttons**: Interact (large, centered), Attack, Build, Bag. These cover 95% of gameplay.
- **Secondary actions** (Ignite, Craft, Skills, Log) go into a **slide-up drawer** accessible via a "…" (more) button.
- **Button styling**: Icon + label stacked. Icons use the pixel-art sprite system (`iconUrl()`) rather than emoji — renders crisp at any size, and we already have per-item icons.
- **Minimum tap target**: 44×44 CSS pixels (Apple HIG). Buttons get `min-width: 44px; min-height: 44px`.

**Icon fix**: Replace emoji in buttons with actual `<img>` tags using `iconUrl()` from the icon system. The pixel-art sprites are already 16×16 or 32×32 source and scale cleanly. For actions that don't have item icons (Interact, Attack, Build, Bag, Craft, Skills, Log), use simple pixel-art glyph icons generated via the same procgen pipeline — or use larger, standalone emoji rendered at `font-size: 18px` (not inside the 8px pixel font).

Actually simpler: use Unicode symbols at body font size (13px-16px) instead of emoji. The body font is Consolas. Symbols like `⛏` (pick), `⚔` (swords), `🔥` (fire), `🏗` (building) render clearly at 16px.

Even simpler: use the existing `iconUrl()` with dedicated icon sprites. The procgen icons system already generates pixel-art icons for items. We can add a few UI icons.

**Simplest approach that works NOW**: 
- Keep the emoji but render them in a separate `<span>` at `font-size: 16px` (not the pixel font), with the label below at 7-8px.
- Or: use colored text abbreviations instead of icons (e.g., `[E]` for Interact, `[ATK]` for Attack).

Wait, let me re-examine the current button HTML:
```html
<div class="nw-btn">
  <span>🎒 Bag</span>
  <span class="k">I</span>
</div>
```
The emoji is inside the same span as the text, all at 8px pixel font. The emoji is part of the text content. 

**Fix plan**: Split into icon + label:
```html
<div class="nw-btn">
  <span class="nw-btn-icon">🎒</span>
  <span class="nw-btn-label">Bag</span>
  <span class="k">I</span>
</div>
```
- `.nw-btn-icon` at `font-size: 16px` (or `calc(16px * var(--scale))`), `font-family: sans-serif` (not the pixel font — emoji render best in the system emoji font)
- `.nw-btn-label` at `font-size: 7px` pixel font
- `.k` (key hint) hidden on mobile

### Phase 3 — Mobile Touch Controls

**Goal**: Touch players can play without a keyboard.

**Actions needed on-screen:**
1. **Move** — already handled by virtual joystick ✅
2. **Interact (E)** — gather resources, open doors, etc. Most-used action.
3. **Attack (Space)** — fight enemies.
4. **Ignite (F)** — start fires.
5. **Build (B)** — enter placement mode.
6. **Open panels (I/C/K/L)** — inventory, crafting, skills, log.

**Design — split by priority:**

**Always visible (right side of screen, vertical stack):**
- **Interact** — large pill button, right side, vertically centered. Most important.
- **Attack** — medium button, below interact.

**Contextual (appear when relevant):**
- **Ignite** — shows when near burnable material
- **Build** — shows when not in combat

**Bottom bar (collapsed):**
- **Bag** (inventory) — always accessible
- **More (…)** — opens slide-up drawer with Craft, Skills, Log

**Build mode (when placing buildings):**
- Left/Right cycle arrows (already exist in build bar)
- Cancel button (already exists)
- Place-on-tap (already works via pointer events)

**Implementation approach:**
- Reuse the existing action bar HTML/CSS but add mobile-specific layout
- Detect touch capability via `matchMedia('(pointer: coarse)')` — this is more reliable than user-agent sniffing
- Add a `data-touch` attribute to `<html>` when on touch device
- CSS uses `[data-touch] .nw-actions { ... }` to switch layouts
- On-screen buttons call the same hooks as keyboard keys

**Panel access on mobile:**
- The slide-up drawer for secondary actions can be a simple `<div>` with `transform: translateY(100%)` that animates up
- Tapping "…" toggles it
- Each secondary action is a full-width row with large tap target

### Phase 4 — Polish

- **Safe areas**: Already using `env(safe-area-inset-bottom)` in some places. Ensure all fixed elements respect safe areas.
- **Viewport height**: Use `dvh` (dynamic viewport height) where available, fall back to `vh`. This prevents the address bar from breaking layout on iOS Safari.
- **Landscape mode**: On very short screens (`aspect-ratio > 1.5`), move action buttons to the sides rather than the bottom.
- **Top bar**: On narrow screens, collapse less-important badges (mute, new world) into a dropdown. The domain name already has `max-width: 40vw; text-overflow: ellipsis`.
- **Font floor**: Ensure nothing renders below 7px real pixels. The `--scale` floor prevents this for most elements; add explicit `max()` guards for edge cases.

---

## Implementation Order

1. `src/game/ui/scale.ts` — the scaling engine
2. `src/game/ui/styles.ts` — convert px → calc() + add mobile breakpoints + data-touch rules
3. `src/game/ui/ui.ts` — restructure buttons, add drawer, split icon/label, add touch button hooks
4. `src/main.ts` — init scale, detect touch, wire touch action buttons
5. `index.html` — add touch detection meta, dvh fallback
6. Test on 375×667 viewport in playwright

---

## Out of Scope (future work)

- Gesture system (swipe to attack, pinch to zoom)
- Bluetooth gamepad support
- Haptic feedback
- PWA manifest / install prompt
- Offline service worker
