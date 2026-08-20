// N4.3 — Omens: a change on the wire becomes a change in the world.
//
// The Chronicle already detects step changes (chronicle.ts `detect()`), and
// until now the only thing that happened when it fired was a line in the Feed.
// That is a diagnostics panel reporting on itself. GDD §4.2's premise is that
// the network IS the world, and the moment your WiFi hiccups should be a moment
// *in the game*.
//
// So each detected step is offered to this system, which may raise an **Omen**:
// a named, temporary world state with a real gameplay multiplier, a Feed line, a
// toast and a visual. N4 plan §5.3 names three of them — a latency step-change
// is a rift, a retransmission burst is a surge, a throughput collapse is a
// famine — and the offline case (The Hollow) already existed.
//
// Two design decisions worth stating, because both were choices:
//
// 1. **Omens go both ways.** §5.3 lists only bad ones, and a system that can
//    only ever punish teaches the player to resent their own connection. A
//    latency DROP is a Quickening and a throughput SURGE is a Bounty. The wire
//    getting better has to be worth noticing or the mapping is not a mapping,
//    it is a penalty box.
//
// 2. **Famine lifts when the network recovers, not when a timer expires.** The
//    plan says "yields drop until it recovers", and that is the better mechanic:
//    the player's route out of a famine is the network coming back, which they
//    can watch happen in the Lens. The duration cap is a safety valve so a
//    permanently degraded link does not famine for the whole run — not the
//    primary exit.
import type { ChronicleEvent, ChronicleStore } from './chronicle';
import { CFG } from '../data/config';

/** What an omen multiplies. Systems ask by target; they never name a kind. */
export type OmenTarget = 'hordeAggression' | 'resourceYield' | 'moveSpeed';

export type OmenKind = 'surge' | 'famine' | 'bounty' | 'quickening' | 'miring' | 'rift';

export interface OmenDef {
  kind: OmenKind;
  /** Chronicle series key + direction that raises it. */
  key: string;
  dir: 'up' | 'down';
  name: string;
  /** Shown in the Lens and the toast. Plain language — the Lens does not lie,
   *  and "your packet loss stepped up" is the honest half of "the horde smells
   *  blood". Both are shown; the Feed gets the numbers. */
  blurb: string;
  target: OmenTarget | null;
  mul: number;
  /** Safety-valve duration in WORLD seconds. Night is 100 s. */
  maxSec: number;
  /** Minimum sigma. The Chronicle already refuses to fire below 3σ; a kind may
   *  ask for more before it is allowed to touch the game. A rift is the most
   *  disruptive thing here and should need more evidence than a drag modifier. */
  minSigma: number;
  good: boolean;
}

/** Keyed by `${series}:${dir}`. Everything about an omen is in this table —
 *  adding one is a row, not a code path. */
export const OMEN_DEFS: OmenDef[] = [
  {
    kind: 'surge', key: 'fray', dir: 'up',
    name: 'Surge',
    blurb: 'packet loss stepped up — the horde presses',
    target: 'hordeAggression', mul: 1.25, maxSec: 75, minSigma: 3, good: false,
  },
  {
    kind: 'famine', key: 'flow', dir: 'down',
    name: 'Famine',
    blurb: 'throughput collapsed — the land gives less',
    target: 'resourceYield', mul: 0.65, maxSec: 90, minSigma: 3.5, good: false,
  },
  {
    kind: 'bounty', key: 'flow', dir: 'up',
    name: 'Bounty',
    blurb: 'throughput surged — the land gives freely',
    target: 'resourceYield', mul: 1.30, maxSec: 60, minSigma: 3.5, good: true,
  },
  {
    kind: 'quickening', key: 'pulse', dir: 'down',
    name: 'Quickening',
    blurb: 'the pulse shortened — the world quickens',
    target: 'moveSpeed', mul: 1.10, maxSec: 60, minSigma: 3, good: true,
  },
  {
    kind: 'miring', key: 'silt', dir: 'up',
    name: 'Miring',
    blurb: 'the buffers are filling — the ground thickens',
    target: 'moveSpeed', mul: 0.88, maxSec: 75, minSigma: 3, good: false,
  },
  {
    // The one with no multiplier of its own: it hands off to the existing rift
    // machinery, which N2 built and which desktop browsers have never been able
    // to trigger, because its only trigger was a `connection.type` transition
    // that desktop Chrome does not report. On desktop the rift system has been
    // close to dead code since N2. This is its first real trigger.
    kind: 'rift', key: 'pulse', dir: 'up',
    name: 'Rift',
    blurb: 'the pulse lengthened hard — the realm tears',
    target: null, mul: 1, maxSec: 30, minSigma: 4.5, good: false,
  },
];

export interface Omen {
  kind: OmenKind;
  def: OmenDef;
  /** World clock at onset and at the safety-valve expiry. */
  t0: number;
  until: number;
  /** The reading that raised it, and what it stepped from. */
  from: number;
  to: number;
  sigma: number;
  /** Set when the omen ended, so the Lens can show what just passed. */
  endedAt?: number;
  endedBy?: 'recovered' | 'expired';
}

export interface OmenHost {
  clock: () => number;
  chronicle: ChronicleStore | null;
  toast?: (msg: string, kind?: string) => void;
  log?: { push: (kind: string, msg: string, t: number) => void } | null;
  /** Fire a realm rift from the wire. Returns false if the rift cooldown or the
   *  biome selector declined it — an omen that was refused is not raised. */
  rift?: (reason: string) => boolean;
  fx?: (o: Omen) => void;
}

export class OmenSystem {
  active: Omen[] = [];
  /** Everything that has been raised this run, newest last. Capped. */
  history: Omen[] = [];

  private static readonly MAX_HISTORY = 40;

  constructor(private host: OmenHost) {}

  get enabled(): boolean { return CFG.omens.enabled; }

  /** Offer a detected step change. Returns the omen if one was raised.
   *
   *  Re-raising a kind that is already active REFRESHES it rather than stacking
   *  a second copy — a network that steps twice inside one famine should extend
   *  the famine, not double the penalty into unplayability. */
  consider(ev: ChronicleEvent): Omen | null {
    if (!this.enabled) return null;
    const def = OMEN_DEFS.find((d) => d.key === ev.key && d.dir === ev.dir);
    if (!def) return null;
    if (Math.abs(ev.sigma) < def.minSigma) return null;

    const now = this.host.clock();
    if (def.kind === 'rift') {
      // The rift is the only kind that can be REFUSED by the thing it drives,
      // so it is asked before it is raised. Raising it and then discovering the
      // rift did not happen would put a phantom in the Lens.
      const fired = this.host.rift?.(def.blurb) ?? false;
      if (!fired) return null;
    }

    const existing = this.active.find((o) => o.kind === def.kind);
    // The cap is checked AFTER the refresh path, so an omen that is already up
    // can always be extended. Refusing to extend at the cap would mean a run
    // sitting at maxActive silently stopped tracking the network.
    if (existing) {
      existing.until = now + def.maxSec;
      existing.to = ev.to;
      existing.sigma = ev.sigma;
      return existing;
    }
    if (this.active.length >= CFG.omens.maxActive) return null;

    const omen: Omen = {
      kind: def.kind, def, t0: now, until: now + def.maxSec,
      from: ev.from, to: ev.to, sigma: ev.sigma,
    };
    this.active.push(omen);
    this.history.push(omen);
    if (this.history.length > OmenSystem.MAX_HISTORY) this.history.shift();

    this.host.toast?.(`${omen.def.name} — ${omen.def.blurb}`, def.good ? 'good' : 'bad');
    this.host.log?.push('resonance',
      `${omen.def.name}: ${ev.label} ${ev.dir} ${ev.from.toFixed(1)} → ${ev.to.toFixed(1)} `
      + `(${Math.abs(ev.sigma).toFixed(1)}σ)`
      + (def.target ? ` · ${def.target} ×${def.mul}` : ''), now);
    this.host.fx?.(omen);
    return omen;
  }

  /** Expire omens. Called once a second from the sim, on the WORLD clock, so an
   *  omen lasts the same number of game-seconds regardless of frame rate. */
  tick() {
    if (!this.active.length) return;
    // The escape hatch has to work MID-RUN, not just at boot. Turning the flag
    // off with a Famine up must give back the pre-N4.3 game immediately, not
    // leave a 0.65x on the world until it happens to recover.
    if (!this.enabled) { this.active.length = 0; return; }
    const now = this.host.clock();
    for (let i = this.active.length - 1; i >= 0; i--) {
      const o = this.active[i];
      const recovered = this.recovered(o);
      if (!recovered && now < o.until) continue;
      o.endedAt = now;
      o.endedBy = recovered ? 'recovered' : 'expired';
      this.active.splice(i, 1);
      this.host.log?.push('resonance',
        `${o.def.name} lifts (${o.endedBy})`, now);
    }
  }

  /** Has the reading that raised this omen come back?
   *
   *  Compared against the PRE-step baseline (`from`) with a 10% hysteresis band,
   *  not against the post-step value, and not against a fixed threshold. A link
   *  that drops from 40 Mbps to 4 has to climb back to 36 to lift the famine;
   *  one that drops from 4 to 0.4 has to reach 3.6. The band stops a reading
   *  hovering on its own baseline from flickering the omen on and off. */
  private recovered(o: Omen): boolean {
    const c = this.host.chronicle;
    if (!c) return false;
    const last = c.last(o.def.key);
    if (!last) return false;
    // Direction matters: an omen raised by a step UP recovers by coming back
    // DOWN to its baseline, and vice versa. Getting this backwards would lift
    // every omen on the very tick it was raised.
    return o.def.dir === 'up'
      ? last.v <= o.from * 1.10 + 1e-9
      : last.v >= o.from * 0.90;
  }

  /** The multiplier a game system should apply for this target. 1.0 when no
   *  omen touches it. Multiple omens on one target compound, which is how a
   *  Quickening and a Miring cancel each other out — correct, and the reason
   *  they share a target rather than each getting their own. */
  mul(target: OmenTarget): number {
    if (!this.active.length || !this.enabled) return 1;
    let m = 1;
    for (const o of this.active) if (o.def.target === target) m *= o.def.mul;
    return m;
  }

  has(kind: OmenKind): boolean { return this.enabled && this.active.some((o) => o.kind === kind); }

  /** For the Lens and the scoreboard. */
  summary(): string {
    if (!this.active.length) return '';
    return this.active.map((o) => o.def.name).join(' · ');
  }
}
