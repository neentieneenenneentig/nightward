// A4 — the item tooltip, and the comparison that is the actual point of it.
//
// Before this file there were **zero tooltips anywhere in the codebase**. The
// Bag set `cell.title`, which is a browser tooltip: it appears after a second
// of stillness, it cannot be styled, it cannot be coloured by rarity, and it
// cannot show a green +3.4 next to a red −1.2. Which means that before A4, a
// rolled item was invisible to the player — they would see a differently
// coloured name and have no way to find out what it did.
//
// So the comparison is not a nicety layered on top of A1; it is the half of A1
// the player can actually see. A tooltip that lists stats but does not COMPARE
// them delivers none of the loot loop, because the question a player is asking
// while hovering a drop is never "what is this", it is "is this better than
// what I have".
import { itemDef, itemName, rolledOf } from '../data/items';
import { slotOf } from '../rules';
import { CFG } from '../data/config';
import { affixLines, escapeHtml, primaryStat, rarityDef, rarityOf } from './rarity';
import { matchWeaves, threadById } from '../data/weaves';

let host: HTMLElement | null = null;

function ensureHost(): HTMLElement {
  if (host && host.isConnected) return host;
  host = document.createElement('div');
  host.id = 'nw-tip';
  host.setAttribute('role', 'tooltip');
  host.style.display = 'none';
  (document.getElementById('hud') ?? document.body).appendChild(host);
  return host;
}

/** What currently occupies the slot this item would go into, or null. Tools are
 *  the awkward case: they are carried rather than worn, so "what you have" is
 *  whichever axe or pick `bestTool` would pick, which is exactly the thing the
 *  new one has to beat to matter. */
function incumbent(state: any, id: string): string | null {
  const d = itemDef(id);
  if (!d) return null;
  if (d.toolClass) {
    let best: string | null = null, power = -1;
    for (const other of Object.keys(state.player.inv ?? {})) {
      if (other === id) continue;
      const od = itemDef(other);
      if (od?.toolClass === d.toolClass && (od.toolPower ?? 0) > power) { best = other; power = od.toolPower ?? 0; }
    }
    return best;
  }
  const slot = slotOf(id);
  if (!slot) return null;
  const worn = slot === 'relic' ? state.player.relic : state.player.equip?.[slot];
  return worn && worn !== id ? worn : null;
}

export function itemTooltipHtml(state: any, id: string): string {
  const d = itemDef(id);
  if (!d) return '';
  const rarity = rarityOf(id);
  const rd = rarityDef(rarity);
  const rolled = rolledOf(id);
  const prim = primaryStat(id);

  let h = `<div class="nw-tip-name" style="color:${rd.color}">${escapeHtml(itemName(id))}</div>`;
  h += `<div class="nw-tip-sub">${rolled ? escapeHtml(rd.name) + ' · ' : ''}${escapeHtml(itemDef(rolled?.base ?? id)?.name ?? '')}</div>`;

  const body: string[] = [];
  if (prim && prim.value) body.push(`<div class="nw-tip-stat">${fmt(prim.value)} ${prim.label}</div>`);
  if (d.heal) body.push(`<div class="nw-tip-stat">heals ${d.heal}</div>`);
  for (const line of affixLines(id)) {
    body.push(`<div class="nw-tip-affix${line.cursed ? ' cursed' : ''}"${line.cursed ? '' : ` style="color:${rd.color}"`}>${escapeHtml(line.text)}</div>`);
  }
  // Effects the BASE item carries in its own right — a relic's or an authored
  // trinket's. Rolled ones are already listed above as their affix.
  const rolledFx = new Set((rolled?.affixes ?? []).map((a) => a.effect).filter(Boolean));
  for (const fx of d.effects ?? []) {
    if (rolledFx.has(fx)) continue;
    body.push(`<div class="nw-tip-affix" style="color:#9ec7a6">${escapeHtml(fx.replace(/_/g, ' '))}</div>`);
  }

  // ---- A5: sockets & weaves ----
  if (rolled && rolled.sockets > 0) {
    const slotted = state.sockets?.[id] ?? [];
    let row = '';
    for (let i = 0; i < rolled.sockets; i++) {
      const t = slotted[i];
      row += t
        ? `<span class="nw-socket" style="color:${threadById(t).color}">${threadById(t).glyph}</span>`
        : `<span class="nw-socket empty">·</span>`;
    }
    body.push(`<div class="nw-tip-sockets">${row}<span class="nw-tip-socklabel">${slotted.length}/${rolled.sockets} socketed</span></div>`);
    for (const w of matchWeaves(slotted)) {
      body.push(`<div class="nw-tip-weave">✦ ${escapeHtml(w.name)} — ${escapeHtml(w.desc)}</div>`);
    }
  }
  if (d.thread) {
    body.push(`<div class="nw-tip-thread">a ${escapeHtml(threadById(d.thread).name)} — sockets into rolled gear, in order</div>`);
  }

  if (body.length) h += `<div class="nw-tip-body">${body.join('')}</div>`;

  // ---- the comparison ----
  const other = incumbent(state, id);
  if (other && prim) {
    const op = primaryStat(other);
    if (op && op.key === prim.key) {
      const delta = prim.value - op.value;
      const eps = CFG.loot.deltaEpsilon;
      const cls = delta > eps ? 'up' : delta < -eps ? 'down' : 'same';
      const sign = delta > 0 ? '+' : '';
      h += `<div class="nw-tip-cmp">`
        + `<div class="nw-tip-vs">vs ${escapeHtml(itemName(other))}</div>`
        + `<div class="nw-tip-delta ${cls}">${sign}${fmt(delta)} ${prim.label}</div>`
        + `</div>`;
    }
  }
  return h;
}

const fmt = (v: number) => (Math.abs(v - Math.round(v)) < 0.005 ? String(Math.round(v)) : v.toFixed(2));

export function showItemTooltip(state: any, id: string, anchor: HTMLElement) {
  showHtmlTooltip(itemTooltipHtml(state, id), anchor);
}

/** A3: the same host, the same clamp, arbitrary body. Ability sockets need a
 *  tooltip that is not about an item, and a second tooltip host would be a
 *  second set of z-index and viewport-clamp bugs to find later. */
export function showHtmlTooltip(html: string, anchor: HTMLElement) {
  const el = ensureHost();
  if (!html) return hideItemTooltip();
  el.innerHTML = html;
  el.style.display = 'block';

  // Clamp to the viewport. A tooltip that opens off-screen on the rightmost
  // bag column is a tooltip that does not exist for the items most likely to
  // be new — the bag fills left to right.
  const r = anchor.getBoundingClientRect();
  const w = el.offsetWidth, hgt = el.offsetHeight;
  let x = r.right + 8;
  if (x + w > window.innerWidth - 8) x = Math.max(8, r.left - w - 8);
  let y = r.top;
  if (y + hgt > window.innerHeight - 8) y = Math.max(8, window.innerHeight - hgt - 8);
  el.style.left = Math.round(x) + 'px';
  el.style.top = Math.round(y) + 'px';
}

export function hideItemTooltip() {
  if (host) host.style.display = 'none';
}

/** Attach hover/focus/touch handlers to a bag cell. Focus is included on
 *  purpose: the panels are keyboard-navigable (Tab/arrows/Enter) and a tooltip
 *  only reachable with a mouse would silently drop the keyboard path. */
export function bindItemTooltip(cell: HTMLElement, state: any, id: string) {
  const show = () => showItemTooltip(state, id, cell);
  cell.addEventListener('mouseenter', show);
  cell.addEventListener('focus', show);
  cell.addEventListener('mouseleave', hideItemTooltip);
  cell.addEventListener('blur', hideItemTooltip);
}

/** A3: same contract as bindItemTooltip, but the body is produced at SHOW time.
 *  An ability socket's tooltip prints its live cooldown and its live level-scaled
 *  damage, so a string captured at bind time would be stale the moment the echo
 *  levelled. */
export function bindHtmlTooltip(node: HTMLElement, html: () => string) {
  const show = () => showHtmlTooltip(html(), node);
  node.addEventListener('mouseenter', show);
  node.addEventListener('focus', show);
  node.addEventListener('mouseleave', hideItemTooltip);
  node.addEventListener('blur', hideItemTooltip);
}
