// Ephemeral status messages ("+2 Log", "Night 3 begins…"). Auto-expire and
// self-limit so a busy moment doesn't bury the screen.
import { CFG } from '../data/config';

export type ToastKind = 'info' | 'good' | 'bad';

export class Toasts {
  private root: HTMLElement;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'nw-toasts';
    parent.appendChild(this.root);
  }

  /** `color` is A4: a Woven pickup should announce itself in its own tier
   *  colour. Applied as an inline style over the class rather than through a
   *  new class per tier, because the tier palette lives in data/rarity.ts and
   *  duplicating six hex values into the stylesheet is how a ladder starts
   *  disagreeing with itself. */
  push(msg: string, kind: ToastKind = 'info', color?: string) {
    const el = document.createElement('div');
    el.className = 'nw-toast' + (kind === 'info' ? '' : ' ' + kind);
    el.textContent = msg;
    if (color) { el.style.color = color; el.style.fontWeight = '700'; }
    this.root.appendChild(el);
    while (this.root.childElementCount > 5) this.root.firstElementChild!.remove();
    setTimeout(() => {
      el.style.transition = 'opacity .4s';
      el.style.opacity = '0';
      setTimeout(() => el.remove(), 400);
    }, CFG.ui.toastSec * 1000);
  }
}
