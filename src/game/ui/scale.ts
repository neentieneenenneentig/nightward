// Dynamic scaling engine for the DOM HUD overlay.
// Sets CSS custom properties on :root that every UI element references,
// so the entire chrome scales with viewport size without media-query bloat.
//
// Reference resolution: 800×600 logical px → --scale = 1.0
// iPhone SE (375×667) → --scale ≈ 0.47
// iPad (1024×768) → --scale ≈ 1.0
// 1080p monitor → --scale ≈ 1.35 (capped at 1.5)

const REF_W = 800;
const REF_H = 600;
const MAX_SCALE = 1.5;

export function initScale() {
  const root = document.documentElement;

  const update = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const raw = Math.min(w / REF_W, h / REF_H, MAX_SCALE);
    // Quantize to 0.01 steps to avoid subpixel jitter
    const s = Math.round(raw * 100) / 100;
    root.style.setProperty('--scale', String(s));

    // Border-image slices must be integer px (no calc() in border-image-width).
    // Round to nearest int; floor at 2px so frames don't vanish on tiny screens.
    // Multiple sizes: sm (toasts 8px), md (badges 10px), lg (panels 18px), gold (14px).
    root.style.setProperty('--frame-sm', String(Math.max(2, Math.round(8 * s))));
    root.style.setProperty('--frame-md', String(Math.max(2, Math.round(10 * s))));
    root.style.setProperty('--frame-lg', String(Math.max(2, Math.round(18 * s))));
    root.style.setProperty('--frame-gold', String(Math.max(2, Math.round(14 * s))));
    // hr border-image uses 4px slice (unscaled — it's always thin)
    root.style.setProperty('--hr-slice', String(Math.max(2, Math.round(4 * s))));

    // Detect touch capability for layout switching
    if (matchMedia('(pointer: coarse)').matches) {
      root.setAttribute('data-touch', '');
    } else {
      root.removeAttribute('data-touch');
    }

    // Detect very narrow screens for extra compaction
    if (w < 400) {
      root.setAttribute('data-narrow', '');
    } else {
      root.removeAttribute('data-narrow');
    }
  };

  update();
  window.addEventListener('resize', update);
  // Also watch for orientation changes on mobile (some browsers don't fire resize)
  window.addEventListener('orientationchange', () => setTimeout(update, 100));

  // Re-check pointer capability when a pointing device changes (e.g. tablet with
  // detachable keyboard/trackpad)
  matchMedia('(pointer: coarse)').addEventListener('change', update);
}
