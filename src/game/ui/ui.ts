// The DOM UI controller. Builds the chrome once, then refresh() is called
// every frame with a cheap read of game state; panels rebuild only while open.
// All gameplay actions are delegated back to the game via `hooks`.
import { CFG } from '../data/config';
import { ITEMS } from '../data/items';
import { SKILLS } from '../data/skills';
import { RECIPES } from '../data/recipes';
import { BUILDINGS } from '../data/buildings';
import { ECHOES } from '../data/echoes';
import { iconUrl } from '../../engine/procgen/icons';
import {
  invCount, invHasAll, skillLevel, xpProgress, slotOf,
  soulStat, bestTool, type EquipSlot,
  equippedWeaponDmg, armorDef,
  population, territoryScore, soulXpProgress,
} from '../rules';
import type { SoulSlot } from '../data/soulgear';
import { SoulFeedSystem, totalSoulXp, itemSoulAffinity, type FeedResult } from '../systems/soulfeed';
import { phase, phaseRemaining } from '../systems/daynight';
import type { GameState } from '../state';
import type { LogEntry } from '../systems/log';
import { injectStyles } from './styles';
import { Toasts } from './toast';
import { loadLeaderboard, formatAge } from '../systems/scoreboard';

export interface UIHooks {
  interact(): void;
  attack(): void;
  ignite(): void;
  enterBuild(id: string): void;
  startBuild(): void;
  cycleBuild(dir: number): void;
  craft(id: string): void;
  useItem(id: string): void;
  equip(id: string): void;
  toggleMute(): boolean;
  newWorld(): void;
  isPlacing(): boolean;
  gatherView(): { label: string; frac: number } | null;
  /** L1: current age/lifespan-remaining reading — drives the HUD chip+bar. */
  lifespanView(): { age: number; frac: number; minutesRemaining: number; warning: boolean; critical: boolean };
  logEntries(): LogEntry[];
  /** W7: feed an item to a soul-gear slot. Returns FeedResult or null if invalid. */
  feedSoul(itemId: string, count: number, targetSlot: SoulSlot): FeedResult | null;
}

type Panel = 'bag' | 'craft' | 'skills' | 'log' | 'leaderboard' | null;

const icon = (id: string) => iconUrl(id, ITEMS[id].icon as any);

export class UI {
  private root: HTMLElement;
  private toasts: Toasts;
  private panel: Panel = null;
  private craftTab = 'crafting';

  // cached dynamic nodes
  private hpFill!: HTMLElement;
  private hpText!: HTMLElement;
  private goldText!: HTMLElement;
  private ageText!: HTMLElement;
  private ageFill!: HTMLElement;
  private ageBadge!: HTMLElement;
  private clock!: HTMLElement;
  private nights!: HTMLElement;
  private domainEl!: HTMLElement;
  private muteEl!: HTMLElement;
  private echoEl!: HTMLElement;
  private echoChipsCache = '';
  private vigorText!: HTMLElement;
  private resolveText!: HTMLElement;
  private gather!: HTMLElement;
  private gatherFill!: HTMLElement;
  private gatherLabel!: HTMLElement;
  private interactBtn!: HTMLElement;
  private panelHost!: HTMLElement;
  private buildBar!: HTMLElement;

  constructor(private state: GameState, private hooks: UIHooks) {
    injectStyles();
    this.root = document.getElementById('hud')!;
    this.root.innerHTML = '';
    this.toasts = new Toasts(this.root);
    this.buildTop();
    this.buildGather();
    this.buildBuildBar();
    this.buildActions();
    this.panelHost = document.createElement('div');
    this.root.appendChild(this.panelHost);
    window.addEventListener('keydown', (e) => this.onKey(e));
  }

  toast(msg: string, kind: 'info' | 'good' | 'bad' = 'info') { this.toasts.push(msg, kind); }

  /** Schedule a panel body rebuild on the next refresh(). Call after state changes
   *  (craft, equip, use, gather) while a panel is open. */
  rebuildPanel() { this._dirty = true; }
  private _dirty = false;

  // ---------------------------------------------------------------- build ----

  private buildTop() {
    const top = el('div', 'nw-top');
    top.innerHTML = `
      <div class="nw-badge nw-title">NIGHTWARD</div>
      <div class="nw-badge nw-hpwrap">
        <span>&#10084;</span>
        <div class="nw-hpbar"><div class="nw-hpfill" id="nw-hp"></div></div>
        <span id="nw-hptext" style="font-size:11px"></span>
      </div>
      <div class="nw-badge" id="nw-vigor" title="Vigor: restore by hunting or gathering">
        <span>&#9672;</span> <span id="nw-vigor-text">100</span>
      </div>
      <div class="nw-badge" id="nw-resolve" title="Resolve: restore by fighting, building, or surviving nights">
        <span>&#10022;</span> <span id="nw-resolve-text">100</span>
      </div>
      <div class="nw-badge nw-gold">&#9679; <span id="nw-gold">0</span></div>
      <div class="nw-badge nw-age" id="nw-age" title="Age — the years pass as you dream">
        <span>&#9203;</span>
        <div class="nw-agebar"><div class="nw-agefill" id="nw-agefill"></div></div>
        <span id="nw-age-text" style="font-size:11px">${CFG.lifespan.startAge}</span>
      </div>
      <div class="nw-badge nw-clock" id="nw-clock"></div>
      <div class="nw-badge" id="nw-nights" title="damage · defense · population · territory"></div>
      <div class="nw-badge" id="nw-echoes" style="display:none" title="echoes of the slain"></div>
      <div class="nw-badge nw-domain" id="nw-domain" title="the realm you stand in"></div>
      <div class="nw-spacer"></div>
      <div class="nw-badge nw-btn" id="nw-mute" style="pointer-events:auto" title="sound on/off">&#128266;</div>
      <div class="nw-badge nw-btn" id="nw-lb" style="pointer-events:auto" title="leaderboard (;)">&#127942;</div>
      <div class="nw-badge nw-btn" id="nw-newworld" style="pointer-events:auto" title="new world">&#10227;</div>`;
    this.root.appendChild(top);
    this.hpFill = top.querySelector('#nw-hp')!;
    this.hpText = top.querySelector('#nw-hptext')!;
    this.goldText = top.querySelector('#nw-gold')!;
    this.ageText = top.querySelector('#nw-age-text')!;
    this.ageFill = top.querySelector('#nw-agefill')!;
    this.ageBadge = top.querySelector('#nw-age')!;
    this.clock = top.querySelector('#nw-clock')!;
    this.nights = top.querySelector('#nw-nights')!;
    this.echoEl = top.querySelector('#nw-echoes')!;
    this.vigorText = top.querySelector('#nw-vigor-text')!;
    this.resolveText = top.querySelector('#nw-resolve-text')!;
    this.domainEl = top.querySelector('#nw-domain')!;
    this.muteEl = top.querySelector('#nw-mute')!;
    top.querySelector('#nw-newworld')!.addEventListener('click', () => this.hooks.newWorld());
    top.querySelector('#nw-lb')!.addEventListener('click', () => this.toggle('leaderboard'));
    this.muteEl.addEventListener('click', () => {
      const on = this.hooks.toggleMute();
      this.muteEl.innerHTML = on ? '&#128266;' : '&#128263;';
    });
  }

  /** Announce the domain the player currently stands in (name + danger rating). */
  setDomain(name: string, danger: number) {
    const skulls = danger <= 0 ? 'safe' : '&#9760;'.repeat(Math.min(6, danger));
    this.domainEl.innerHTML = `&#9672; <span class="dn">${name}</span> <span class="dg">${skulls}</span>`;
  }

  private buildGather() {
    this.gather = el('div', 'nw-gather');
    this.gather.innerHTML = `<div id="nw-glabel"></div><div class="nw-gbar"><div class="nw-gfill" id="nw-gfill"></div></div>`;
    this.root.appendChild(this.gather);
    this.gatherFill = this.gather.querySelector('#nw-gfill')!;
    this.gatherLabel = this.gather.querySelector('#nw-glabel')!;
  }

  private buildBuildBar() {
    const bar = el('div', 'nw-buildbar');
    bar.innerHTML = `
      <div class="nw-btn cyc prev">&lsaquo;</div>
      <img class="bimg" alt="">
      <div class="txt"><b class="nm"></b><span class="cost"></span>
        <span class="hint">Tab / wheel cycles &middot; click places &middot; drag paints walls &middot; right-click / Esc / B stops</span></div>
      <div class="nw-btn cyc next">&rsaquo;</div>
      <div class="nw-btn cancel">Cancel</div>`;
    bar.querySelector('.prev')!.addEventListener('click', () => this.hooks.cycleBuild(-1));
    bar.querySelector('.next')!.addEventListener('click', () => this.hooks.cycleBuild(1));
    bar.querySelector('.cancel')!.addEventListener('click', () => this.hooks.enterBuild(''));
    this.root.appendChild(bar);
    this.buildBar = bar;
  }

  /** The build carousel banner (called by the build system with the current
   * blueprint, or null to hide). Shows icon, cost coloring, afford count. */
  setBuildBanner(sel: { def: any; afford: number } | null) {
    if (!this.buildBar) return;
    if (!sel) { this.buildBar.classList.remove('on'); return; }
    const d = sel.def;
    (this.buildBar.querySelector('.bimg') as HTMLImageElement).src = iconBuilding(d.art);
    this.buildBar.querySelector('.nm')!.textContent =
      d.name + (d.unique ? '' : ` — ${sel.afford} affordable`);
    const cost = d.cost.map((s: any) => {
      const ok = invCount(this.state, s.id) >= s.n;
      return `<span class="${ok ? 'have' : 'lack'}">${s.n} ${ITEMS[s.id].name}</span>`;
    }).join(' &middot; ');
    const tower = d.tower ? ` &middot; ${d.tower.dmg} dmg / ${d.tower.rangeTiles}t` : '';
    this.buildBar.querySelector('.cost')!.innerHTML = cost + tower;
    this.buildBar.classList.add('on');
  }

  private buildActions() {
    const bar = el('div', 'nw-actions');
    const btn = (id: string, icon: string, label: string, key: string, cls = '') => {
      const b = el('div', 'nw-btn ' + cls);
      b.id = id;
      b.title = label;
      b.setAttribute('aria-label', label);
      b.innerHTML = `<span class="nw-btn-icon">${icon}</span><span class="nw-btn-label">${label}</span><span class="k">${key}</span>`;
      bar.appendChild(b);
      return b;
    };
    this.interactBtn = btn('nw-interact', '&#128074;', 'Interact', 'E', 'primary');
    const attack = btn('nw-attack', '&#9876;', 'Attack', 'Spc');
    const ignite = btn('nw-ignite', '&#128293;', 'Ignite', 'F');
    const build = btn('nw-build', '&#9874;', 'Build', 'B');
    const bag = btn('nw-bag', '&#127890;', 'Bag', 'I');
    const craft = btn('nw-craft', '&#9881;', 'Craft', 'C');
    const skills = btn('nw-skills', '&#9733;', 'Skills', 'K');
    const log = btn('nw-log', '&#128220;', 'Log', 'L');
    this.root.appendChild(bar);

    this.interactBtn.addEventListener('click', () => this.hooks.interact());
    attack.addEventListener('click', () => this.hooks.attack());
    ignite.addEventListener('click', () => this.hooks.ignite());
    build.addEventListener('click', () => this.toggleBuild());
    bag.addEventListener('click', () => this.open('bag'));
    craft.addEventListener('click', () => this.open('craft'));
    skills.addEventListener('click', () => this.open('skills'));
    log.addEventListener('click', () => this.open('log'));
  }

  /** Build button/key: toggles placement browsing directly — no popup menu. */
  private toggleBuild() {
    if (this.hooks.isPlacing()) { this.hooks.enterBuild(''); return; }
    this.hidePanel(); // placement needs the map visible
    this.hooks.startBuild();
  }

  // ----------------------------------------------------------------- keys ----

  private onKey(e: KeyboardEvent) {
    if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
    const k = e.key;

    // ---- panel keyboard navigation (Tab / Enter / Escape) ----
    if (this.panel) {
      if (k === 'Escape') { e.preventDefault(); this.close(); return; }
      // Ctrl+Tab switches craft tabs (must check BEFORE plain Tab)
      if (k === 'Tab' && e.ctrlKey && this.panel === 'craft') {
        e.preventDefault();
        const tabs = ['crafting', 'smithing', 'alchemy'];
        const idx = tabs.indexOf(this.craftTab);
        this.craftTab = tabs[(idx + (e.shiftKey ? -1 : 1) + tabs.length) % tabs.length];
        this.renderPanel();
        return;
      }
      if (k === 'Tab') {
        e.preventDefault();
        this.focusNext(e.shiftKey ? -1 : 1);
        return;
      }
      if (k === 'Enter' || k === ' ') {
        const focused = document.activeElement as HTMLElement;
        if (focused && focused.closest('.nw-panel')) {
          e.preventDefault();
          focused.click(); // trigger the existing click handler
          return;
        }
      }
      // arrow keys navigate within panels
      if (k === 'ArrowDown') { e.preventDefault(); this.focusNext(1); return; }
      if (k === 'ArrowUp') { e.preventDefault(); this.focusNext(-1); return; }
      return; // while panel is open, game keys don't fire
    }

    // ---- game keys (only when no panel is open) ----
    if (k === 'Escape') { this.close(); return; }
    if (k === 'Tab' && this.hooks.isPlacing()) {
      e.preventDefault();
      this.hooks.cycleBuild(e.shiftKey ? -1 : 1);
      return;
    }
    if (e.repeat) return;
    const kl = k.toLowerCase();
    if (kl === 'e') this.hooks.interact();
    else if (kl === ' ') this.hooks.attack();
    else if (kl === 'f') this.hooks.ignite();
    else if (kl === 'b') this.toggleBuild();
    else if (kl === 'i') this.toggle('bag');
    else if (kl === 'c') this.toggle('craft');
    else if (kl === 'k') this.toggle('skills');
    else if (kl === 'l') this.toggle('log');
    else if (k === ';') this.toggle('leaderboard');
  }

  /** Cycle focus through all focusable elements within the open panel.
   *  Action items (buttons, cells, slots) come first; header chrome (tabs, close) last.
   *  Only elements with tabIndex >= 0 are included — empty slots and disabled
   *  buttons are skipped so Tab never gets stuck on an unfocusable target. */
  private focusNext(dir: number) {
    const panel = document.querySelector('.nw-panel');
    if (!panel) return;

    // action items: what the user actually wants to interact with
    const actions = Array.from(panel.querySelectorAll<HTMLElement>(
      '.nw-make:not([disabled]), .nw-cell, .nw-slot',
    )).filter(el => el.tabIndex >= 0);
    // header chrome: navigation aids
    const headers = Array.from(panel.querySelectorAll<HTMLElement>(
      '.nw-tab, .nw-x',
    )).filter(el => el.tabIndex >= 0);
    const focusable = [...actions, ...headers];
    if (!focusable.length) return;

    const current = document.activeElement as HTMLElement;
    let idx = focusable.indexOf(current);
    if (idx < 0) idx = dir > 0 ? -1 : focusable.length;
    idx = (idx + dir + focusable.length) % focusable.length;
    // guard: if focus doesn't land (e.g. element is hidden), skip forward
    const target = focusable[idx];
    target.focus();
    if (document.activeElement !== target) {
      // try the next element instead
      const next = focusable[(idx + dir + focusable.length) % focusable.length];
      if (next !== target) next.focus();
    }
  }

  // --------------------------------------------------------------- panels ----

  private toggle(p: Panel) { this.panel === p ? this.close() : this.open(p); }
  open(p: Panel) { this.panel = p; this.renderPanel(); }
  /** Just hide the panel — does NOT touch build mode (used when entering placement). */
  private hidePanel() { this.panel = null; this.panelHost.innerHTML = ''; }
  /** Dismiss the panel AND cancel any in-progress build (Esc / ✕ / scrim). */
  close() { this.hidePanel(); this.hooks.enterBuild(''); }
  isOpen() { return this.panel !== null; }

  private renderPanel() {
    this.panelHost.innerHTML = '';
    if (!this.panel) return;
    const scrim = el('div', 'nw-scrim');
    scrim.addEventListener('pointerdown', (e) => { if (e.target === scrim) this.close(); });
    const panel = el('div', 'nw-panel');
    panel.addEventListener('pointerdown', (e) => e.stopPropagation());
    scrim.appendChild(panel);
    this.panelHost.appendChild(scrim);

    const head = el('div', 'nw-phead');
    const titles: Record<string, string> = { bag: 'BAG', craft: 'CRAFTING', skills: 'SKILLS', log: 'LOG', leaderboard: 'LEADERBOARD' };
    head.innerHTML = `<h2>${titles[this.panel]}</h2>`;
    if (this.panel === 'craft') head.appendChild(this.craftTabs());
    const x = el('div', 'nw-x'); x.innerHTML = '&times;';
    x.tabIndex = 0; x.setAttribute('role', 'button'); x.setAttribute('aria-label', 'Close panel');
    x.addEventListener('click', () => this.close());
    x.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.close(); } });
    head.appendChild(el('div', 'nw-spacer'));
    head.appendChild(x);
    panel.appendChild(head);

    const body = el('div', 'nw-pbody');
    body.id = 'nw-pbody';
    panel.appendChild(body);
    this.fillBody(body);

    // auto-focus first action item (craft button, bag cell, etc.)
    requestAnimationFrame(() => {
      const first = panel.querySelector<HTMLElement>(
        '.nw-make:not([disabled]), .nw-cell, .nw-slot',
      );
      if (first) first.focus();
    });
  }

  private craftTabs() {
    const tabs = el('div', 'nw-tabs');
    for (const t of ['crafting', 'smithing', 'alchemy']) {
      const tab = el('div', 'nw-tab' + (t === this.craftTab ? ' on' : ''));
      tab.textContent = t[0].toUpperCase() + t.slice(1);
      tab.tabIndex = 0; tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', String(t === this.craftTab));
      tab.addEventListener('click', () => { this.craftTab = t; this.renderPanel(); });
      tab.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.craftTab = t; this.renderPanel(); }
      });
      tabs.appendChild(tab);
    }
    return tabs;
  }

  /** Re-fill the open panel's body (called each frame while open — cheap). */
  private fillBody(body: HTMLElement) {
    if (this.panel === 'bag') this.fillBag(body);
    else if (this.panel === 'craft') this.fillCraft(body);
    else if (this.panel === 'skills') this.fillSkills(body);
    else if (this.panel === 'log') this.fillLog(body);
    else if (this.panel === 'leaderboard') this.fillLeaderboard(body);
  }

  private fillLog(body: HTMLElement) {
    const entries = this.hooks.logEntries();
    // N2a: Chronicle shows fiction kinds only — filter out truth (network/resonance-*)
    const fictionKinds = new Set(['gather','craft','build','combat','boss','level','death','region','economy','system','spawn','world']);
    const fiction = entries.filter(e => fictionKinds.has(e.kind));
    if (!fiction.length) {
      const empty = el('div', 'nw-empty'); empty.textContent = 'Nothing has happened yet. Go do something.';
      body.appendChild(empty); return;
    }
    for (const e of fiction) {
      const row = el('div', 'nw-logrow nw-log-' + e.kind);
      const t = Math.floor(e.t);
      const kindLabel = NET_LOG_LABELS[e.kind] ?? e.kind;
      // N2a: Chronicle never gets technical styling — plain text only
      row.innerHTML = `<span class="nw-logt">${String((t / 60) | 0).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}</span><span class="nw-logk">${kindLabel}</span><span class="nw-logm">${e.msg}</span>`;
      body.appendChild(row);
    }
    // N2: export button at the bottom of the log panel
    const exportWrap = el('div', 'nw-log-export');
    const exportBtn = el('div', 'nw-btn');
    exportBtn.innerHTML = '💾 Export Log (.txt)';
    exportBtn.addEventListener('click', () => {
      (window as any).__nw?.log?.download?.();
    });
    exportWrap.appendChild(exportBtn);
    body.appendChild(exportWrap);
  }

  private fillBag(body: HTMLElement) {
    const p = this.state.player;

    // --- equipment: worn gear + read-only best tools ---
    const eq = el('div', 'nw-equip');
    eq.appendChild(this.slotCell('weapon', 'Weapon', '&#9876;'));
    eq.appendChild(this.slotCell('armor', 'Armor', '&#128737;'));
    eq.appendChild(this.slotCell('ring', 'Ring', '&#128141;'));
    eq.appendChild(this.slotCell('amulet', 'Amulet', '&#128255;'));
    eq.appendChild(this.slotCell('charm', 'Charm', '&#128302;'));
    body.appendChild(eq);

    const axe = bestTool(this.state, 'axe'), pick = bestTool(this.state, 'pick');
    const toolLv = (slot: SoulSlot) => this.state.player.soulItems?.[slot] ? ` (soul lv ${this.state.player.soulItems![slot]!.level})` : '';
    const tools = el('div', 'nw-tools');
    tools.innerHTML =
      `<span class="hd">Tools (auto)</span>` +
      `<span>&#129683; ${axe ? ITEMS[axe.id].name + toolLv('tool_axe') : '—'}</span>` +
      `<span>&#9935; ${pick ? ITEMS[pick.id].name + toolLv('tool_pick') : '—'}</span>`;
    body.appendChild(tools);

    // --- the bag itself ---
    const ids = Object.keys(p.inv).filter((id) => p.inv[id] > 0);
    if (!ids.length) {
      const empty = el('div', 'nw-empty'); empty.textContent = 'Your bag is empty. Go gather something.';
      body.appendChild(empty); return;
    }
    const grid = el('div', 'nw-grid');
    const feedSys = new SoulFeedSystem();
    for (const id of ids) {
      const def = ITEMS[id];
      const slot = slotOf(id);
      const worn = !!slot && p.equip?.[slot] === id;
      const usable = !!def.heal;
      const feedable = !slot && !usable && feedSys.canFeed(id);
      const tag = worn ? '<span class="tag on">worn</span>'
        : slot ? '<span class="tag">equip</span>'
        : usable ? '<span class="tag">use</span>'
        : feedable ? '<span class="tag feed">feed</span>' : '';
      const cell = el('div', 'nw-cell' + (worn ? ' worn' : ''));
      cell.innerHTML = `<img src="${icon(id)}" alt=""><span class="n">${p.inv[id]}</span>${tag}`;
      cell.title = def.name
        + (def.weaponDmg ? ` (+${def.weaponDmg} dmg)` : '')
        + (def.armor ? ` (+${def.armor} armor)` : '')
        + (def.heal ? ` (heals ${def.heal})` : '')
        + (feedable ? ` (soul xp: ${totalSoulXp(id)} each)` : '');
      cell.tabIndex = 0; cell.setAttribute('role', 'button');
      if (slot) {
        cell.setAttribute('aria-label', `${worn ? 'Unequip' : 'Equip'} ${def.name}`);
        cell.addEventListener('click', () => this.hooks.equip(id));
        cell.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.hooks.equip(id); } });
      } else if (usable) {
        cell.setAttribute('aria-label', `Use ${def.name}`);
        cell.addEventListener('click', () => this.hooks.useItem(id));
        cell.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.hooks.useItem(id); } });
      } else if (feedable) {
        cell.setAttribute('aria-label', `Feed ${def.name} to soul gear`);
        cell.addEventListener('click', () => this.showFeedPicker(id, p.inv[id]));
        cell.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.showFeedPicker(id, p.inv[id]); } });
      }
      grid.appendChild(cell);
    }
    body.appendChild(grid);
  }

  /** W7: show a slot picker popup for soul-feeding an item. */
  private showFeedPicker(itemId: string, available: number) {
    const def = ITEMS[itemId];
    const feedSys = new SoulFeedSystem();
    const xpEach = totalSoulXp(itemId);
    const affinity = itemSoulAffinity(itemId);
    const ALL_SLOTS: { slot: SoulSlot; label: string; glyph: string }[] = [
      { slot: 'weapon', label: 'Weapon', glyph: '⚔' },
      { slot: 'armor', label: 'Armor', glyph: '🛡' },
      { slot: 'tool_axe', label: 'Axe', glyph: '🪓' },
      { slot: 'tool_pick', label: 'Pick', glyph: '⛏' },
      { slot: 'ring', label: 'Ring', glyph: '💍' },
      { slot: 'amulet', label: 'Amulet', glyph: '📿' },
      { slot: 'charm', label: 'Charm', glyph: '🍀' },
    ];

    // Remove any existing picker
    const existing = this.panelHost.querySelector('.nw-feed-picker');
    if (existing) existing.remove();

    const picker = el('div', 'nw-feed-picker');
    picker.innerHTML = `<div class="nw-feed-hd">Feed ${def.name} (${xpEach} soul xp each)</div>`;

    for (const { slot, label, glyph } of ALL_SLOTS) {
      const si = this.state.player.soulItems?.[slot];
      const lv = si ? si.level : 1;
      const affLabel = feedSys.affinityLabel(itemId, slot);
      const row = el('div', 'nw-feed-row');
      const isAffinity = affinity === slot;
      const isOpposed = affinity && ['weapon','armor','tool_axe','tool_pick','ring','amulet','charm'].includes(slot)
        && (affinity === 'weapon' && ['armor','charm'].includes(slot)
          || affinity === 'armor' && ['weapon','ring'].includes(slot)
          || affinity === 'tool_axe' && ['tool_pick','amulet'].includes(slot)
          || affinity === 'tool_pick' && ['tool_axe','ring'].includes(slot)
          || affinity === 'ring' && ['armor','tool_pick'].includes(slot)
          || affinity === 'amulet' && ['tool_axe','charm'].includes(slot)
          || affinity === 'charm' && ['weapon','amulet'].includes(slot));
      row.className = 'nw-feed-row' + (isAffinity ? ' affinity' : '') + (isOpposed ? ' opposed' : '');
      row.innerHTML = `<span>${glyph} ${label}</span><span class="nw-feed-lv">soul lv ${lv}</span>${affLabel ? `<span class="nw-feed-aff">${affLabel}</span>` : ''}`;
      row.tabIndex = 0; row.setAttribute('role', 'button');
      row.addEventListener('click', () => {
        const count = Math.min(available, 99); // feed all available, max 99 at once
        const result = this.hooks.feedSoul(itemId, count, slot);
        if (result) {
          this.toast(
            `Fed ${count}× ${def.name} → ${label} soul +${result.xp} xp${result.leveled ? ` (lv ${result.newLevel}!)` : ''}`,
            result.leveled ? 'good' : 'info',
          );
          picker.remove();
          this.rebuildPanel();
        }
      });
      row.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); row.click(); } });
      picker.appendChild(row);
    }

    const cancel = el('div', 'nw-feed-cancel');
    cancel.textContent = 'Cancel';
    cancel.tabIndex = 0; cancel.setAttribute('role', 'button');
    cancel.addEventListener('click', () => picker.remove());
    cancel.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); picker.remove(); } });
    picker.appendChild(cancel);

    this.panelHost.appendChild(picker);
  }

  /** One equipment slot: shows the worn item + its soul level (click to unequip), or an empty placeholder. */
  private slotCell(slot: EquipSlot, label: string, glyph: string): HTMLElement {
    const id = slot === 'relic' ? this.state.player.relic : this.state.player.equip?.[slot];
    const cell = el('div', 'nw-slot' + (id ? ' filled' : ''));
    if (id) {
      const def = ITEMS[id];
      const isRelic = slot === 'relic';
      const unit = slot === 'weapon' || slot === 'ring' ? 'dmg'
        : slot === 'charm' ? 'hp/s (day)' : 'armor';
      const statVal = isRelic
        ? ((def.weaponDmg ?? def.armor ?? def.regen ?? 0).toFixed(1))
        : soulStat(this.state, slot as SoulSlot).toFixed(1);
      const stat = `+${statVal} ${unit}`;
      cell.innerHTML =
        `<img src="${icon(id)}" alt=""><div class="meta"><b>${label}</b><span>${def.name}</span>${isRelic ? '' : this.soulBarHtml(slot as SoulSlot)}<span class="stat">${stat}</span></div>`;
      cell.tabIndex = 0; cell.setAttribute('role', 'button');
      cell.setAttribute('aria-label', `Unequip ${def.name}`);
      cell.title = 'Enter/Space to unequip';
      cell.addEventListener('click', () => this.hooks.equip(id));
      cell.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.hooks.equip(id); } });
    } else {
      cell.innerHTML = `<div class="ph">${glyph}</div><div class="meta"><b>${label}</b><span class="off">empty</span></div>`;
    }
    return cell;
  }

  /** Soul-tool level chip + xp bar, shared by weapon/armor/tool displays. */
  private soulBarHtml(slot: SoulSlot): string {
    const s = this.state.player.soulItems?.[slot];
    if (!s) return '';
    const [have, need] = soulXpProgress(s.xp);
    return `<span class="nw-soullv">soul lv ${s.level}</span>
      <div class="nw-soulbar"><div class="nw-soulfill" style="width:${(100 * have / need).toFixed(0)}%"></div></div>`;
  }

  private fillCraft(body: HTMLElement) {
    const recipes = RECIPES.filter((r) => r.skill === this.craftTab);
    for (const r of recipes) {
      const outDef = ITEMS[r.out.id];
      const lvl = skillLevel(this.state, r.skill);
      const locked = lvl < r.levelReq;
      const has = invHasAll(this.state, r.in);
      const row = el('div', 'nw-row' + (locked ? ' nw-locked' : ''));
      const costs = r.in.map((s) => {
        const have = invCount(this.state, s.id) >= s.n;
        return `<span class="${have ? 'have' : 'lack'}">${invCount(this.state, s.id)}/${s.n} ${ITEMS[s.id].name}</span>`;
      }).join(' &middot; ');
      row.innerHTML = `
        <img src="${icon(r.out.id)}" alt="">
        <div class="info">
          <div class="name">${outDef.name}${r.out.n > 1 ? ' &times;' + r.out.n : ''}</div>
          <div class="sub">${locked ? `needs ${cap(r.skill)} ${r.levelReq}` : costs} &middot; +${r.xp}xp</div>
        </div>`;
      const btn = el('button', 'nw-make') as HTMLButtonElement;
      btn.textContent = 'Craft';
      btn.disabled = locked || !has;
      btn.tabIndex = locked ? -1 : 0;
      btn.addEventListener('click', () => this.hooks.craft(r.id));
      row.appendChild(btn);
      body.appendChild(row);
    }
  }

  // (the popup build menu is gone — placement browsing lives in the carousel banner)

  private fillSkills(body: HTMLElement) {
    const kindLabel: Record<string, string> = { gather: 'Gathering', craft: 'Crafting', combat: 'Combat' };
    const note = el('div', 'nw-note');
    note.innerHTML = `The <b>number</b> is your level in each skill — they rise as you use them.
      Chopping, mining and foraging train <b>gathering</b>; the workbench trains
      <b>crafting/smithing/alchemy</b>; fighting the horde trains <b>combat</b>. Higher levels unlock recipes.`;
    body.appendChild(note);
    for (const s of SKILLS) {
      const xp = this.state.player.xp[s.id] ?? 0;
      const lvl = skillLevel(this.state, s.id);
      const [have, need] = xpProgress(xp);
      const row = el('div', 'nw-skill');
      row.innerHTML = `
        <span class="lv"><b>${lvl}</b><i>Lv</i></span>
        <div class="mid">
          <div class="nm">${s.name} <span class="kind ${s.kind}">${kindLabel[s.kind]}</span></div>
          <div class="nw-xpbar"><div class="nw-xpfill" style="width:${(100 * have / need).toFixed(0)}%"></div></div>
        </div>
        <span class="xp">${have}/${need} xp</span>`;
      body.appendChild(row);
    }
  }

  // --------------------------------------------------------------- refresh ----

  /** Called every frame. Cheap top-bar text updates + gather progress.
   *  Panel body is NOT rebuilt — it's only rebuilt on open() or tab change. */
  refresh() {
    const p = this.state.player;
    this.hpFill.style.width = (100 * Math.max(0, p.hp) / CFG.player.maxHp).toFixed(1) + '%';
    this.hpText.textContent = Math.ceil(Math.max(0, p.hp)) + '';
    this.goldText.textContent = p.gold + '';

    // L1: age/lifespan chip + bar — the hard run-length clock
    const lv = this.hooks.lifespanView();
    this.ageText.textContent = String(lv.age);
    this.ageFill.style.width = (lv.frac * 100).toFixed(1) + '%';
    this.ageBadge.classList.toggle('warn', lv.warning && !lv.critical);
    this.ageBadge.classList.toggle('critical', lv.critical);
    this.ageBadge.title = lv.critical
      ? `Age ${lv.age} — your breath grows short. The dream is ending.`
      : lv.warning
      ? `Age ${lv.age} — the years weigh heavy (~${lv.minutesRemaining.toFixed(1)} min left at this pace).`
      : `Age ${lv.age} — the years pass as you dream.`;

    // S1: vigor & resolve HUD chips — pulse red at ≤25
    const vigor = Math.round(p.vigor ?? 100);
    const resolve = Math.round(p.resolve ?? 100);
    this.vigorText.textContent = String(vigor);
    this.vigorText.style.color = vigor <= 25 ? '#f66' : '';
    this.resolveText.textContent = String(resolve);
    this.resolveText.style.color = resolve <= 25 ? '#f66' : '';

    const ph = phase(this.state.clock);
    const rem = Math.ceil(phaseRemaining(this.state.clock));
    this.clock.innerHTML = ph.isNight
      ? `<span class="moon">&#9789; NIGHT ${ph.dayIndex}</span> &middot; ${rem}s`
      : `<span class="sun">&#9788; DAY ${ph.dayIndex}</span> &middot; ${rem}s`;

    const dmg = CFG.player.baseDmg + equippedWeaponDmg(this.state);
    const def = armorDef(this.state);
    this.nights.innerHTML =
      `&#9876;${dmg} &middot; &#128737;${def} &middot; &#9823;${population(this.state)} &middot; &#9873;${territoryScore(this.state)}`;

    // C1: echo chips — icon + level per held echo (rebuilt only on change)
    const held = this.state.player.echoes ?? {};
    const chips = ECHOES.filter((e) => (held[e.id] ?? 0) > 0)
      .map((e) => `<span title="${e.name} — ${e.desc}">${e.icon}${held[e.id]}</span>`)
      .join(' ');
    if (chips !== this.echoChipsCache) {
      this.echoChipsCache = chips;
      this.echoEl.style.display = chips ? '' : 'none';
      this.echoEl.innerHTML = chips;
    }

    // gather progress ring
    const gv = this.hooks.gatherView();
    if (gv) {
      this.gather.classList.add('on');
      this.gatherLabel.textContent = gv.label;
      this.gatherFill.style.width = (gv.frac * 100).toFixed(0) + '%';
    } else {
      this.gather.classList.remove('on');
    }

    // interact button reflects the current target
    const interactable = gv || this.interactTarget();
    this.interactBtn.classList.toggle('disabled', !interactable && !gv);

    // Panel body is rebuilt only when dirty (state changed) or on open/tab change.
    if (this.panel && this._dirty) {
      this._dirty = false;
      const body = document.getElementById('nw-pbody');
      if (body) { body.innerHTML = ''; this.fillBody(body); }
    }
  }

  private interactTarget() { return this.hooks.gatherView() != null; }

  /** W6/L1: Leaderboard panel — current run stats + historical "perfect run" board. */
  private fillLeaderboard(body: HTMLElement) {
    // Live stats from the running scoreboard system
    const sb = (window as any).__nw?.sys?.scoreboard;
    const liveStats = sb?.getLiveStats?.() ?? null;

    // ---- current run stats ----
    const curSec = el('div', 'nw-lb-cur');
    curSec.innerHTML = '<div class="nw-lb-sechd">CURRENT RUN</div>';
    if (liveStats) {
      curSec.innerHTML += `
        <div class="nw-lb-score">Legacy Score: <b>${liveStats.legacyScore}</b>${liveStats.legit ? '' : ' <span class="nw-lb-cheat">(god mode used — not eligible for the legit ranking)</span>'}</div>
        <div class="nw-lb-grid">
          <div class="nw-lb-stat"><span class="nw-lb-val">${liveStats.age}</span><span class="nw-lb-lbl">age</span></div>
          <div class="nw-lb-stat"><span class="nw-lb-val">${liveStats.minutesRemaining.toFixed(1)}m</span><span class="nw-lb-lbl">left</span></div>
          <div class="nw-lb-stat"><span class="nw-lb-val">${liveStats.nightsSurvived}</span><span class="nw-lb-lbl">nights</span></div>
          <div class="nw-lb-stat"><span class="nw-lb-val">${liveStats.enemiesKilled}</span><span class="nw-lb-lbl">kills</span></div>
          <div class="nw-lb-stat"><span class="nw-lb-val">${liveStats.bossesSlain}</span><span class="nw-lb-lbl">bosses</span></div>
          <div class="nw-lb-stat"><span class="nw-lb-val">${liveStats.buildingsBuilt}</span><span class="nw-lb-lbl">built</span></div>
          <div class="nw-lb-stat"><span class="nw-lb-val">${liveStats.goldHoarded}</span><span class="nw-lb-lbl">gold</span></div>
          <div class="nw-lb-stat"><span class="nw-lb-val">${formatAge(liveStats.connectionAge)}</span><span class="nw-lb-lbl">uptime</span></div>
        </div>`;
    } else {
      curSec.innerHTML += '<div class="nw-empty">Stats will appear as you play.</div>';
    }
    body.appendChild(curSec);

    // ---- historical leaderboard ----
    const histSec = el('div', 'nw-lb-hist');
    histSec.innerHTML = '<div class="nw-lb-sechd">TOP RUNS &mdash; by Legacy Score</div>';

    const entries = loadLeaderboard();
    if (!entries.length) {
      const empty = el('div', 'nw-empty');
      empty.textContent = 'No runs recorded yet. Survive, and your name will be written in the static.';
      histSec.appendChild(empty);
    } else {
      const list = el('div', 'nw-lb-list');
      let rank = 0;
      for (const e of entries) {
        rank++;
        const row = el('div', 'nw-lb-row' + (e.legit ? '' : ' cheat'));
        const rankIcon = !e.legit ? '&#128128;' : rank === 1 ? '&#129351;' : rank === 2 ? '&#129352;' : rank === 3 ? '&#129353;' : `#${rank}`;
        const causeIcon = e.causeOfDeath === 'old_age' ? '&#9203;' : e.causeOfDeath === 'hall_fallen' ? '&#128128;' : '?';
        row.innerHTML = `
          <span class="nw-lb-rank">${rankIcon}</span>
          <span class="nw-lb-score">${e.legacyScore}</span>
          <span class="nw-lb-age" title="died of ${e.causeOfDeath === 'old_age' ? 'natural causes' : e.causeOfDeath === 'hall_fallen' ? 'the hall falling' : 'unknown causes'}">${causeIcon} age ${e.age}</span>
          <span class="nw-lb-detail">${e.nightsSurvived}n &middot; ${e.enemiesKilled}k &middot; ${e.bossesSlain}b &middot; ${e.goldHoarded}g</span>
          <span class="nw-lb-realm">${e.dominantRealm}${e.legit ? '' : ' &middot; <i>god mode</i>'}</span>`;
        list.appendChild(row);
      }
      histSec.appendChild(list);
    }

    body.appendChild(histSec);
  }

  showGameOver(onRestart: () => void, card?: any) {
    const over = el('div', 'nw-gameover');
    let cardHtml = '';
    if (card) {
      const ageStr = card.connectionAge >= 3600
        ? `${Math.floor(card.connectionAge / 3600)}h ${Math.floor((card.connectionAge % 3600) / 60)}m`
        : `${Math.floor(card.connectionAge / 60)}m ${card.connectionAge % 60}s`;
      cardHtml = `
        <div style="font-size:12px;color:var(--metal-hi);margin-top:10px;">Legacy Score: <b>${card.legacyScore}</b>${card.legit ? '' : ' <span style="color:#c66">(god mode used — not eligible for the legit ranking)</span>'}</div>
        <div style="font-size:11px;color:var(--ink-dim);margin-top:8px;line-height:1.6;text-align:left;max-width:300px;">
          <div><span style="color:var(--metal-hi)">Age at death:</span> ${card.age}</div>
          <div><span style="color:var(--metal-hi)">Nights survived:</span> ${card.nightsSurvived}</div>
          <div><span style="color:var(--metal-hi)">Enemies killed:</span> ${card.enemiesKilled} (${card.bossesSlain} bosses)</div>
          <div><span style="color:var(--metal-hi)">Buildings:</span> ${card.buildingsBuilt}</div>
          <div><span style="color:var(--metal-hi)">Gold hoarded:</span> ${card.goldHoarded}</div>
          <div><span style="color:var(--metal-hi)">Dominant realm:</span> ${card.dominantRealm}</div>
          <div><span style="color:var(--metal-hi)">Rifts survived:</span> ${card.riftsSurvived}</div>
          <div><span style="color:var(--metal-hi)">Peak RTT:</span> ${card.peakRtt}ms · <span style="color:var(--metal-hi)">Lowest BW:</span> ${card.lowestDownlink}Mbps</div>
          <div><span style="color:var(--metal-hi)">Loom points:</span> ${card.loomPointsEarned}</div>
          <div><span style="color:var(--metal-hi)">Connection age:</span> ${ageStr}</div>
        </div>`;
    }
    // L1: two distinct endings — a violent hall-fall vs. a peaceful old-age
    // ending — never mixed, and never using network jargon in the fiction
    // (Veil law).
    const oldAge = card?.causeOfDeath === 'old_age';
    const title = oldAge ? 'THE DREAM FADES' : 'THE THREAD IS CUT';
    const flavor = oldAge
      ? `Your dream-self grows heavy with years and lies down beneath the dark, and does not wake.
         You lived ${card?.age ?? '?'} years and survived ${this.state.nightsSurvived} night${this.state.nightsSurvived === 1 ? '' : 's'}.`
      : `Your Hearthstone lies in ruin and the dark takes the rest.
         You survived ${this.state.nightsSurvived} night${this.state.nightsSurvived === 1 ? '' : 's'}.`;
    over.innerHTML = `<h1>${title}</h1>
      <div style="color:var(--ink-dim);max-width:340px">${flavor}</div>
      ${cardHtml}`;
    const btn = el('div', 'nw-btn primary'); btn.textContent = 'Try again';
    btn.style.pointerEvents = 'auto';
    btn.addEventListener('click', onRestart);
    over.appendChild(btn);

    // W6: "View Leaderboard" button on death screen
    const lbBtn = el('div', 'nw-btn'); lbBtn.textContent = 'Leaderboard';
    lbBtn.style.pointerEvents = 'auto';
    lbBtn.style.marginTop = '4px';
    lbBtn.addEventListener('click', () => {
      this.open('leaderboard');
    });
    over.appendChild(lbBtn);
    this.root.appendChild(over);
  }
}

// ---- small helpers ----
function el(tag: string, cls: string): HTMLElement {
  const e = document.createElement(tag);
  e.className = cls;
  return e;
}
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

// ---- N2: network log abbreviations & styling ----
/** Short pixel-style labels for each log kind. */
export const NET_LOG_LABELS: Record<string, string> = {
  'gather': 'GATHER',
  'craft': 'CRAFT',
  'build': 'BUILD',
  'combat': 'COMBAT',
  'boss': 'BOSS',
  'level': 'LVL UP',
  'death': 'DEATH',
  'region': 'REGION',
  'economy': 'ECON',
  'system': 'SYS',
  'spawn': 'SPAWN',
  'world': 'WORLD',
  'network': 'NET',
  'net-rtt': 'RTT',
  'net-bw': 'BW',
  'net-jitter': 'JITTER',
  'net-ep': 'ENDPT',
  'net-conn': 'CONN',
  'net-rift': 'RIFT',
};

/** Wrap known network abbreviations in styled <span> tags for pixel-art feel. */
export function styleNetworkMsg(msg: string): string {
  // Replace known abbreviations with styled spans
  const abbrs: [string, string][] = [
    ['RTT', 'rtt'], ['DNS', 'dns'], ['TLS', 'tls'], ['TTFB', 'ttfb'],
    ['Mbps', 'mbps'], ['HTTP', 'http'], ['TCP', 'tcp'], ['IP', 'ip'],
    ['API', 'api'], ['URL', 'url'], ['CPU', 'cpu'], ['RAM', 'ram'],
    ['GB', 'gb'], ['ms', 'ms'], ['LAN', 'lan'], ['WAN', 'wan'],
    ['WiFi', 'wifi'], ['4G', '4g'], ['3G', '3g'], ['2G', '2g'],
    ['ICMP', 'icmp'], ['CDN', 'cdn'], ['SSL', 'ssl'], ['UDP', 'udp'],
    ['NAT', 'nat'], ['DHCP', 'dhcp'], ['ISP', 'isp'], ['VPN', 'vpn'],
    ['P2P', 'p2p'], ['QoS', 'qos'], ['MTU', 'mtu'], ['ACK', 'ack'],
    ['SYN', 'syn'], ['PoP', 'pop'],
  ];
  let result = msg;
  for (const [full, _cls] of abbrs) {
    // Only replace standalone occurrences (not part of longer words)
    const regex = new RegExp(`\\b${full}\\b`, 'g');
    result = result.replace(regex, `<span class="net-abbr">${full}</span>`);
  }
  // Style numeric values: digits followed by units
  result = result.replace(/(\d+(?:\.\d+)?)\s*(ms|Mbps|GB|s|×|%|cores)/g,
    '<span class="net-val">$1</span><span class="net-unit">$2</span>');
  return result;
}

// build icons: reuse the tiny procgen building sprite as a data URL, cached
const bCache = new Map<string, string>();
import { makeBuilding } from '../../engine/procgen/sprites';
function iconBuilding(art: 'hall' | 'hut' | 'wall' | 'tower' | 'campfire' | 'trap' | 'shrine'): string {
  let u = bCache.get(art);
  if (!u) { u = makeBuilding(art, 12345).toDataURL(); bCache.set(art, u); }
  return u;
}
