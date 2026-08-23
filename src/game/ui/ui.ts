// The DOM UI controller. Builds the chrome once, then refresh() is called
// every frame with a cheap read of game state; panels rebuild only while open.
// All gameplay actions are delegated back to the game via `hooks`.
import { CFG } from '../data/config';
import { itemDef, itemName } from '../data/items';
import { affixLines, escapeHtml, rarityColor, rarityDef, rarityOf } from './rarity';
import { bindItemTooltip, bindHtmlTooltip, hideItemTooltip } from './tooltip';
import { SKILLS } from '../data/skills';
import { RECIPES } from '../data/recipes';
import { BUILDINGS } from '../data/buildings';
import { HUB_SLOTS } from '../data/hub';
import type { OfferView, ReforgeView } from '../systems/hub';
import type { AffixSlot } from '../data/affixes';
import { ECHOES } from '../data/echoes';
import type { SlotView } from '../systems/abilities';
import { iconUrl } from '../../engine/procgen/icons';
import {
  invCount, invHasAll, skillLevel, xpProgress, slotOf,
  soulStat, bestTool, type EquipSlot,
  equippedWeaponDmg, armorDef,
  population, territoryScore, soulXpProgress, playerMaxHp,
} from '../rules';
import type { SoulSlot } from '../data/soulgear';
import { nodesByBranch, nodeById, type LoomBranch, type LoomNode } from '../data/loom';
import { SoulFeedSystem, totalSoulXp, itemSoulAffinity, type FeedResult } from '../systems/soulfeed';
import { phase, phaseRemaining } from '../systems/daynight';
import type { GameState } from '../state';
import type { LogEntry } from '../systems/log';
import { injectStyles } from './styles';
import { Toasts } from './toast';
import { loadLeaderboard, formatAge, CATEGORIES, rankFor } from '../systems/scoreboard';
import { COVENANTS, canSwear } from '../data/covenants';
import type { SoundingResult } from '../systems/sounding';

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
  // A3: the ability bar. The UI owns none of the rules — it draws a view model
  // and forwards two verbs, so a socket can never disagree with the system about
  // whether something is on cooldown.
  abilityView(): SlotView[];
  /** Returns whether the cast happened, so a refused press can be SEEN. A button
   *  that swallows a keystroke silently is one the player stops trusting. */
  castAbility(slot: number): { ok: boolean };
  swapAbility(slot: number): void;
  abilityTip(slot: number): { title: string; lines: string[] } | null;
  newWorld(): void;
  isPlacing(): boolean;
  gatherView(): { label: string; frac: number } | null;
  /** N4.3 + A8: every temporary world state currently acting on the player —
   *  Omens from the wire, Boons from a Wardstone. They share a chip row because
   *  they share the only property the player needs at a glance: something that
   *  is not normally true is true right now, and it ends. Both have to be
   *  visible without opening a panel — a hidden multiplier is indistinguishable
   *  from the game being broken.
   *
   *  `kind` is here rather than a composed title string because the two end
   *  differently and saying so is the point: an Omen lifts when the reading
   *  recovers OR on its safety valve, a Boon only ever runs out. */
  worldStateView(): {
    name: string; good: boolean; secs: number; blurb: string;
    kind: 'omen' | 'boon'; color?: string;
  }[];
  /** L1: current age/lifespan-remaining reading — drives the HUD chip+bar. */
  lifespanView(): { age: number; frac: number; minutesRemaining: number; warning: boolean; critical: boolean };
  /** SR1: the current act — named in the HUD because a player who cannot
   *  feel the curve cannot plan against it. */
  actView(): { label: string };
  logEntries(): LogEntry[];
  /** W7: feed an item to a soul-gear slot. Returns FeedResult or null if invalid. */
  feedSoul(itemId: string, count: number, targetSlot: SoulSlot): FeedResult | null;
  /** B3.b: spend a Loom point on a node. Returns true if it was allocated.
   *  Before this existed, LoomSystem.allocate() had no production caller at all —
   *  the tree was unreachable and every point earned was unspendable. */
  allocateLoom(nodeId: string): boolean;
  /** A6: the hub counter the player is standing at, or null. Drives the
   *  interact button's live state as well as which panel `interact()` opens —
   *  one question asked in one place, so the prompt can never promise a
   *  Reliquary the keypress does not open. */
  hubView(): { kind: 'reliquary' | 'forge' | 'sounding'; name: string } | null;
  /** A6: everything the Reliquary will sell in one slot. */
  hubOffers(slot: AffixSlot): OfferView[];
  /** A6: break a seal. Returns the refusal so the panel can SAY it — the
   *  ability bar's lesson (a button that swallows a press is one the player
   *  stops trusting), applied to a button that costs four figures. */
  hubBuy(slot: AffixSlot, sealId: string): { ok: boolean; id?: string; why?: string };
  /** A6: every carried piece the Forge-Warden will touch, with its price. */
  hubBench(): ReforgeView[];
  /** A6: rework one line on one piece. */
  hubReforge(uid: string, index: number): { ok: boolean; why?: string };
  /** N4.5: the Sounding Stone panel's view model. Null when the flag is off. */
  soundingView(): SoundingPanelView | null;
  /** N4.5: fire a sounding. The system answers for itself when it cannot. */
  runSounding(): void;
  /** N4.5/A7: swear a deeper pact. Returns the refusal so the panel can SAY it. */
  swearCovenant(id: string): { ok: boolean; why?: string };
  /** B3.b: what the Loom panel needs to draw itself. */
  loomView(): {
    points: number;
    allocated: Record<string, number>;
    canAllocate(nodeId: string): boolean;
  };
  /** SR2: the current draft offer — node ids from loom.pendingDraft. */
  draftView(): string[];
  /** SR2: gold-priced re-roll. Returns false (and changes nothing) if the
   *  player can't afford CFG.sr.draftRerollGold. */
  rerollDraft(): boolean;
  /** SR3: seconds left before an active Reckoning resolves as Outlasted, or
   *  null when no lord is currently summoned. */
  reckoningSecLeft(): number | null;
}

type Panel = 'bag' | 'craft' | 'skills' | 'loom' | 'log' | 'leaderboard' | 'reliquary' | 'forge' | 'sounding' | 'covenant' | null;

/** N4.5: the view model the Sounding Stone panel draws. */
export interface SoundingPanelView {
  pactName: string;
  budgetLabel: string;
  budgetMB: number;
  spentMB: number;
  leftMB: number;
  busy: boolean;
  count: number;
  cooldownSec: number;
  blocked: string | null;
  last: SoundingResult;
}

const icon = (id: string) => iconUrl(id, itemDef(id).icon as any);

/** B3.b: a Loom node's per-rank effects, in words. The node rows carry raw keys
 *  (`meleeDmgPct: 4`); this is the only place they are turned into something a
 *  player reads, so the label table lives here rather than in the data. */
const LOOM_EFFECT_LABEL: Record<string, string> = {
  meleeDmgPct: 'melee damage', swingSpeedPct: 'swing speed', arcWidthPct: 'swing arc',
  dmgRollFloor: 'damage floor', gatherSpeedPct: 'gather speed',
  doubleYieldChance: 'double-yield chance', craftCostReduction: 'craft cost',
  moveSpeedPct: 'move speed', armorPct: 'armour', regenPct: 'daylight regen',
  buildingHpPct: 'building HP', towerDmgPct: 'tower damage',
  towerRange: 'tower range', territoryIncomePct: 'tribute',
  pickupRadiusPct: 'pickup radius',
};
function effectSummary(n: LoomNode): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(n.effects)) {
    const label = LOOM_EFFECT_LABEL[k] ?? k;
    // craftCostReduction is the one key whose "+" means "less" — say so.
    if (k === 'craftCostReduction') parts.push(`&minus;${v}% ${label}`);
    else if (k === 'towerRange') parts.push(`+${v} tile ${label}`);
    else if (k === 'dmgRollFloor') parts.push(`+${(v * 100).toFixed(0)}% ${label}`);
    else parts.push(`+${v}% ${label}`);
  }
  return parts.join(' &middot; ') + ' <i>per rank</i>';
}

export class UI {
  private root: HTMLElement;
  private toasts: Toasts;
  private panel: Panel = null;
  /** SR0: the pause overlay, or null. Held rather than queried from the DOM so
   *  `isPaused()` is a cheap read the sim loop can make every frame. */
  private pauseEl: HTMLElement | null = null;
  /** SR2: the draft overlay, or null. Same reasoning as pauseEl. */
  private draftEl: HTMLElement | null = null;
  private craftTab = 'crafting';
  /** SR9: which leaderboard category is showing. */
  private lbCategory = 'legacy';
  /** A6: which shape the Reliquary is currently quoting. Remembered across
   *  openings — a player shopping for a blade is usually still shopping for a
   *  blade the second time they walk up. */
  private hubSlot: AffixSlot = 'weapon';

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
  private omenEl!: HTMLElement;
  private boonEl!: HTMLElement;
  private worldStateCache = '';
  private boonStateCache = '';
  private echoChipsCache = '';
  private vigorText!: HTMLElement;
  private resolveText!: HTMLElement;
  private gather!: HTMLElement;
  private gatherFill!: HTMLElement;
  private gatherLabel!: HTMLElement;
  private interactBtn!: HTMLElement;
  private panelHost!: HTMLElement;
  private buildBar!: HTMLElement;
  // A4: the orbs
  private hpOrb!: HTMLElement;
  private hpLiq!: HTMLElement;
  private hpNum!: HTMLElement;
  private vigRing!: HTMLElement;
  private abilCells: HTMLElement[] = [];
  private abilState: string[] = [];   // per-socket cache; the sweep runs every frame
  private resOrb!: HTMLElement;
  private resLiq!: HTMLElement;
  private resNum!: HTMLElement;

  constructor(private state: GameState, private hooks: UIHooks) {
    injectStyles();
    this.root = document.getElementById('hud')!;
    this.root.innerHTML = '';
    this.toasts = new Toasts(this.root);
    this.buildTop();
    this.buildGather();
    this.buildBuildBar();
    this.buildActions();
    this.buildOrbs();
    this.panelHost = document.createElement('div');
    this.root.appendChild(this.panelHost);
    window.addEventListener('keydown', (e) => this.onKey(e));
  }

  toast(msg: string, kind: 'info' | 'good' | 'bad' = 'info', color?: string) { this.toasts.push(msg, kind, color); }

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
      <div class="nw-badge" id="nw-omens" style="display:none" title="what the world is doing that it does not normally do — omens, read off the wire"></div>
      <div class="nw-badge nw-boons" id="nw-boons" style="display:none" title="what is true of YOU that is not normally true — a boon carried from a Wardstone, or an affliction something put in you"></div>
      <div class="nw-badge nw-domain" id="nw-domain" title="the realm you stand in"></div>
      <div class="nw-spacer"></div>
      <div class="nw-badge nw-btn" id="nw-mute" style="pointer-events:auto" title="sound on/off">&#128266;</div>
      <div class="nw-badge nw-btn" id="nw-lb" style="pointer-events:auto" title="leaderboard (;)">&#127942;</div>
      <div class="nw-badge nw-btn" id="nw-cov" style="pointer-events:auto" title="covenant — the data budget and the difficulty, one pact (p)">&#128737;</div>
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
    this.omenEl = top.querySelector('#nw-omens')!;
    this.boonEl = top.querySelector('#nw-boons')!;
    this.vigorText = top.querySelector('#nw-vigor-text')!;
    this.resolveText = top.querySelector('#nw-resolve-text')!;
    this.domainEl = top.querySelector('#nw-domain')!;
    this.muteEl = top.querySelector('#nw-mute')!;
    top.querySelector('#nw-newworld')!.addEventListener('click', () => this.hooks.newWorld());
    top.querySelector('#nw-lb')!.addEventListener('click', () => this.toggle('leaderboard'));
    top.querySelector('#nw-cov')!.addEventListener('click', () => this.toggle('covenant'));
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
      return `<span class="${ok ? 'have' : 'lack'}">${s.n} ${itemName(s.id)}</span>`;
    }).join(' &middot; ');
    const tower = d.tower ? ` &middot; ${d.tower.dmg} dmg / ${d.tower.rangeTiles}t` : '';
    // SR0: while this banner is up, the arrow keys STOP being movement. That is
    // a real mode switch and the only honest place to say so is the surface that
    // is already on screen for exactly as long as the switch is in effect.
    const keys = CFG.sr.keyboardOnly
      ? ` &middot; <span class="nw-ctl-k">Enter</span> place${d.dragPaint ? ' <i>(hold to paint)</i>' : ''}`
        + ` &middot; <span class="nw-ctl-k">Arrows</span> nudge &middot; <span class="nw-ctl-k">&#91; &#93;</span> swap`
      : '';
    this.buildBar.querySelector('.cost')!.innerHTML = cost + tower + keys;
    this.buildBar.classList.add('on');
  }

  /** A3: four sockets for the empowered echoes, keys 1-4.
   *
   *  Rendered as the first child of `.nw-actions` with `flex-basis: 100%`, so it
   *  takes its own line ABOVE the verb buttons and inherits the whole responsive
   *  wrap/scale story the action bar already solved. An absolutely-positioned
   *  second bar would have needed its own bottom-offset arithmetic and would have
   *  drifted the first time the action row wrapped on a narrow window.
   *
   *  Sockets are `tabindex=0` because the bar has to be reachable without a mouse
   *  -- keys 1-4 are the primary path, and the tooltip binds `focus` as well as
   *  `mouseenter` so the keyboard path can read what it is about to press. */
  private buildAbilities(bar: HTMLElement) {
    const row = el('div', 'nw-abilrow');
    for (let i = 0; i < 4; i++) {
      const c = el('div', 'nw-abil');
      c.dataset.slot = String(i);
      c.tabIndex = 0;
      c.setAttribute('role', 'button');
      c.innerHTML = '<span class="ab-icon"></span><span class="ab-sweep"></span>'
        + '<span class="ab-lv"></span><span class="ab-cost"></span>'
        + `<span class="k">${i + 1}</span>`;
      c.addEventListener('click', () => this.pressAbility(i));
      // right-click rebinds. Suppressing the browser menu on a 44px socket is
      // safe; suppressing it on the whole HUD would not be.
      c.addEventListener('contextmenu', (e) => { e.preventDefault(); this.hooks.swapAbility(i); });
      bindHtmlTooltip(c, () => this.abilityTipHtml(i));
      row.appendChild(c);
      this.abilCells.push(c);
    }
    bar.appendChild(row);
  }

  /** Fire a socket and answer for it either way: the cooldown sweep already says
   *  "not yet", but "not enough resolve" and "nothing bound here" have no standing
   *  visual, and both are common. */
  private pressAbility(slot: number) {
    const c = this.abilCells[slot];
    const r = this.hooks.castAbility(slot);
    if (r?.ok || !c) return;
    c.classList.remove('deny');
    void c.offsetWidth;          // restart the animation on a rapid second press
    c.classList.add('deny');
    setTimeout(() => c.classList.remove('deny'), 320);
  }

  private abilityTipHtml(slot: number): string {
    const t = this.hooks.abilityTip(slot);
    if (!t) return '';
    const v = this.hooks.abilityView()[slot];
    const color = v?.id ? v.color : '#8d8577';
    return `<div class="nw-tip-name" style="color:${color}">${t.title}</div>`
      + `<div class="nw-tip-body">${t.lines.map((l) => `<div class="nw-tip-line">${l}</div>`).join('')}</div>`;
  }

  private buildActions() {
    const bar = el('div', 'nw-actions');
    this.buildAbilities(bar);
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

    // SR2: the draft takes priority over everything, including the ability
    // bar's own Digit1-4 — a level-up is a bigger interrupt than a slot swap,
    // and the two can never overlap in practice since the sim is frozen.
    if (this.draftEl) {
      const digit = /^Digit([1-9])$/.exec(e.code ?? '');
      if (digit) {
        e.preventDefault();
        const id = this.draftIds[+digit[1] - 1];
        if (id) this.pickDraftCard(id);
      }
      return; // no other key does anything while the Loom is calling
    }

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
    if (k === 'Escape') {
      // SR0: Escape has a priority order, and it is the order of least surprise:
      // back out of placement first, then out of the pause menu, and only open
      // the pause menu when there was nothing to back out of.
      if (this.hooks.isPlacing()) { this.close(); return; }
      this.togglePause();
      return;
    }
    if (k === 'Tab' && this.hooks.isPlacing()) {
      e.preventDefault();
      this.hooks.cycleBuild(e.shiftKey ? -1 : 1);
      return;
    }
    if (e.repeat) return;
    // A3: the bar. Read from e.code, not e.key -- Shift+1 is '!' on a US layout
    // and something else again on most others, so the shift-to-rebind chord would
    // have been unreachable for anyone not typing US English.
    const digit = /^Digit([1-4])$/.exec(e.code ?? '');
    if (digit) {
      e.preventDefault();
      const slot = +digit[1] - 1;
      if (e.shiftKey) this.hooks.swapAbility(slot);
      else this.pressAbility(slot);
      return;
    }
    const kl = k.toLowerCase();
    if (kl === 'e') this.hooks.interact();
    else if (kl === ' ') this.hooks.attack();
    else if (kl === 'f') this.hooks.ignite();
    else if (kl === 'b') this.toggleBuild();
    else if (kl === 'i') this.toggle('bag');
    else if (kl === 'c') this.toggle('craft');
    else if (kl === 'k') this.toggle('skills');
    else if (kl === 'm') this.toggle('loom');
    else if (kl === 'l') this.toggle('log');
    else if (kl === 'p') this.toggle('covenant');
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
  close() { hideItemTooltip(); this.hidePanel(); this.hooks.enterBuild(''); }
  isOpen() { return this.panel !== null || this.isDrafting(); }

  private renderPanel() {
    hideItemTooltip();   // A4: a rebuild orphans the cell the tooltip was anchored to
    this.panelHost.innerHTML = '';
    if (!this.panel) return;
    const scrim = el('div', 'nw-scrim');
    scrim.addEventListener('pointerdown', (e) => { if (e.target === scrim) this.close(); });
    const panel = el('div', 'nw-panel');
    panel.addEventListener('pointerdown', (e) => e.stopPropagation());
    scrim.appendChild(panel);
    this.panelHost.appendChild(scrim);

    const head = el('div', 'nw-phead');
    const titles: Record<string, string> = { bag: 'BAG', craft: 'CRAFTING', skills: 'SKILLS', loom: 'THE LOOM', log: 'LOG', leaderboard: 'LEADERBOARD', reliquary: 'THE RELIQUARY', forge: 'THE FORGE-WARDEN', sounding: 'THE SOUNDING STONE', covenant: 'THE COVENANT' };
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
        '.nw-loomnode.can, .nw-make:not([disabled]), .nw-cell, .nw-slot',
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
    else if (this.panel === 'loom') this.fillLoom(body);
    else if (this.panel === 'log') this.fillLog(body);
    else if (this.panel === 'leaderboard') this.fillLeaderboard(body);
    else if (this.panel === 'reliquary') this.fillReliquary(body);
    else if (this.panel === 'forge') this.fillForge(body);
    else if (this.panel === 'sounding') this.fillSounding(body);
    else if (this.panel === 'covenant') this.fillCovenant(body);
  }

  // ---------------------------------------------------------- A6: the hub ----

  /** The purse line both hub panels open with. Gold is the only currency the
   *  HUD does not show a bar for, so a shop that did not state it would make
   *  every price unreadable. */
  private purseLine(need: number): HTMLElement {
    const gold = this.state.player.gold;
    const row = el('div', 'nw-hub-purse');
    row.innerHTML = `<span>Your purse</span><b class="${gold < need ? 'lack' : ''}">${gold} gold</b>`;
    return row;
  }

  private fillReliquary(body: HTMLElement) {
    const offers = this.hooks.hubOffers(this.hubSlot);
    const note = el('div', 'nw-note');
    note.innerHTML = `A sealed relic is bought <b>unopened</b>. You choose the shape and the
      seal &mdash; what is inside is the seal's business. Nothing here reaches the rift.`;
    body.appendChild(note);
    body.appendChild(this.purseLine(offers.length ? offers[0].gold : 0));

    const chips = el('div', 'nw-hub-slots');
    for (const s of HUB_SLOTS) {
      const chip = el('div', 'nw-hub-slot' + (s.slot === this.hubSlot ? ' on' : ''));
      chip.textContent = `${s.glyph} ${s.label}`;
      chip.tabIndex = 0; chip.setAttribute('role', 'tab');
      chip.setAttribute('aria-selected', String(s.slot === this.hubSlot));
      const pick = () => { this.hubSlot = s.slot; this.renderPanel(); };
      chip.addEventListener('click', pick);
      chip.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
      chips.appendChild(chip);
    }
    body.appendChild(chips);

    for (const o of offers) {
      const row = el('div', 'nw-row nw-seal');
      // The stock is shown because "you buy the shape and the odds" is only
      // honest if the shape is visible. A seal that quietly excludes half the
      // ladder while the panel says nothing is a shop lying by omission.
      //
      // 2026-08-22: the WHOLE ladder is drawn, with the bases this seal cannot
      // reach greyed. Rendering only the reachable half was honest and useless
      // — four icons tells you nothing without the denominator, and the thing a
      // seal's price actually buys is the part that used to be invisible. Greyed
      // out, the three rows become a comparison: you can see the Lesser Seal's
      // shelf run the length of the ladder and the Lord's Seal start two thirds
      // up it, which is the entire argument for the extra 1,160 gold.
      const stock = o.shelf.map((e) =>
        `<img class="${e.reachable ? '' : 'off'}" src="${icon(e.id)}" alt=""`
        + ` title="${escapeHtml(itemName(e.id))}${e.reachable ? '' : ' — beyond this seal'}">`).join('');
      row.innerHTML = `
        <div class="info">
          <div class="name">${o.seal.name} &middot; <span class="band">${o.floor} &rarr; ${o.ceiling}</span></div>
          <div class="sub">${o.seal.blurb}</div>
          <div class="nw-hub-stock">${stock}</div>
        </div>
        <span class="price${o.affordable ? '' : ' lack'}">${o.gold}g</span>`;
      const btn = el('button', 'nw-make' + (o.affordable ? '' : ' short')) as HTMLButtonElement;
      btn.textContent = 'Break seal';
      btn.disabled = !o.affordable;
      btn.addEventListener('click', () => {
        const r = this.hooks.hubBuy(this.hubSlot, o.seal.id);
        if (!r.ok && r.why) this.toast(r.why, 'bad');
        this.renderPanel();
      });
      row.appendChild(btn);
      body.appendChild(row);
    }
  }

  private fillForge(body: HTMLElement) {
    const bench = this.hooks.hubBench();
    const note = el('div', 'nw-note');
    note.innerHTML = `The Forge-Warden reworks <b>one line</b> on one piece, and the new line
      can be worse than the old one. Each rework on the same piece costs more than the last.`;
    body.appendChild(note);
    body.appendChild(this.purseLine(bench.length ? Math.min(...bench.map((b) => b.gold)) : 0));

    if (!bench.length) {
      const empty = el('div', 'nw-empty');
      empty.textContent = 'Nothing you carry has a line worth reworking. Plain gear has none.';
      body.appendChild(empty);
      return;
    }

    for (const v of bench) {
      const lines = affixLines(v.uid);
      const card = el('div', 'nw-bench');
      const mats = v.mats.map((m) => {
        const have = invCount(this.state, m.id) >= m.n;
        return `<span class="${have ? 'have' : 'lack'}">${m.n}&times; ${itemName(m.id)}</span>`;
      }).join(' &middot; ');
      const hd = el('div', 'nw-bench-hd');
      hd.innerHTML = `
        <img src="${icon(v.uid)}" alt="">
        <div class="nm"><span style="color:${v.color}">${escapeHtml(v.name)}</span>
          <div class="nw-bench-worn">${v.worn ? '<b>worn</b> &middot; ' : ''}${v.rarity}${v.prior ? ` &middot; reworked ${v.prior}&times;` : ''} &middot; ${mats}</div></div>
        <span class="cost${v.affordable ? '' : ' lack'}">${v.gold}g</span>`;
      card.appendChild(hd);

      for (const a of v.affixes) {
        const btn = el('button', 'nw-affix' + (a.cursed ? ' cursed' : '')) as HTMLButtonElement;
        btn.innerHTML = `<span class="txt">${escapeHtml(lines[a.index]?.text ?? a.label)}</span>`
          + `<span class="rew">${a.cursed ? 'recast the curse' : 'rework'}</span>`;
        btn.disabled = !v.affordable;
        btn.addEventListener('click', () => {
          const r = this.hooks.hubReforge(v.uid, a.index);
          if (!r.ok && r.why) this.toast(r.why, 'bad');
          this.renderPanel();
        });
        card.appendChild(btn);
      }
      body.appendChild(card);
    }
  }

  // -------------------------------------------------- N4.5/A7: the stone ----

  private fillSounding(body: HTMLElement) {
    const v = this.hooks.soundingView();
    if (!v) {
      const empty = el('div', 'nw-empty');
      empty.textContent = 'There is no stone here.';
      body.appendChild(empty);
      return;
    }
    const note = el('div', 'nw-note');
    note.innerHTML = `The stone listens to the deep and spends <b>your</b> data to do it. The budget
      is what your pact consents to, and it is a hard ceiling for the whole run — not a per-sounding rate.`;
    body.appendChild(note);

    const row = el('div', 'nw-row');
    row.innerHTML = `<div class="info">
      <div class="name">${escapeHtml(v.pactName)}</div>
      <div class="sub">${escapeHtml(v.budgetLabel)} &middot; ${v.spentMB.toFixed(1)} of ${v.budgetMB} MB spent &middot; ${v.leftMB.toFixed(1)} MB left &middot; ${v.count} sounding${v.count === 1 ? '' : 's'}</div>
    </div>`;
    body.appendChild(row);

    const reason = v.blocked;
    const btn = el('button', 'nw-make') as HTMLButtonElement;
    btn.textContent = v.busy ? 'Listening…' : 'Listen';
    btn.disabled = !!reason;
    btn.addEventListener('click', () => this.hooks.runSounding());
    body.appendChild(btn);

    // The blocked() reason is shown VERBATIM — a stone that is greyed out with
    // no explanation is the exact failure the Lens spent two milestones
    // stamping out on the readings side.
    if (reason) {
      const why = el('div', 'nw-note');
      why.textContent = reason;
      body.appendChild(why);
    }

    const last = v.last;
    if (last && last.verdict) {
      const res = el('div', 'nw-row');
      res.innerHTML = `<div class="info">
        <div class="name">Last reading</div>
        <div class="sub">${escapeHtml(last.verdict)}</div>
        <div class="sub">${last.live
          ? `down ${last.downMbps.toFixed(1)} Mbps &middot; up ${last.upMbps.toFixed(1)} Mbps &middot; silt ${last.bloatGrade}`
            + (last.resolverName ? ` &middot; ${escapeHtml(last.resolverName)} ${last.resolverMs.toFixed(0)}ms` : '')
          : 'the stone heard nothing'}</div>
      </div>`;
      body.appendChild(res);
    }
  }

  private fillCovenant(body: HTMLElement) {
    const current = this.state.covenant ?? 'quiet';
    const note = el('div', 'nw-note');
    note.innerHTML = `A covenant is a pact and a data budget — the same row. Deeper pacts make the nights
      harder and the loot better, and every tier's <b>megabyte cost is stated here</b>, before you swear.
      A pact can only be sworn deeper, never renounced.`;
    body.appendChild(note);

    for (const c of COVENANTS) {
      const sworn = c.id === current;
      const can = canSwear(current, c.id);
      const row = el('div', 'nw-row nw-seal' + (sworn ? ' on' : ''));
      row.innerHTML = `<div class="info">
        <div class="name" style="color:${c.color}">${escapeHtml(c.name)}${sworn ? ' &middot; sworn' : ''}</div>
        <div class="sub">${escapeHtml(c.blurb)}</div>
        <div class="sub"><b>${escapeHtml(c.cost)}</b></div>
        <div class="sub">${c.budgetMB} MB over a run &middot; ~${c.soundings} soundings &middot; enemies &times;${c.hpMul} hp &middot; &times;${c.dmgMul} dmg &middot; ${escapeHtml(c.rarityFloor)}-or-better loot${c.riftborn ? ' &middot; Riftborn reachable' : ''} &middot; Legacy &times;${c.legacyMul}</div>
      </div>`;
      const btn = el('button', 'nw-make') as HTMLButtonElement;
      if (sworn) {
        btn.textContent = 'Sworn';
        btn.disabled = true;
      } else if (can) {
        btn.textContent = 'Swear';
        btn.addEventListener('click', () => {
          const r = this.hooks.swearCovenant(c.id);
          if (!r.ok && r.why) this.toast(r.why, 'bad');
          this.renderPanel();
        });
      } else {
        btn.textContent = 'Unreachable';
        btn.disabled = true;
        btn.title = 'A pact can only be sworn deeper';
      }
      row.appendChild(btn);
      body.appendChild(row);
    }
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
      `<span>&#129683; ${axe ? itemName(axe.id) + toolLv('tool_axe') : '—'}</span>` +
      `<span>&#9935; ${pick ? itemName(pick.id) + toolLv('tool_pick') : '—'}</span>`;
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
      const def = itemDef(id);
      const slot = slotOf(id);
      const worn = !!slot && p.equip?.[slot] === id;
      const usable = !!def.heal;
      const feedable = !slot && !usable && feedSys.canFeed(id);
      const tag = worn ? '<span class="tag on">worn</span>'
        : slot ? '<span class="tag">equip</span>'
        : usable ? '<span class="tag">use</span>'
        : feedable ? '<span class="tag feed">feed</span>' : '';
      // A4: the cell carries its tier as a ring, and the REAL tooltip replaces
      // `cell.title`. A browser title attribute cannot be coloured, cannot show
      // a green +3.4 against a red −1.2, and takes a second of stillness to
      // appear — which made every rolled item effectively invisible.
      const rar = rarityOf(id);
      const cell = el('div', 'nw-cell' + (worn ? ' worn' : '') + (rar !== 'plain' ? ' rolled' : ''));
      cell.innerHTML = `<img src="${icon(id)}" alt=""><span class="n">${p.inv[id]}</span>${tag}`;
      if (rar !== 'plain') cell.style.setProperty('--rar', rarityColor(id));
      bindItemTooltip(cell, this.state, id);
      if (feedable) cell.title = `soul xp: ${totalSoulXp(id)} each`;
      cell.tabIndex = 0; cell.setAttribute('role', 'button');
      if (slot) {
        cell.setAttribute('aria-label', `${worn ? 'Unequip' : 'Equip'} ${itemName(id)}`);
        cell.addEventListener('click', () => this.hooks.equip(id));
        cell.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.hooks.equip(id); } });
      } else if (usable) {
        cell.setAttribute('aria-label', `Use ${itemName(id)}`);
        cell.addEventListener('click', () => this.hooks.useItem(id));
        cell.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.hooks.useItem(id); } });
      } else if (feedable) {
        cell.setAttribute('aria-label', `Feed ${itemName(id)} to soul gear`);
        cell.addEventListener('click', () => this.showFeedPicker(id, p.inv[id]));
        cell.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.showFeedPicker(id, p.inv[id]); } });
      }
      grid.appendChild(cell);
    }
    body.appendChild(grid);
  }

  /** W7: show a slot picker popup for soul-feeding an item. */
  private showFeedPicker(itemId: string, available: number) {
    const def = itemDef(itemId);
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
      const def = itemDef(id);
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
      const outDef = itemDef(r.out.id);
      const lvl = skillLevel(this.state, r.skill);
      const locked = lvl < r.levelReq;
      const has = invHasAll(this.state, r.in);
      const row = el('div', 'nw-row' + (locked ? ' nw-locked' : ''));
      const costs = r.in.map((s) => {
        const have = invCount(this.state, s.id) >= s.n;
        return `<span class="${have ? 'have' : 'lack'}">${invCount(this.state, s.id)}/${s.n} ${itemName(s.id)}</span>`;
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

  /** B3.b — the Loom panel.
   *
   *  This did not exist. `LoomSystem.allocate()` shipped with C3 and had zero
   *  production call sites: no panel, no tab, no key. A player earned points, was
   *  toasted about them, saw them totalled on the end-of-run scorecard, and could
   *  never spend one. The whole tree — 40 nodes, 132 ranks, 4 keystones — was
   *  unreachable by any means. §12 Q3 asked whether the tree was the right size for
   *  a 15-minute run; the honest answer was that its size did not matter yet.
   *
   *  Laid out as the data intends: three branches by `branch`, ordered by the
   *  `col`/`row` position hints the node rows have always carried and nothing had
   *  ever read. Keystones sort last within their branch — they are the terminals. */
  private fillLoom(body: HTMLElement) {
    const view = this.hooks.loomView();

    const note = el('div', 'nw-note');
    note.innerHTML = `Nights survived and lords slain weave the <b>Loom</b>. Spend points to
      thread passives; a <b>keystone</b> warps a rule outright and carries a cost.
      <b>There is no unweaving</b> — a run is its weave.`;
    body.appendChild(note);

    const bank = el('div', 'nw-loombank');
    bank.innerHTML = view.points > 0
      ? `<b>${view.points}</b> point${view.points === 1 ? '' : 's'} unspent`
      : `<span class="none">No points to spend — survive a night, or fell a lord.</span>`;
    body.appendChild(bank);

    const cols = el('div', 'nw-loomcols');
    const branchLabel: Record<LoomBranch, string> = {
      war: 'War', field: 'Field', ward: 'Ward',
    };
    for (const branch of ['war', 'field', 'ward'] as LoomBranch[]) {
      const col = el('div', 'nw-loomcol');
      const head = el('div', 'nw-loomhead');
      head.textContent = branchLabel[branch];
      col.appendChild(head);

      const nodes = nodesByBranch(branch).slice().sort((a, b) =>
        (a.keystone ? 1 : 0) - (b.keystone ? 1 : 0) || a.col - b.col || a.row - b.row);

      for (const n of nodes) {
        const rank = view.allocated[n.id] ?? 0;
        const can = view.canAllocate(n.id);
        const maxed = rank >= n.maxRank;
        const row = el('div', 'nw-loomnode'
          + (n.keystone ? ' keystone' : '')
          + (rank > 0 ? ' taken' : '')
          + (maxed ? ' maxed' : '')
          + (can ? ' can' : ''));

        const reqNames = (n.req ?? [])
          .filter((r) => (view.allocated[r] ?? 0) <= 0)
          .map((r) => nodeById(r)?.name ?? r);
        const why = maxed ? 'Fully woven'
          : reqNames.length ? `Needs ${reqNames.join(', ')}`
          : view.points <= 0 ? 'No points'
          : 'Weave it';

        row.innerHTML = `
          <div class="nm">${n.name}${n.keystone ? '<span class="ks">keystone</span>' : ''}</div>
          <div class="ef">${n.keystone ? (n.keystoneDesc ?? '') : effectSummary(n)}</div>
          <div class="ft"><span class="rk">${rank}/${n.maxRank}</span><span class="wy">${why}</span></div>`;

        if (can) {
          row.tabIndex = 0;
          row.setAttribute('role', 'button');
          row.addEventListener('click', () => {
            if (this.hooks.allocateLoom(n.id)) this.renderPanel();
          });
          row.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              if (this.hooks.allocateLoom(n.id)) this.renderPanel();
            }
          });
        }
        col.appendChild(row);
      }
      cols.appendChild(col);
    }
    body.appendChild(cols);
  }

  /** A4 — the orbs.
   *
   *  The top bar already shows HP, Vigor and Resolve as numbers, and those stay:
   *  a number answers "how much", which is what you want when you are reading
   *  the bar. An orb answers "how bad is this" without moving your eye off the
   *  middle of the screen, which is where a night fight actually happens. The
   *  two are complementary, so this adds rather than replaces.
   *
   *  Vigor is a RING around the HP orb rather than a third globe. It is a rate,
   *  not a pool — giving it equal visual weight to the two things that can end
   *  or cripple a run would say something false about it. */
  private buildOrbs() {
    const mk = (cls: string, extra = '') => {
      const o = el('div', 'nw-orb ' + cls);
      // The liquid is clipped by an inner `.bowl` rather than by the orb
      // itself: the Vigor ring sits OUTSIDE the orb's circle, and an
      // `overflow: hidden` on the orb deleted it entirely. Caught in the first
      // live capture — the orbs looked right and the ring simply was not there.
      o.innerHTML = extra + '<div class="bowl"><div class="liq"></div></div>'
        + '<div class="gloss"></div><div class="num"></div>';
      this.root.appendChild(o);
      return o;
    };
    this.hpOrb = mk('hp', '<div class="vig"></div>');
    this.hpLiq = this.hpOrb.querySelector('.liq')!;
    this.hpNum = this.hpOrb.querySelector('.num')!;
    this.vigRing = this.hpOrb.querySelector('.vig')!;
    this.resOrb = mk('res');
    this.resLiq = this.resOrb.querySelector('.liq')!;
    this.resNum = this.resOrb.querySelector('.num')!;
  }

  /** scaleY on a bottom-anchored fill, not a height change: a transform is
   *  composited and a height is a layout, and this runs every frame. */
  private syncOrbs() {
    const p = this.state.player;
    const hpFrac = Math.max(0, Math.min(1, p.hp / playerMaxHp(this.state)));
    this.hpLiq.style.transform = `scaleY(${hpFrac.toFixed(3)})`;
    this.hpNum.textContent = String(Math.ceil(Math.max(0, p.hp)));
    this.hpOrb.classList.toggle('low', hpFrac > 0 && hpFrac < 0.25);

    const vig = Math.max(0, Math.min(100, p.vigor ?? 100));
    this.vigRing.style.setProperty('--vig', vig.toFixed(0) + '%');

    const res = Math.max(0, Math.min(100, p.resolve ?? 100));
    this.resLiq.style.transform = `scaleY(${(res / 100).toFixed(3)})`;
    this.resNum.textContent = String(Math.round(res));
    this.resOrb.classList.toggle('low', res > 0 && res < 25);
  }

  /** A3: the sockets, every frame.
   *
   *  The cooldown sweep is a CSS conic-gradient driven by one custom property, so
   *  the per-frame write is a single `setProperty` on a compositor-friendly
   *  background and never touches layout. Everything ELSE about a socket (which
   *  echo, what level, affordable or not) changes rarely, so it is diffed against
   *  a cached signature string and only written when it actually differs --
   *  otherwise four innerHTML writes per frame would sit in the hot path for the
   *  entire run to redraw text that has not changed since the last lord died. */
  private syncAbilities() {
    const view = this.hooks.abilityView();
    for (let i = 0; i < this.abilCells.length; i++) {
      const c = this.abilCells[i];
      const v: SlotView | undefined = view[i];
      if (!v) { c.style.display = 'none'; continue; }
      c.style.display = '';
      // the sweep: 0 when ready, 1 the instant it was cast
      c.style.setProperty('--cd', v.cooldownFrac.toFixed(3));
      const sig = `${v.id ?? ''}|${v.level}|${v.cost}|${v.affordable ? 1 : 0}|${v.ready ? 1 : 0}`;
      if (sig === this.abilState[i]) continue;
      this.abilState[i] = sig;
      c.classList.toggle('empty', !v.id);
      c.classList.toggle('poor', !!v.id && !v.affordable);
      c.classList.toggle('ready', !!v.id && v.ready && v.affordable);
      c.style.setProperty('--ab', v.color);
      (c.querySelector('.ab-icon') as HTMLElement).textContent = v.icon;
      (c.querySelector('.ab-lv') as HTMLElement).textContent = v.level > 1 ? String(v.level) : '';
      (c.querySelector('.ab-cost') as HTMLElement).textContent = v.id ? String(v.cost) : '';
      c.setAttribute('aria-label', v.id
        ? `${v.name} — the ${v.echoName} echo, ${v.cost} resolve`
        : `Ability slot ${i + 1}, empty`);
    }
  }

  // --------------------------------------------------------------- refresh ----

  /** Called every frame. Cheap top-bar text updates + gather progress.
   *  Panel body is NOT rebuilt — it's only rebuilt on open() or tab change. */
  refresh() {
    const p = this.state.player;
    this.hpFill.style.width = (100 * Math.max(0, p.hp) / playerMaxHp(this.state)).toFixed(1) + '%';
    this.hpText.textContent = Math.ceil(Math.max(0, p.hp)) + '';
    this.goldText.textContent = p.gold + '';
    this.syncOrbs();
    this.syncAbilities();

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
    const act = this.hooks.actView();
    // SR3: a countdown the player can plan against, same reasoning SR1 named
    // the acts for — replaces the act label rather than sitting beside it,
    // because once a lord is summoned "The Reckoning" IS the act.
    const reckSec = this.hooks.reckoningSecLeft();
    const actHtml = reckSec != null
      ? `<span class="nw-act nw-reck">&#9876; THE RECKONING &mdash; ${Math.max(0, Math.ceil(reckSec))}s</span>`
      : `<span class="nw-act">${act.label}</span>`;
    this.clock.innerHTML = (ph.isNight
      ? `<span class="moon">&#9789; NIGHT ${ph.dayIndex}</span> &middot; ${rem}s`
      : `<span class="sun">&#9788; DAY ${ph.dayIndex}</span> &middot; ${rem}s`)
      + ` &middot; ${actHtml}`;

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

    // N4.3 + A8: omen and boon chips. For an omen the countdown is the
    // safety-valve expiry and not a promise — a Famine can lift the moment
    // throughput recovers, which is the point. For a boon it is the whole
    // truth. Saying the wrong one of those would make the HUD lie about the
    // only number on it the player is actually watching.
    //
    // **Two rows, not one (2026-08-22).** These shared `#nw-omens` until a
    // count made the problem obvious: `CFG.omens.maxActive` is 3 and
    // `CFG.a8.maxBoons` is 3, so the single row could carry SIX chips joined by
    // middots — a sentence-long strip of coloured text to be parsed mid-fight.
    // The split is not really about the count though. An omen is something
    // happening to the world and a boon is something true about you; they are
    // answers to different questions, and a player glancing down is only ever
    // asking one of them. Sharing a row meant neither could be found without
    // reading both.
    const chipHtml = (o: any) =>
      `<span title="${o.blurb} — ${o.kind === 'omen'
        ? `lifts when the reading recovers, or in ${o.secs}s`
        : `fades in ${o.secs}s`}"`
      + ` style="color:${o.color ?? (o.good ? '#8fd98f' : '#f08a6a')};">${o.name} ${o.secs}s</span>`;

    const world = this.hooks.worldStateView();
    // Partitioned on `kind`, which main() already stamps on every row. Deriving
    // it here from `color` or `good` instead would be a second source of truth
    // for the same fact, and the two would disagree the first time a benign
    // omen was authored.
    const omenChips = world.filter((o: any) => o.kind === 'omen').map(chipHtml).join(' &middot; ');
    const boonChips = world.filter((o: any) => o.kind !== 'omen').map(chipHtml).join(' &middot; ');
    if (omenChips !== this.worldStateCache) {
      this.worldStateCache = omenChips;
      this.omenEl.style.display = omenChips ? '' : 'none';
      this.omenEl.innerHTML = omenChips;
    }
    if (boonChips !== this.boonStateCache) {
      this.boonStateCache = boonChips;
      this.boonEl.style.display = boonChips ? '' : 'none';
      this.boonEl.innerHTML = boonChips;
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

    // Panel body is rebuilt only when dirty (state changed) or on open/tab
    // change. The Sounding Stone is the exception: its cooldown and budget are
    // live numbers, so it rebuilds while open.
    if (this.panel && (this._dirty || this.panel === 'sounding')) {
      this._dirty = false;
      const body = document.getElementById('nw-pbody');
      if (body) { body.innerHTML = ''; this.fillBody(body); }
    }
  }

  /** A6: the interact button lights for a hub counter as well as a node, and
   *  says which. Without this the one HUD affordance the player has for "there
   *  is something here" would go dark standing in front of the two most
   *  expensive buildings in the game. */
  private interactTarget() {
    const hub = this.hooks.hubView();
    const label = hub ? hub.name : 'Interact';
    if (this.interactBtn.title !== label) {
      this.interactBtn.title = label;
      this.interactBtn.setAttribute('aria-label', hub ? `Open ${label}` : 'Interact');
      const l = this.interactBtn.querySelector('.nw-btn-label');
      if (l) l.textContent = label;
    }
    return hub ? true : this.hooks.gatherView() != null;
  }

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
    const cat = CATEGORIES.find((c) => c.id === this.lbCategory) ?? CATEGORIES[0];
    const sechd = el('div', 'nw-lb-sechd');
    sechd.textContent = `TOP RUNS — ${cat.label}`;
    histSec.appendChild(sechd);

    // SR9: category tabs — reuses the exact craft-tab pattern/CSS rather than
    // a new tab widget. Three, per the plan's own "ship three, not six":
    // categories nobody understands are categories nobody plays.
    const tabs = el('div', 'nw-tabs');
    tabs.style.pointerEvents = 'auto';
    for (const c of CATEGORIES) {
      const t = el('div', 'nw-tab' + (c.id === this.lbCategory ? ' on' : ''));
      t.textContent = c.label;
      t.tabIndex = 0;
      t.setAttribute('role', 'tab');
      t.setAttribute('aria-selected', String(c.id === this.lbCategory));
      const pick = () => { this.lbCategory = c.id; this.renderPanel(); };
      t.addEventListener('click', pick);
      t.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
      tabs.appendChild(t);
    }
    histSec.appendChild(tabs);

    const entries = rankFor(this.lbCategory, loadLeaderboard());
    if (!entries.length) {
      const empty = el('div', 'nw-empty');
      empty.textContent = cat.id === 'legacy'
        ? 'No runs recorded yet. Survive, and your name will be written in the static.'
        : 'No run has qualified for this category yet — it only counts a Reckoning actually won.';
      histSec.appendChild(empty);
    } else {
      const list = el('div', 'nw-lb-list');
      let rank = 0;
      for (const e of entries) {
        rank++;
        const row = el('div', 'nw-lb-row' + (e.legit ? '' : ' cheat'));
        const rankIcon = !e.legit ? '&#128128;' : rank === 1 ? '&#129351;' : rank === 2 ? '&#129352;' : rank === 3 ? '&#129353;' : `#${rank}`;
        const causeIcon = e.causeOfDeath === 'old_age' ? '&#9203;' : e.causeOfDeath === 'hall_fallen' ? '&#128128;' : '?';
        // The headline number changes with the tab — a Purity board that
        // still leads with Legacy Score is a Legacy board with extra steps.
        const headline = cat.id === 'time' ? `${(e.reckoningSec ?? 0).toFixed(1)}s`
          : cat.id === 'purity' ? `${e.gearScore ?? 0} gear`
          : `${e.legacyScore}`;
        row.innerHTML = `
          <span class="nw-lb-rank">${rankIcon}</span>
          <span class="nw-lb-score">${headline}</span>
          <span class="nw-lb-age" title="died of ${e.causeOfDeath === 'old_age' ? 'natural causes' : e.causeOfDeath === 'hall_fallen' ? 'the hall falling' : 'unknown causes'}">${causeIcon} age ${e.age}</span>
          <span class="nw-lb-detail">${e.nightsSurvived}n &middot; ${e.enemiesKilled}k &middot; ${e.bossesSlain}b &middot; ${e.goldHoarded}g</span>
          <span class="nw-lb-realm">${e.dominantRealm}${e.legit ? '' : ' &middot; <i>god mode</i>'}</span>`
          + (e.trophy
            ? `<span class="nw-lb-trophy" style="color:${rarityDef(e.trophy.rarity as any).color}"
                 title="best find of that run">&#9670; ${escapeHtml(e.trophy.name)}</span>`
            : '');
        list.appendChild(row);
      }
      histSec.appendChild(list);
    }

    body.appendChild(histSec);
  }

  // ----------------------------------------------------------- SR0: pause ----

  isPaused() { return this.pauseEl !== null || this.isDrafting(); }

  togglePause() {
    if (this.pauseEl) this.closePause();
    else this.openPause();
  }

  closePause() {
    this.pauseEl?.remove();
    this.pauseEl = null;
  }

  isDrafting() { return this.draftEl !== null; }
  /** The offer currently on screen, in card order — onKey's 1/2/3 reads this
   *  rather than duplicating openDraft()'s pick logic. */
  private draftIds: string[] = [];

  private closeDraft() {
    this.draftEl?.remove();
    this.draftEl = null;
    this.draftIds = [];
  }

  private pickDraftCard(id: string) {
    if (!this.hooks.allocateLoom(id)) return;
    this.closeDraft();
    // A Long Thread grant can be worth several points at once — if one is
    // still unspent, the Loom calls again rather than leaving it sitting in
    // the panel this phase exists to route around.
    if (this.hooks.loomView().points > 0) this.openDraft();
  }

  /** SR2 — the draft. "On level-up, the game STOPS and offers three cards":
   *  loom.ts has already rolled `pendingDraft` and paused via isPaused()/
   *  isOpen() before this is ever called, so this is purely the rendering and
   *  the pick. Chooseable by click (SR0 left menu buttons clickable — the
   *  mouse's job is stopping the game, not aiming it, and a pause-shaped menu
   *  is not aiming) or by pressing 1/2/3, the number matching the card's
   *  position, which is faster and is the one this exists to make possible. */
  openDraft() {
    if (this.draftEl || this.state.gameOver) return;
    const ids = this.hooks.draftView();
    if (!ids.length) return;
    this.draftIds = ids;
    const lv = this.hooks.loomView();

    const over = el('div', 'nw-gameover nw-draft');
    over.innerHTML = `<h1>THE LOOM CALLS</h1>
      <div style="color:var(--ink-dim);max-width:420px">${lv.points} point${lv.points === 1 ? '' : 's'} to weave. Choose one.</div>`;

    const grid = el('div', 'nw-draft-grid');
    ids.forEach((id, i) => {
      const node = nodeById(id);
      if (!node) return;
      const rank = lv.allocated[id] ?? 0;
      const card = el('div', 'nw-draft-card' + (node.keystone ? ' keystone' : ''));
      card.tabIndex = 0;
      card.setAttribute('role', 'button');
      card.innerHTML = `
        <div class="nw-draft-key">${i + 1}</div>
        <div class="nm">${node.name}${node.keystone ? '<span class="ks">keystone</span>' : ''}</div>
        <div class="ef">${node.keystone ? (node.keystoneDesc ?? '') : effectSummary(node)}</div>
        <div class="rk">${rank}/${node.maxRank}</div>`;
      card.addEventListener('click', (e) => { e.stopPropagation(); this.pickDraftCard(id); });
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.pickDraftCard(id); }
      });
      grid.appendChild(card);
    });
    over.appendChild(grid);

    const reroll = el('div', 'nw-btn');
    reroll.textContent = `Re-roll (${CFG.sr.draftRerollGold}g)`;
    reroll.style.pointerEvents = 'auto';
    reroll.style.marginTop = '8px';
    reroll.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.hooks.rerollDraft()) { this.closeDraft(); this.openDraft(); }
      else this.toast('Not enough gold to re-roll', 'bad');
    });
    over.appendChild(reroll);

    this.root.appendChild(over);
    this.draftEl = over;
  }

  /** The pause screen. It exists because SR0 took the mouse's gameplay job away
   *  and a game with no cursor needs somewhere to put "how do I play this".
   *  The controls table is the real payload — the stats are there because the
   *  scoreboard already computes them and a run you cannot check on is a run you
   *  are playing blind. */
  openPause() {
    if (this.pauseEl || this.state.gameOver) return;
    const over = el('div', 'nw-gameover nw-pause');
    const sb = (window as any).__nw?.sys?.scoreboard;
    const s = sb?.getLiveStats?.() ?? null;

    const row = (keys: string, what: string) =>
      `<div class="nw-ctl"><span class="nw-ctl-k">${keys}</span><span class="nw-ctl-w">${what}</span></div>`;

    const stats = s ? `
      <div class="nw-lb-grid" style="margin:10px 0 4px">
        <div class="nw-lb-stat"><span class="nw-lb-val">${s.age}</span><span class="nw-lb-lbl">age</span></div>
        <div class="nw-lb-stat"><span class="nw-lb-val">${s.minutesRemaining.toFixed(1)}m</span><span class="nw-lb-lbl">left</span></div>
        <div class="nw-lb-stat"><span class="nw-lb-val">${s.nightsSurvived}</span><span class="nw-lb-lbl">nights</span></div>
        <div class="nw-lb-stat"><span class="nw-lb-val">${s.enemiesKilled}</span><span class="nw-lb-lbl">kills</span></div>
        <div class="nw-lb-stat"><span class="nw-lb-val">${s.buildingsBuilt}</span><span class="nw-lb-lbl">built</span></div>
        <div class="nw-lb-stat"><span class="nw-lb-val">${s.legacyScore}</span><span class="nw-lb-lbl">legacy</span></div>
      </div>` : '';

    over.innerHTML = `<h1>PAUSED</h1>
      <div style="color:var(--ink-dim);max-width:360px">The dream holds still.</div>
      ${stats}
      <div class="nw-ctl-grid">
        <div class="nw-ctl-hd">MOVE &amp; FIGHT</div>
        ${row('W A S D', 'move &mdash; and your last direction is your aim')}
        ${row('Space', 'attack')}
        ${row('1 &ndash; 4', 'abilities &middot; Shift+digit rebinds a slot')}
        ${row('E', 'interact / gather')}
        ${row('F', 'ignite')}
        <div class="nw-ctl-hd">BUILD</div>
        ${row('B', 'enter placement')}
        ${row('&#91; &#93;', 'previous / next blueprint')}
        ${row('Arrows', 'nudge the ghost off your facing tile')}
        ${row('Enter', 'place &mdash; hold to paint walls as you walk')}
        ${row('Esc', 'cancel placement')}
        <div class="nw-ctl-hd">PANELS</div>
        ${row('I C K M L P', 'bag &middot; craft &middot; skills &middot; loom &middot; log &middot; pact')}
        ${row('&#59;', 'leaderboard')}
        ${row('Esc / click', 'pause')}
      </div>`;

    const mk = (label: string, primary: boolean, fn: () => void) => {
      const b = el('div', 'nw-btn' + (primary ? ' primary' : ''));
      b.textContent = label;
      b.style.pointerEvents = 'auto';
      b.style.marginTop = '4px';
      b.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
      over.appendChild(b);
    };
    mk('Resume', true, () => this.closePause());
    mk('Leaderboard', false, () => { this.closePause(); this.open('leaderboard'); });
    mk('Abandon run', false, () => {
      // Deliberately two-step. A one-click "restart" on a pause menu you can
      // open by clicking the canvas is a way to lose a fifteen-minute run to a
      // stray mouse.
      if (over.dataset.confirm === '1') { location.reload(); return; }
      over.dataset.confirm = '1';
      const b = over.querySelector('.nw-btn:last-child') as HTMLElement;
      if (b) { b.textContent = 'Really abandon? Click again'; b.style.color = '#c66'; }
    });

    this.root.appendChild(over);
    this.pauseEl = over;
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
          ${(card.elitesFelled || card.championsFelled)
            ? `<div><span style="color:var(--metal-hi)">Elites felled:</span> ${card.elitesFelled ?? 0}`
              + `${card.championsFelled ? `, <span style="color:#b56ce0">${card.championsFelled} champion${card.championsFelled === 1 ? '' : 's'}</span>` : ''}</div>`
            : ''}
          <div><span style="color:var(--metal-hi)">Buildings:</span> ${card.buildingsBuilt}</div>
          <div><span style="color:var(--metal-hi)">Gold hoarded:</span> ${card.goldHoarded}</div>
          <div><span style="color:var(--metal-hi)">Dominant realm:</span> ${card.dominantRealm}</div>
          <div><span style="color:var(--metal-hi)">Rifts survived:</span> ${card.riftsSurvived}</div>
          <div><span style="color:var(--metal-hi)">Peak RTT:</span> ${card.peakRtt}ms · <span style="color:var(--metal-hi)">Lowest BW:</span> ${card.lowestDownlink}Mbps</div>
          <div><span style="color:var(--metal-hi)">Loom points:</span> ${card.loomPointsEarned}</div>
          <div><span style="color:var(--metal-hi)">Connection age:</span> ${ageStr}</div>
        </div>
        ${card.outcome ? `
        <div style="font-size:11px;color:var(--ink-dim);margin-top:10px;line-height:1.6;text-align:left;max-width:300px;border-top:1px solid var(--metal-lo);padding-top:8px;">
          <div style="color:#c9b6e6;font-family:var(--font-display);letter-spacing:1px;font-size:10px;">THE RECKONING</div>
          <div><span style="color:var(--metal-hi)">Gear Score:</span> ${card.gearScore ?? 0}</div>
          ${card.bossDamageDealt != null ? `<div><span style="color:var(--metal-hi)">Damage to the lord:</span> ${card.bossDamageDealt}</div>` : ''}
          ${card.reckoningSec != null ? `<div><span style="color:var(--metal-hi)">Reckoning lasted:</span> ${card.reckoningSec}s</div>` : ''}
          <div><span style="color:var(--metal-hi)">Biggest hit:</span> ${card.bestHit ?? 0}</div>
        </div>` : ''}`;
    }
    // SR3: four endings, none of them "you lose" — Q2's cost is that a
    // scorecard covering mostly-losing runs cannot only celebrate winning.
    // Falls back to the pre-SR3 two-ending split (via causeOfDeath) for a
    // card with no outcome at all — CFG.sr.enabled off, or a v2 record from
    // before this batch existed.
    const oldAge = card?.causeOfDeath === 'old_age';
    let title: string, flavor: string;
    if (card?.outcome === 'reckoned') {
      title = 'THE RECKONING IS YOURS';
      flavor = `The lord falls. You held against it${card.reckoningSec != null ? ` for ${card.reckoningSec}s` : ''}, and the dream holds with you.`;
    } else if (card?.outcome === 'fallen') {
      title = "THE LORD'S RECKONING";
      flavor = `Its blow lands true before yours did. You dealt ${card.bossDamageDealt ?? 0} before the end.`;
    } else if (card?.outcome === 'outlasted') {
      title = 'THE CLOCK RUNS OUT';
      flavor = `The lord still stands when the years catch up. You dealt it ${card.bossDamageDealt ?? 0} in the time you had.`;
    } else {
      // L1: two distinct endings — a violent hall-fall vs. a peaceful old-age
      // ending — never mixed, and never using network jargon in the fiction
      // (Veil law).
      title = oldAge ? 'THE DREAM FADES' : 'THE THREAD IS CUT';
      flavor = oldAge
        ? `Your dream-self grows heavy with years and lies down beneath the dark, and does not wake.
           You lived ${card?.age ?? '?'} years and survived ${this.state.nightsSurvived} night${this.state.nightsSurvived === 1 ? '' : 's'}.`
        : `Your Hearthstone lies in ruin and the dark takes the rest.
           You survived ${this.state.nightsSurvived} night${this.state.nightsSurvived === 1 ? '' : 's'}.`;
    }
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
