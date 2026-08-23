// One movement axis from two sources: WASD/arrows on keyboard, and a
// floating virtual joystick that appears wherever a touch lands.
//
// SR0 — keyboard only. Two additions, both in service of build mode:
//
//  * `pressed()` / `held()`. The build ghost, the pause menu and (later) the
//    draft all need EDGE, not level: "Enter went down this tick" is a different
//    question from "Enter is down". Edges are consumed on read and cleared at
//    the end of the sim tick, not the render frame, so a machine running at
//    30 fps with a 60 Hz fixed step cannot swallow a keystroke.
//
//  * `setArrowsAsNudge()`. While placing, arrows stop being movement and start
//    nudging the ghost. That is a real mode switch — the build banner says so
//    out loud, because a control that silently changes meaning is a trap.
export interface Input {
  axis(): { x: number; y: number };
  /** True exactly once per physical keypress. Consumed on read. */
  pressed(key: string): boolean;
  /** True while the key is down. */
  held(key: string): boolean;
  /** Clear this tick's edges. Called at the END of sim(), once per fixed step. */
  endTick(): void;
  /** Build mode on: arrows nudge the ghost instead of walking. */
  setArrowsAsNudge(on: boolean): void;
}

const KEYMAP: Record<string, [number, number]> = {
  w: [0, -1], arrowup: [0, -1],
  s: [0, 1], arrowdown: [0, 1],
  a: [-1, 0], arrowleft: [-1, 0],
  d: [1, 0], arrowright: [1, 0],
};

const ARROWS = new Set(['arrowup', 'arrowdown', 'arrowleft', 'arrowright']);

/** Keys SR0 claims that are not movement. They join the preventDefault list so
 *  Enter stops activating whatever the browser thinks is focused and the
 *  brackets stop reaching the page. */
const EXTRA = new Set(['enter', '[', ']', 'escape']);

export function createInput(surface: HTMLElement): Input {
  const keys = new Set<string>();
  const edges = new Set<string>();
  let arrowsNudge = false;

  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    const known = k in KEYMAP || EXTRA.has(k);
    if (!known) return;
    // Escape is never preventDefault'd — the browser's own escape hatch (leaving
    // fullscreen, dismissing a native dialog) outranks anything this game wants.
    if (k !== 'escape') e.preventDefault();
    if (!e.repeat && !keys.has(k)) edges.add(k);
    keys.add(k);
  });
  window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
  window.addEventListener('blur', () => { keys.clear(); edges.clear(); });

  // --- floating joystick (touch/pen only; desktop uses keys) ---
  const base = document.getElementById('stick-base')!;
  const knob = document.getElementById('stick-knob')!;
  const RADIUS = 44;
  let stickId: number | null = null;
  let ox = 0, oy = 0;   // where the touch started (joystick origin)
  let jx = 0, jy = 0;   // joystick output, each in [-1, 1]

  const show = (el: HTMLElement, x: number, y: number) => {
    el.style.display = 'block';
    el.style.left = x + 'px';
    el.style.top = y + 'px';
  };
  const hide = () => { base.style.display = knob.style.display = 'none'; };

  surface.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' || stickId !== null) return;
    stickId = e.pointerId;
    ox = e.clientX; oy = e.clientY;
    jx = jy = 0;
    show(base, ox, oy);
    show(knob, ox, oy);
  });
  window.addEventListener('pointermove', (e) => {
    if (e.pointerId !== stickId) return;
    const dx = e.clientX - ox, dy = e.clientY - oy;
    const len = Math.hypot(dx, dy);
    const c = len > RADIUS ? RADIUS / len : 1;
    jx = (dx * c) / RADIUS;
    jy = (dy * c) / RADIUS;
    show(knob, ox + dx * c, oy + dy * c);
  });
  const end = (e: PointerEvent) => {
    if (e.pointerId !== stickId) return;
    stickId = null;
    jx = jy = 0;
    hide();
  };
  window.addEventListener('pointerup', end);
  window.addEventListener('pointercancel', end);

  return {
    axis() {
      let x = jx, y = jy;
      for (const k of keys) {
        if (!(k in KEYMAP)) continue;
        if (arrowsNudge && ARROWS.has(k)) continue;   // SR0: arrows are nudging the ghost
        x += KEYMAP[k][0]; y += KEYMAP[k][1];
      }
      const l = Math.hypot(x, y);
      if (l > 1) { x /= l; y /= l; }
      return { x, y };
    },
    pressed(key: string) {
      const k = key.toLowerCase();
      if (!edges.has(k)) return false;
      edges.delete(k);   // consumed — two readers cannot both claim one keypress
      return true;
    },
    held(key: string) { return keys.has(key.toLowerCase()); },
    endTick() { edges.clear(); },
    setArrowsAsNudge(on: boolean) { arrowsNudge = on; },
  };
}
