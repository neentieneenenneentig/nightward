// One movement axis from two sources: WASD/arrows on keyboard, and a
// floating virtual joystick that appears wherever a touch lands.
export interface Input {
  axis(): { x: number; y: number };
}

const KEYMAP: Record<string, [number, number]> = {
  w: [0, -1], arrowup: [0, -1],
  s: [0, 1], arrowdown: [0, 1],
  a: [-1, 0], arrowleft: [-1, 0],
  d: [1, 0], arrowright: [1, 0],
};

export function createInput(surface: HTMLElement): Input {
  const keys = new Set<string>();
  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (k in KEYMAP) { keys.add(k); e.preventDefault(); }
  });
  window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
  window.addEventListener('blur', () => keys.clear());

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
      for (const k of keys) { x += KEYMAP[k][0]; y += KEYMAP[k][1]; }
      const l = Math.hypot(x, y);
      if (l > 1) { x /= l; y /= l; }
      return { x, y };
    },
  };
}
