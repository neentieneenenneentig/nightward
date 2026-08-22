// N4.2 — shared building blocks for the Lens side cart.
//
// The old panel was ~115 lines of string concatenation inside main.ts, rebuilt
// wholesale every refresh. It could not survive five tabs and a dozen new
// sections, and — more importantly — it had no way to say HOW a number was
// obtained. A 25 ms-bucketed browser guess and a µs-precision kernel RTT
// rendered identically. That is the one thing this panel must never do.
import type { NetInspect } from '../../data/network';
import type { Quality } from '../../systems/chronicle';

/** Every third-party string — ISP, city, ASN, colo, PTR, registrant org —
 *  arrives verbatim from someone else's JSON and goes into innerHTML. This is
 *  the only thing standing between that and script injection. Do not remove it,
 *  and do not interpolate an unescaped third-party string anywhere in this
 *  directory. */
export function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const QUALITY_STYLE: Record<Quality, { c: string; t: string; help: string }> = {
  measured:    { c: '#7fd6a0', t: 'measured',    help: 'timed by us, or by a kernel that told us' },
  reported:    { c: '#8fb6e8', t: 'reported',    help: 'the browser told us, at whatever precision it chose' },
  derived:     { c: '#d8c07a', t: 'derived',     help: 'computed from other readings, not observed directly' },
  unavailable: { c: '#8a7a8a', t: 'unavailable', help: 'cannot be read here' },
};

/** The honesty tag. Small, dim, and on every single reading — the point is not
 *  to decorate the row but to make it impossible to read a guess as a fact. */
export function tag(q: Quality, why?: string): string {
  const s = QUALITY_STYLE[q];
  const title = escapeHtml(why ? `${s.help} — ${why}` : s.help);
  return `<span title="${title}" style="color:${s.c};font-size:8px;opacity:0.75;margin-left:4px;">${s.t}</span>`;
}

export interface RowOpts {
  /** Wires the row into the existing SOURCE / ACTION / FLOWS INTO inspect box.
   *  That mechanic is the best thing in the old panel and survives intact. */
  inspect?: string;
  quality?: Quality;
  /** Reason text for an `unavailable` row. "Unavailable" with no reason is
   *  indistinguishable from "broken", which is a worse answer than the truth. */
  why?: string;
  color?: string;
  dim?: boolean;
}

/** One reading. `label` and `value` are trusted (we author them); anything
 *  third-party must already have been through escapeHtml by the caller. */
export function row(label: string, value: string, o: RowOpts = {}): string {
  const attr = o.inspect ? ` data-inspect-key="${escapeHtml(o.inspect)}"` : '';
  const cur = o.inspect ? 'cursor:help;' : '';
  const dim = o.dim ? 'opacity:0.45;' : '';
  const col = o.color ? `color:${o.color};` : '';
  const q = o.quality ? tag(o.quality, o.why) : '';
  return `<div${attr} style="display:flex;justify-content:space-between;gap:10px;font-size:9px;padding:1px 0;${cur}${dim}">`
    + `<span style="color:#7c7c8e;white-space:nowrap;">${label}</span>`
    + `<span style="text-align:right;${col}">${value}${q}</span></div>`;
}

/** A free-form note under a section — the "why" text that keeps the panel
 *  honest about what it cannot see. */
export function note(text: string): string {
  return `<div style="font-size:8px;color:#5a5a6e;margin:2px 0 4px;line-height:1.45;">${text}</div>`;
}

export function section(title: string, body: string): string {
  if (!body) return '';
  return `<div style="margin-bottom:9px;">`
    + `<div style="color:#6f6f88;font-size:9px;letter-spacing:0.09em;margin-bottom:3px;">${title}</div>`
    + body + `</div>`;
}

/** A sparkline over an arbitrary series. Returns an inline SVG rather than a
 *  canvas: the drawer rebuilds by innerHTML, and a canvas would need its
 *  context re-acquired and re-drawn every rebuild while an SVG simply survives
 *  being written as a string. */
export function sparkline(data: number[], color: string, w = 116, h = 20): string {
  if (data.length < 2) {
    return `<svg width="${w}" height="${h}"><text x="2" y="${h - 6}" fill="#4a4a5c" font-size="8">no samples yet</text></svg>`;
  }
  let lo = Infinity, hi = -Infinity;
  for (const v of data) { if (v < lo) lo = v; if (v > hi) hi = v; }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return `<svg width="${w}" height="${h}"></svg>`;
  const span = hi - lo || 1;
  // Sample the series down to the pixel width — this is DISPLAY decimation and
  // is fine; the store keeps min/med/p95/max so nothing is actually lost.
  const step = Math.max(1, Math.floor(data.length / w));
  const pts: string[] = [];
  for (let i = 0; i < data.length; i += step) {
    const x = (i / Math.max(1, data.length - 1)) * (w - 2) + 1;
    const y = h - 2 - ((data[i] - lo) / span) * (h - 4);
    pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  }
  return `<svg width="${w}" height="${h}" style="display:block;">`
    + `<polyline points="${pts.join(' ')}" fill="none" stroke="${color}" stroke-width="1" stroke-linejoin="round"/>`
    + `</svg>`;
}

export function fmt(v: number, digits = 0, unit = ''): string {
  if (!Number.isFinite(v)) return '—';
  return v.toFixed(digits) + (unit ? ` ${unit}` : '');
}

/** Everything a tab renderer is allowed to touch. Deliberately narrow: a tab
 *  that could reach the game state would eventually change it. */
export interface LensCtx {
  net: any;
  chronicle: any;
  log: any;
  /** N4.3: the OmenSystem. Read-only here — a tab that could raise an omen
   *  would eventually raise one by accident. */
  omens: any;
  /** N4.5: the SoundingSystem. Read-only here — the pact and the bytes spent. */
  sounding: any;
  inspectFor(key: string): NetInspect | null;
}

export interface LensTab {
  id: string;
  title: string;
  render(ctx: LensCtx): string;
}
