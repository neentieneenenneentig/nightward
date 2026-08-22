// A3: The Bar — the Echoes of the Slain become something you press.
//
// C1 gave every slain lord an echo that fires itself. That is a good passive and
// a poor verb: five minutes into a night the player is holding a movement key and
// watching numbers happen. This adds a second, *empowered* form of each echo,
// bound to keys 1–4, paid for out of Resolve.
//
// The split of responsibility is deliberate and load-bearing:
//
//   this file        the bar, the slotting, the cooldowns, the cost, the refusals
//   systems/echoes   what an echo actually DOES when it goes off
//
// Both forms of an echo therefore reach targets through the same
// `targetsWithin()`/`hitAll()` pair and roll damage through the same seeded D5
// law. Two files deciding how much a Rime Nova hurts is how the two forms drift
// apart over a milestone or two until one of them is quietly wrong.
//
// **Why Resolve.** The game has no mana and should not invent one — a fifth bar
// on a HUD that already carries HP, Vigor, Resolve and the Lifespan is not a
// feature, it is a tax. Resolve is already a morale meter: it bleeds at night,
// bleeds faster near a lord, bleeds faster still when you stand around, is repaid
// by kills and by living to dawn, and it already punishes you at zero (−30% move,
// +50% damage taken). Spending morale on heroics is what a morale meter is *for*,
// and it converts the one purely passive number on the HUD into the most active
// one. The cost of that choice — a bad Resolve run has no abilities in it at all
// — is real and is flagged for the playtest verdict rather than papered over.
import { Sound } from '../../engine/audio';
import { CFG } from '../data/config';
import { ECHOES, echoById, activeStatsFor } from '../data/echoes';

export type CastFailure = 'off' | 'empty' | 'cooldown' | 'resolve' | 'locked' | 'dead';

export interface CastResult {
  ok: boolean;
  /** Why it was refused. The HUD only needs ok/not-ok to flash the socket, but
   *  the reason is what makes a refusal debuggable from the console and testable
   *  without reading four different pieces of state to infer which rule fired. */
  reason?: CastFailure;
  echoId?: string;
  name?: string;
}

/** One socket, as the HUD needs to draw it. */
export interface SlotView {
  slot: number;              // 0-based
  key: string;               // the keycap to print
  id: string | null;         // echo id, or null for an empty socket
  name: string;              // the ACTIVE's name, not the echo's — Bramblebreak, not Thornring
  echoName: string;
  icon: string;
  color: string;             // '#rrggbb', for the socket rim
  level: number;
  cost: number;
  /** 0 = ready, 1 = just cast. The HUD draws this straight into a conic-gradient. */
  cooldownFrac: number;
  cooldownLeft: number;      // seconds, for the numeral
  ready: boolean;            // off cooldown
  affordable: boolean;       // enough Resolve right now
}

const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');

export class AbilitySystem {
  /** echoId → clock time the active comes off cooldown. Keyed by ECHO, not by
   *  slot: re-socketing a spent echo into a different slot must not refresh it. */
  private readyAt: Record<string, number> = {};
  /** echoId → the cooldown duration this cast was actually charged, seconds.
   *
   *  Recorded rather than recomputed because N4.7b's Swift Road scales the
   *  cooldown at the moment of the cast, and the ring in `view()` divides the
   *  remaining time by the full duration. Dividing by the AUTHORED duration
   *  after charging a scaled one draws a ring that empties at the wrong rate
   *  and never reaches zero — the exact class of bug where the number is right
   *  and the thing the player looks at is wrong. */
  private chargedCd: Record<string, number> = {};
  private lockUntil = 0;
  private lastFizzleToast = -1e9;

  constructor(private ctx: any) {}

  // ---- the bar ---------------------------------------------------------------

  private get bar(): string[] {
    const p = this.ctx.state.player;
    if (!Array.isArray(p.abilityBar)) p.abilityBar = [];
    return p.abilityBar;
  }

  /** Echo ids the player holds at level ≥ 1, in the canonical ECHOES order so the
   *  swap cycle is stable across frames rather than following object key order. */
  held(): string[] {
    const e = this.ctx.state.player.echoes ?? {};
    return ECHOES.filter((d) => (e[d.id] ?? 0) > 0).map((d) => d.id);
  }

  /** Reconcile the bar with what is actually held. Called every tick — cheap, and
   *  it means nothing has to remember to notify the bar when an echo is granted.
   *
   *  Auto-slotting fills FREE slots only. Once the bar is full the fifth lord's
   *  echo is held but unbound, and the player has to displace something to use its
   *  active — which is the build decision §5.3 wanted, arriving at the exact
   *  moment the run peaks. It still auto-fires; it loses only its pressed form. */
  sync() {
    const bar = this.bar;
    const holds = new Set(this.held());
    // drop anything no longer held (nothing removes an echo today, but a bar that
    // can hold a dangling id is a bar that will eventually be handed one)
    for (let i = 0; i < bar.length; i++) if (bar[i] && !holds.has(bar[i])) bar[i] = '';
    while (bar.length < CFG.abilities.slots) bar.push('');
    bar.length = CFG.abilities.slots;
    const bound = new Set(bar.filter(Boolean));
    for (const id of this.held()) {
      if (bound.has(id)) continue;
      const free = bar.indexOf('');
      if (free < 0) break;                 // full: the choice is the player's
      bar[free] = id;
      bound.add(id);
    }
  }

  update(_dt: number) {
    if (!CFG.abilities.enabled) return;
    this.sync();
  }

  /** Cycle one socket to the next held echo that is not already on the bar,
   *  then to empty, then round. Bound to right-click and Shift+N. */
  swap(slot: number): boolean {
    if (!CFG.abilities.enabled) return false;
    this.sync();
    const bar = this.bar;
    if (slot < 0 || slot >= bar.length) return false;
    const cur = bar[slot];
    const elsewhere = new Set(bar.filter((x, i) => x && i !== slot));
    // candidates: every held echo not socketed in ANOTHER slot, plus the empty
    // socket, so a full bar can still be emptied and a 5-echo run can reach all 5
    const options = [...this.held().filter((id) => !elsewhere.has(id)), ''];
    const at = options.indexOf(cur);
    const next = options[(at + 1) % options.length];
    if (next === cur) return false;
    bar[slot] = next;
    const def = next ? echoById(next) : null;
    this.ctx.toast?.(def ? `Slot ${slot + 1}: ${def.active.name}` : `Slot ${slot + 1} emptied`, 'info');
    return true;
  }

  // ---- casting ---------------------------------------------------------------

  /** Press slot N (0-based). Every refusal is free and every refusal says why. */
  cast(slot: number): CastResult {
    if (!CFG.abilities.enabled) return { ok: false, reason: 'off' };
    const { state } = this.ctx;
    if (state.gameOver) return { ok: false, reason: 'dead' };
    this.sync();
    const id = this.bar[slot];
    const def = id ? echoById(id) : null;
    if (!def) {
      // An empty socket that does nothing at all is indistinguishable from a
      // broken one, and slots 1-4 are all empty until the first lord falls --
      // which is most of a run. Rate-limited by the same clock as the fizzle so
      // a leaned-on key cannot turn it into a wall of toasts.
      this.hint(`Slot ${slot + 1} is empty — slay a domain lord to earn an echo.`);
      return { ok: false, reason: 'empty' };
    }

    // A held key repeats at the OS rate. Without this, one lean on `1` empties a
    // full Resolve meter in well under a second and the player never sees why.
    if (state.clock < this.lockUntil) return { ok: false, reason: 'locked', echoId: def.id };
    if (state.clock < (this.readyAt[def.id] ?? 0)) return { ok: false, reason: 'cooldown', echoId: def.id };

    const cost = def.active.cost;
    // No casting on credit. Casting yourself to EXACTLY zero is allowed on purpose:
    // walking into the resolve-zero penalty to land one more nova is a decision the
    // game should let you make, and it is the most interesting one on the bar.
    if (state.player.resolve < cost) {
      this.hint(`Not resolve enough for ${def.active.name} — ${def.active.cost} needed.`, 'bad');
      Sound.play('castFail');
      return { ok: false, reason: 'resolve', echoId: def.id, name: def.active.name };
    }

    state.player.resolve = Math.max(0, state.player.resolve - cost);
    // N4.7b: 'The Swift Road'. The UDP path out of this machine is a different
    // road from the TCP one every other reading in the game rides, and how fast
    // it answers decides how soon an echo comes back. Applied at the cast, not
    // at the tick, so a network that changes mid-cooldown cannot lengthen a
    // wait the player already committed to.
    const cd = def.active.cooldown * (this.ctx.net?.getGameValue?.('swiftRoad') ?? 1);
    this.chargedCd[def.id] = cd;
    this.readyAt[def.id] = state.clock + cd;
    this.lockUntil = state.clock + CFG.abilities.globalLockSec;
    // Casting is an ACTION. Without this the idle multiplier (×2 resolve decay
    // after 30s) keeps running while you fight with abilities alone, which would
    // punish the exact playstyle this milestone exists to enable.
    this.ctx.vitals?.markAction?.();
    this.ctx.echoes?.castActive?.(def.id);
    Sound.play('cast');
    this.ctx.floaters?.spawnVital?.(
      state.player.x, state.player.y - 40, 'resolve', `−${cost}`, '#c98', this.ctx.cam);
    return { ok: true, echoId: def.id, name: def.active.name };
  }

  /** Every refusal that is worth saying out loud, through one rate limiter. */
  private hint(msg: string, kind: 'info' | 'bad' = 'bad') {
    const now = this.ctx.state.clock;
    if (now - this.lastFizzleToast < CFG.abilities.fizzleToastCooldownSec) return;
    this.lastFizzleToast = now;
    this.ctx.toast?.(msg, kind);
  }

  // ---- what the HUD reads ------------------------------------------------------

  view(): SlotView[] {
    const { state } = this.ctx;
    if (CFG.abilities.enabled) this.sync();
    const out: SlotView[] = [];
    for (let i = 0; i < CFG.abilities.slots; i++) {
      const id = this.bar[i] || null;
      const def = id ? echoById(id) : null;
      if (!def) {
        out.push({
          slot: i, key: String(i + 1), id: null, name: '', echoName: '', icon: '',
          color: '#6b6357', level: 0, cost: 0,
          cooldownFrac: 0, cooldownLeft: 0, ready: true, affordable: false,
        });
        continue;
      }
      const lvl = state.player.echoes?.[def.id] ?? 0;
      const left = Math.max(0, (this.readyAt[def.id] ?? 0) - state.clock);
      // The duration this echo was last charged, falling back to the authored
      // one for an echo that has never been cast (where `left` is 0 anyway).
      const full = this.chargedCd[def.id] ?? def.active.cooldown;
      out.push({
        slot: i, key: String(i + 1), id: def.id,
        name: def.active.name, echoName: def.name, icon: def.icon, color: hex(def.color),
        level: lvl, cost: def.active.cost,
        cooldownFrac: full > 0 ? left / full : 0,
        cooldownLeft: left,
        ready: left <= 0,
        affordable: state.player.resolve >= def.active.cost,
      });
    }
    return out;
  }

  /** Tooltip body for a socket: what it does, what it costs, what it hits for.
   *  The numbers are the LIVE level-scaled ones, so the same socket reads
   *  differently at echo level 1 and level 6 — the tooltip is the only place the
   *  player can see that levelling an echo levelled its active too. */
  describe(slot: number): { title: string; lines: string[] } | null {
    const id = this.bar[slot];
    const def = id ? echoById(id) : null;
    if (!def) {
      return { title: `Slot ${slot + 1} — empty`, lines: [
        'No echo bound. Slay a domain lord to earn one.',
        'Right-click or Shift+' + (slot + 1) + ' to bind a different echo.',
      ] };
    }
    const lvl = this.ctx.state.player.echoes?.[def.id] ?? 1;
    const a = activeStatsFor(def, lvl);
    const road = this.ctx.net?.getGameValue?.('swiftRoad') ?? 1;
    const lines = [
      def.active.desc,
      `${def.name} · level ${lvl}`,
      // The EFFECTIVE cooldown, not the authored one. N4.7b's Swift Road moves
      // it by up to 15% either way, and a tooltip that keeps quoting the table
      // while the ring runs to a different number is a tooltip the player
      // learns to stop trusting. Shown with the multiplier beside it wherever
      // it is not 1.0, so the difference is explained rather than merely felt.
      `Costs ${def.active.cost} resolve · ${(def.active.cooldown * road).toFixed(1)}s`
        + (Math.abs(road - 1) > 0.005 ? ` (×${road.toFixed(2)} the swift road)` : ''),
    ];
    if (def.kind === 'pulse' || def.kind === 'nova') {
      lines.push(`${Math.round(a.dmg)} damage in ${a.radiusTiles.toFixed(1)} tiles`);
    } else if (def.kind === 'volley') {
      lines.push(`${Math.round(a.dmg)} damage × ${Math.round(a.projectiles)} lashes, ${a.rangeTiles.toFixed(1)} tiles`);
    } else if (def.kind === 'trail') {
      lines.push(`${Math.round(a.dmg)} per tick along ${def.active.lineTiles} tiles`);
    } else {
      lines.push(`${Math.round(a.dmg)} per graze, ${Math.round(a.orbCount)} orbs for ${def.active.windowSec}s`);
    }
    if (def.active.freezeSec) lines.push(`Freezes solid for ${def.active.freezeSec}s`);
    if (def.active.knockTiles) lines.push(`Throws survivors back ${def.active.knockTiles} tiles`);
    lines.push('Right-click to bind a different echo.');
    return { title: def.active.name, lines };
  }
}
