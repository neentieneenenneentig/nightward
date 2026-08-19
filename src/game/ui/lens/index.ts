// N4.2 — The Lens as a side cart.
//
// It used to be a centred modal, `top:50%; left:50%`, covering the game. That
// is the wrong shape for this particular panel: the whole premise is that these
// numbers are driving the world, and you could not watch the world react to
// them because the panel was sitting on top of it.
//
// Now it is a right-edge drawer. The game keeps rendering and stays playable
// beside it; there is no scrim and no input capture beyond its own bounds. It
// animates on `transform` only — a compositor-only property, so opening it
// never triggers layout during a 60 fps sim.
import { LENS_TABS, chronicleStrip } from './tabs';
import type { LensCtx } from './core';
import type { NetInspect } from '../../data/network';

const WIDTH = 380;
/** 4 Hz. The numbers do not need 60 Hz and the eye cannot read them at that
 *  rate; rebuilding five tabs of DOM at frame rate would eat the frame budget
 *  for no benefit whatsoever. Only the VISIBLE tab is rebuilt, and only while
 *  the drawer is open. */
const REFRESH_MS = 250;

export class Lens {
  readonly el: HTMLDivElement;
  private bodyEl!: HTMLDivElement;
  private stripEl!: HTMLDivElement;
  private tabBar!: HTMLDivElement;
  private active = 0;
  private open = false;
  private lastRefresh = 0;
  private inspectBox: HTMLDivElement;

  constructor(private ctx: LensCtx, private onExport: () => void) {
    this.el = document.createElement('div');
    this.el.id = 'nw-observatory';
    this.el.style.cssText = [
      'position:fixed;top:0;right:0;bottom:0;width:' + WIDTH + 'px;z-index:35;',
      'font-family:ui-monospace,Consolas,monospace;font-size:10px;line-height:1.35;',
      'color:#bbb;background:#07070ef7;border-left:1px solid #26263a;',
      'display:flex;flex-direction:column;',
      // Parked off-screen rather than display:none, so the slide is a real
      // transition and the browser can keep it on its own layer.
      'transform:translateX(100%);transition:transform .18s ease-out;will-change:transform;',
      'pointer-events:auto;user-select:none;',
    ].join('');
    this.el.innerHTML = this.chrome();
    document.body.appendChild(this.el);

    this.bodyEl = this.el.querySelector('#nw-lens-body') as HTMLDivElement;
    this.stripEl = this.el.querySelector('#nw-lens-strip') as HTMLDivElement;
    this.tabBar = this.el.querySelector('#nw-lens-tabs') as HTMLDivElement;

    // Full-width sheet on a narrow viewport — a 380px drawer on a phone is the
    // whole screen anyway, and pretending otherwise just crops the content.
    const fit = () => {
      const narrow = window.innerWidth < 700;
      this.el.style.width = narrow ? '100%' : WIDTH + 'px';
    };
    fit();
    window.addEventListener('resize', fit);

    this.tabBar.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest('[data-tab]') as HTMLElement | null;
      if (!t) return;
      this.active = Number(t.dataset.tab) || 0;
      this.paintTabs();
      this.refresh(true);
    });
    (this.el.querySelector('#nw-lens-export') as HTMLElement).addEventListener('click', () => this.onExport());
    (this.el.querySelector('#nw-lens-close') as HTMLElement).addEventListener('click', () => this.setOpen(false));

    this.inspectBox = document.createElement('div');
    this.inspectBox.id = 'nw-lens-inspect';
    this.inspectBox.style.cssText = 'position:fixed;z-index:40;'
      + 'font-family:ui-monospace,Consolas,monospace;font-size:9px;line-height:1.4;'
      + 'color:#ccc;background:#0a0a16f8;padding:8px 10px;border-radius:6px;'
      + 'border:1px solid #557;display:none;max-width:320px;pointer-events:none;user-select:none;';
    document.body.appendChild(this.inspectBox);
    this.wireInspect();
    this.buildTabs();
  }

  private chrome(): string {
    return `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:9px 12px 7px;border-bottom:1px solid #26263a;">
        <span style="color:#aaa;font-weight:bold;font-size:12px;">🔍 The Lens</span>
        <span>
          <button id="nw-lens-export" title="Dump every series, probe and derived inference as JSON"
            style="background:#16162a;color:#8fb6e8;border:1px solid #33334d;border-radius:4px;font:inherit;font-size:9px;padding:2px 7px;cursor:pointer;">export</button>
          <button id="nw-lens-close"
            style="background:none;color:#666;border:none;font:inherit;font-size:12px;padding:2px 4px;cursor:pointer;">×</button>
        </span>
      </div>
      <div id="nw-lens-tabs" style="display:flex;border-bottom:1px solid #26263a;"></div>
      <div style="padding:0 12px;"><div id="nw-lens-strip"></div></div>
      <div id="nw-lens-body" style="flex:1;overflow-y:auto;padding:0 12px 14px;"></div>
    `;
  }

  /** Built ONCE. Selecting a tab only restyles the existing elements.
   *
   *  Rewriting `tabBar.innerHTML` on every selection detaches the very node the
   *  click came from, which is harmless for the click already in flight and
   *  fatal for any caller holding a NodeList — every reference after the first
   *  selection points at a detached element and silently does nothing. */
  private buildTabs() {
    this.tabBar.innerHTML = LENS_TABS.map((t, i) =>
      `<div data-tab="${i}" style="flex:1;text-align:center;padding:6px 0;font-size:9px;`
      + `letter-spacing:.08em;cursor:pointer;">${t.title}</div>`).join('');
    this.paintTabs();
  }

  private paintTabs() {
    const els = this.tabBar.querySelectorAll('[data-tab]');
    els.forEach((el, i) => {
      const on = i === this.active;
      (el as HTMLElement).style.color = on ? '#e0e0f0' : '#5f5f78';
      (el as HTMLElement).style.borderBottom = `2px solid ${on ? '#f96' : 'transparent'}`;
    });
  }

  isOpen() { return this.open; }

  setOpen(v: boolean) {
    this.open = v;
    this.el.style.transform = v ? 'translateX(0)' : 'translateX(100%)';
    if (!v) this.inspectBox.style.display = 'none';
    else this.refresh(true);
  }

  toggle() { this.setOpen(!this.open); }

  /** Called from the render loop. A no-op unless the drawer is open and the
   *  throttle has elapsed. */
  refresh(force = false) {
    if (!this.open) return;
    const now = performance.now();
    if (!force && now - this.lastRefresh < REFRESH_MS) return;
    this.lastRefresh = now;
    try {
      this.stripEl.innerHTML = chronicleStrip(this.ctx);
      this.bodyEl.innerHTML = LENS_TABS[this.active].render(this.ctx);
    } catch (e) {
      // A tab that throws must not take the frame with it. The panel reporting
      // its own failure is more useful than a blank drawer.
      this.bodyEl.innerHTML = `<div style="font-size:9px;color:#f77;padding:8px 0;">`
        + `This tab failed to render: ${String((e as Error)?.message ?? e)}</div>`;
    }
  }

  private wireInspect() {
    const show = (target: HTMLElement) => {
      const key = target.dataset.inspectKey ?? '';
      const d: NetInspect | null = this.ctx.inspectFor(key);
      if (!d) { this.inspectBox.style.display = 'none'; return; }
      this.inspectBox.innerHTML = `
        <div style="color:#f96;font-size:10px;font-weight:bold;margin-bottom:4px;">${key}</div>
        <div style="margin-bottom:3px;"><span style="color:#888;">SOURCE</span><br><span style="color:#ccc;">${d.api}</span></div>
        <div style="margin-bottom:3px;"><span style="color:#888;">ACTION</span><br><span style="color:#ccc;">${d.action}</span></div>
        <div><span style="color:#888;">FLOWS INTO</span><br><span style="color:#ccc;">${d.flowsInto}</span></div>`;
      const r = target.getBoundingClientRect();
      this.inspectBox.style.left = '0px';
      this.inspectBox.style.top = '-9999px';
      this.inspectBox.style.display = '';
      const bw = this.inspectBox.offsetWidth, bh = this.inspectBox.offsetHeight;
      // The drawer is pinned to the right edge, so the box always wants to open
      // to its LEFT — the old centred-modal logic tried the right side first and
      // would now flip on every single row.
      let left = r.left - bw - 8;
      if (left < 4) left = Math.min(r.right + 8, window.innerWidth - bw - 4);
      let top = Math.min(r.top, window.innerHeight - bh - 4);
      this.inspectBox.style.left = Math.max(4, left) + 'px';
      this.inspectBox.style.top = Math.max(4, top) + 'px';
    };

    this.el.addEventListener('mouseover', (e) => {
      const t = (e.target as HTMLElement).closest('[data-inspect-key]') as HTMLElement | null;
      if (!t) { if (!this.inspectBox.dataset.pinned) this.inspectBox.style.display = 'none'; return; }
      show(t);
    });
    this.el.addEventListener('mouseleave', () => {
      if (!this.inspectBox.dataset.pinned) this.inspectBox.style.display = 'none';
    });
    // Tap-to-pin, for touch, where there is no hover at all.
    this.el.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest('[data-inspect-key]') as HTMLElement | null;
      if (!t) return;
      if (this.inspectBox.dataset.pinned === t.dataset.inspectKey) {
        this.inspectBox.dataset.pinned = '';
        this.inspectBox.style.display = 'none';
      } else {
        this.inspectBox.dataset.pinned = t.dataset.inspectKey ?? '';
        show(t);
      }
    });
  }
}
