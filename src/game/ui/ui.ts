// The DOM UI controller. Builds the chrome once, then refresh() is called
// every frame with a cheap read of game state; panels rebuild only while open.
// All gameplay actions are delegated back to the game via `hooks`.
import { CFG } from '../data/config';
import { ITEMS } from '../data/items';
import { SKILLS } from '../data/skills';
import { RECIPES } from '../data/recipes';
import { BUILDINGS } from '../data/buildings';
import { iconUrl } from '../../engine/procgen/icons';
import {
  invCount, invHasAll, skillLevel, xpProgress, slotOf,
  equippedWeaponDmg, armorDef, bestTool,
  population, territoryScore, soulXpProgress,
} from '../rules';
import type { SoulSlot } from '../data/soulgear';
import { phase, phaseRemaining } from '../systems/daynight';
import type { GameState } from '../state';
import type { LogEntry } from '../systems/log';
import { injectStyles } from './styles';
import { Toasts } from './toast';

export interface UIHooks {
  interact(): void;
  attack(): void;
  enterBuild(id: string): void;
  craft(id: string): void;
  useItem(id: string): void;
  equip(id: string): void;
  toggleMute(): boolean;
  newWorld(): void;
  isPlacing(): boolean;
  gatherView(): { label: string; frac: number } | null;
  logEntries(): LogEntry[];
}

type Panel = 'bag' | 'craft' | 'build' | 'skills' | 'log' | null;

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
  private clock!: HTMLElement;
  private nights!: HTMLElement;
  private domainEl!: HTMLElement;
  private muteEl!: HTMLElement;
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
      <div class="nw-badge nw-gold">&#9679; <span id="nw-gold">0</span></div>
      <div class="nw-badge nw-clock" id="nw-clock"></div>
      <div class="nw-badge" id="nw-nights" title="damage · defense · population · territory"></div>
      <div class="nw-badge nw-domain" id="nw-domain" title="the dream you stand in"></div>
      <div class="nw-spacer"></div>
      <div class="nw-badge nw-btn" id="nw-mute" style="pointer-events:auto" title="sound on/off">&#128266;</div>
      <div class="nw-badge nw-btn" id="nw-newworld" style="pointer-events:auto" title="new world">&#10227;</div>`;
    this.root.appendChild(top);
    this.hpFill = top.querySelector('#nw-hp')!;
    this.hpText = top.querySelector('#nw-hptext')!;
    this.goldText = top.querySelector('#nw-gold')!;
    this.clock = top.querySelector('#nw-clock')!;
    this.nights = top.querySelector('#nw-nights')!;
    this.domainEl = top.querySelector('#nw-domain')!;
    this.muteEl = top.querySelector('#nw-mute')!;
    top.querySelector('#nw-newworld')!.addEventListener('click', () => this.hooks.newWorld());
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
      <span class="ico">&#9874;</span>
      <div class="txt"><b class="nm"></b><span class="hint">Click to place &middot; hold &amp; drag paints walls &middot; right-click / Esc / B stops</span></div>
      <div class="nw-btn cancel" style="pointer-events:auto">Cancel</div>`;
    bar.querySelector('.cancel')!.addEventListener('click', () => this.hooks.enterBuild(''));
    this.root.appendChild(bar);
    this.buildBar = bar;
  }

  /** Show/hide the placement banner (called by the build system). */
  setBuildBanner(name: string | null) {
    if (!this.buildBar) return;
    if (!name) { this.buildBar.classList.remove('on'); return; }
    this.buildBar.querySelector('.nm')!.textContent = 'Placing ' + name;
    this.buildBar.classList.add('on');
  }

  private buildActions() {
    const bar = el('div', 'nw-actions');
    const btn = (id: string, label: string, key: string, cls = '') => {
      const b = el('div', 'nw-btn ' + cls);
      b.id = id;
      b.innerHTML = `<span>${label}</span><span class="k">${key}</span>`;
      bar.appendChild(b);
      return b;
    };
    this.interactBtn = btn('nw-interact', 'Interact', 'E', 'primary');
    const attack = btn('nw-attack', '&#9876; Attack', 'Space');
    const build = btn('nw-build', '&#9874; Build', 'B');
    const bag = btn('nw-bag', '&#127890; Bag', 'I');
    const craft = btn('nw-craft', '&#9881; Craft', 'C');
    const skills = btn('nw-skills', '&#9733; Skills', 'K');
    const log = btn('nw-log', '&#128220; Log', 'L');
    this.root.appendChild(bar);

    this.interactBtn.addEventListener('click', () => this.hooks.interact());
    attack.addEventListener('click', () => this.hooks.attack());
    build.addEventListener('click', () => this.toggleBuild());
    bag.addEventListener('click', () => this.open('bag'));
    craft.addEventListener('click', () => this.open('craft'));
    skills.addEventListener('click', () => this.open('skills'));
    log.addEventListener('click', () => this.open('log'));
  }

  /** Build button/key: while actively placing, this cancels placement instead of opening the list. */
  private toggleBuild() {
    if (this.hooks.isPlacing()) { this.hooks.enterBuild(''); this.hidePanel(); return; }
    this.toggle('build');
  }

  // ----------------------------------------------------------------- keys ----

  private onKey(e: KeyboardEvent) {
    if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
    const k = e.key.toLowerCase();
    if (k === 'escape') { this.close(); return; }
    if (e.repeat) return;
    if (k === 'e') this.hooks.interact();
    else if (k === ' ') this.hooks.attack();
    else if (k === 'b') this.toggleBuild();
    else if (k === 'i') this.toggle('bag');
    else if (k === 'c') this.toggle('craft');
    else if (k === 'k') this.toggle('skills');
    else if (k === 'l') this.toggle('log');
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
    const titles: Record<string, string> = { bag: 'BAG', craft: 'CRAFTING', build: 'BUILD', skills: 'SKILLS', log: 'LOG' };
    head.innerHTML = `<h2>${titles[this.panel]}</h2>`;
    if (this.panel === 'craft') head.appendChild(this.craftTabs());
    const x = el('div', 'nw-x'); x.innerHTML = '&times;';
    x.addEventListener('click', () => this.close());
    head.appendChild(el('div', 'nw-spacer'));
    head.appendChild(x);
    panel.appendChild(head);

    const body = el('div', 'nw-pbody');
    body.id = 'nw-pbody';
    panel.appendChild(body);
    this.fillBody(body);
  }

  private craftTabs() {
    const tabs = el('div', 'nw-tabs');
    for (const t of ['crafting', 'smithing', 'alchemy']) {
      const tab = el('div', 'nw-tab' + (t === this.craftTab ? ' on' : ''));
      tab.textContent = t[0].toUpperCase() + t.slice(1);
      tab.addEventListener('click', () => { this.craftTab = t; this.renderPanel(); });
      tabs.appendChild(tab);
    }
    return tabs;
  }

  /** Re-fill the open panel's body (called each frame while open — cheap). */
  private fillBody(body: HTMLElement) {
    if (this.panel === 'bag') this.fillBag(body);
    else if (this.panel === 'craft') this.fillCraft(body);
    else if (this.panel === 'build') this.fillBuild(body);
    else if (this.panel === 'skills') this.fillSkills(body);
    else if (this.panel === 'log') this.fillLog(body);
  }

  private fillLog(body: HTMLElement) {
    const entries = this.hooks.logEntries();
    if (!entries.length) {
      const empty = el('div', 'nw-empty'); empty.textContent = 'Nothing has happened yet. Go do something.';
      body.appendChild(empty); return;
    }
    for (const e of entries) {
      const row = el('div', 'nw-logrow nw-log-' + e.kind);
      const t = Math.floor(e.t);
      row.innerHTML = `<span class="nw-logt">${String((t / 60) | 0).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}</span><span class="nw-logk">${e.kind}</span><span class="nw-logm">${e.msg}</span>`;
      body.appendChild(row);
    }
  }

  private fillBag(body: HTMLElement) {
    const p = this.state.player;

    // --- equipment: worn gear + read-only best tools ---
    const eq = el('div', 'nw-equip');
    eq.appendChild(this.slotCell('weapon', 'Weapon', '&#9876;'));
    eq.appendChild(this.slotCell('armor', 'Armor', '&#128737;'));
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
    for (const id of ids) {
      const def = ITEMS[id];
      const slot = slotOf(id);
      const worn = !!slot && p.equip?.[slot] === id;
      const usable = !!def.heal;
      const tag = worn ? '<span class="tag on">worn</span>'
        : slot ? '<span class="tag">equip</span>'
        : usable ? '<span class="tag">use</span>' : '';
      const cell = el('div', 'nw-cell' + (worn ? ' worn' : ''));
      cell.innerHTML = `<img src="${icon(id)}" alt=""><span class="n">${p.inv[id]}</span>${tag}`;
      cell.title = def.name
        + (def.weaponDmg ? ` (+${def.weaponDmg} dmg)` : '')
        + (def.armor ? ` (+${def.armor} armor)` : '')
        + (def.heal ? ` (heals ${def.heal})` : '');
      if (slot) { cell.style.cursor = 'pointer'; cell.addEventListener('click', () => this.hooks.equip(id)); }
      else if (usable) { cell.style.cursor = 'pointer'; cell.addEventListener('click', () => this.hooks.useItem(id)); }
      grid.appendChild(cell);
    }
    body.appendChild(grid);
  }

  /** One equipment slot: shows the worn item + its soul level (click to unequip), or an empty placeholder. */
  private slotCell(slot: 'weapon' | 'armor', label: string, glyph: string): HTMLElement {
    const id = this.state.player.equip?.[slot];
    const cell = el('div', 'nw-slot' + (id ? ' filled' : ''));
    if (id) {
      const def = ITEMS[id];
      const soulStatVal = slot === 'weapon' ? equippedWeaponDmg(this.state) : armorDef(this.state);
      const stat = slot === 'weapon' ? `+${soulStatVal.toFixed(1)} dmg` : `+${soulStatVal.toFixed(1)} armor`;
      cell.innerHTML =
        `<img src="${icon(id)}" alt=""><div class="meta"><b>${label}</b><span>${def.name}</span>${this.soulBarHtml(slot)}<span class="stat">${stat}</span></div>`;
      cell.style.cursor = 'pointer';
      cell.title = 'Click to unequip';
      cell.addEventListener('click', () => this.hooks.equip(id));
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
      btn.addEventListener('click', () => this.hooks.craft(r.id));
      row.appendChild(btn);
      body.appendChild(row);
    }
  }

  private fillBuild(body: HTMLElement) {
    for (const b of BUILDINGS) {
      const has = invHasAll(this.state, b.cost);
      const already = b.unique && this.state.buildings.some((x) => x.type === b.id);
      const row = el('div', 'nw-row');
      const cost = b.cost.map((s) => {
        const ok = invCount(this.state, s.id) >= s.n;
        return `<span class="${ok ? 'have' : 'lack'}">${invCount(this.state, s.id)}/${s.n} ${ITEMS[s.id].name}</span>`;
      }).join(' &middot; ');
      const stats = [
        b.tower ? `${b.tower.dmg} dmg &middot; ${b.tower.rangeTiles} tile range &middot; every ${b.tower.cooldown}s` : '',
        `${b.hp} hp`,
      ].filter(Boolean).join(' &middot; ');
      row.innerHTML = `
        <img src="${iconBuilding(b.art)}" alt="">
        <div class="info">
          <div class="name">${b.name} ${b.pop ? `&middot; +${b.pop} pop` : ''} ${b.territory ? `&middot; +${b.territory} terr` : ''}</div>
          <div class="sub">${b.desc}</div>
          <div class="sub">${stats}</div>
          <div class="sub">${cost}</div>
        </div>`;
      const btn = el('button', 'nw-make') as HTMLButtonElement;
      btn.textContent = already ? 'Built' : has ? 'Place' : 'Need materials';
      btn.disabled = already;
      if (!has) btn.classList.add('short');
      btn.addEventListener('click', () => {
        if (already) return;
        this.hooks.enterBuild(b.id);   // enter() toasts what's missing if short
        if (invHasAll(this.state, b.cost)) this.hidePanel(); // entered placement — get out of the way
      });
      row.appendChild(btn);
      body.appendChild(row);
    }
  }

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

  /** Called every frame. Cheap top-bar text + (if open) a panel rebuild. */
  refresh() {
    const p = this.state.player;
    this.hpFill.style.width = (100 * Math.max(0, p.hp) / CFG.player.maxHp).toFixed(1) + '%';
    this.hpText.textContent = Math.ceil(Math.max(0, p.hp)) + '';
    this.goldText.textContent = p.gold + '';

    const ph = phase(this.state.clock);
    const rem = Math.ceil(phaseRemaining(this.state.clock));
    this.clock.innerHTML = ph.isNight
      ? `<span class="moon">&#9789; NIGHT ${ph.dayIndex}</span> &middot; ${rem}s`
      : `<span class="sun">&#9788; DAY ${ph.dayIndex}</span> &middot; ${rem}s`;

    const dmg = CFG.player.baseDmg + equippedWeaponDmg(this.state);
    const def = armorDef(this.state);
    this.nights.innerHTML =
      `&#9876;${dmg} &middot; &#128737;${def} &middot; &#9823;${population(this.state)} &middot; &#9873;${territoryScore(this.state)}`;

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

    if (this.panel) {
      const body = document.getElementById('nw-pbody');
      if (body) { body.innerHTML = ''; this.fillBody(body); }
    }
  }

  private interactTarget() { return this.hooks.gatherView() != null; }

  showGameOver(onRestart: () => void) {
    const over = el('div', 'nw-gameover');
    over.innerHTML = `<h1>THE RACKET FALLS</h1>
      <div style="color:var(--ink-dim);max-width:340px">Your hall is rubble and the dark has the run of the land.
      You survived ${this.state.nightsSurvived} night${this.state.nightsSurvived === 1 ? '' : 's'}.</div>`;
    const btn = el('div', 'nw-btn primary'); btn.textContent = 'Try again';
    btn.style.pointerEvents = 'auto';
    btn.addEventListener('click', onRestart);
    over.appendChild(btn);
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

// build icons: reuse the tiny procgen building sprite as a data URL, cached
const bCache = new Map<string, string>();
import { makeBuilding } from '../../engine/procgen/sprites';
function iconBuilding(art: 'hall' | 'hut' | 'wall' | 'tower'): string {
  let u = bCache.get(art);
  if (!u) { u = makeBuilding(art, 12345).toDataURL(); bCache.set(art, u); }
  return u;
}
