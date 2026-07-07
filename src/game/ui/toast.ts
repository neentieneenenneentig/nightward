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

  push(msg: string, kind: ToastKind = 'info') {
    const el = document.createElement('div');
    el.className = 'nw-toast' + (kind === 'info' ? '' : ' ' + kind);
    el.textContent = msg;
    this.root.appendChild(el);
    while (this.root.childElementCount > 5) this.root.firstElementChild!.remove();
    setTimeout(() => {
      el.style.transition = 'opacity .4s';
      el.style.opacity = '0';
      setTimeout(() => el.remove(), 400);
    }, CFG.ui.toastSec * 1000);
  }
}
