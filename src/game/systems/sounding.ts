// ============================================================================
// N4.5 — The Sounding.
//
// The one genuinely new mechanic in the deep-wire arc, and the answer to
// "how does a network measurement become a game verb".
//
// ---------------------------------------------------------------------------
// The constraint is the design
// ---------------------------------------------------------------------------
//
// A throughput test spends the player's data. Not a server's, not the
// developer's — theirs, possibly metered, possibly roaming. That single fact
// makes background throughput measurement indefensible, and it is a gift,
// because it forces the measurement to stop being ambient traffic and become
// something the player CHOOSES to do.
//
// So a sounding is a verb: walk to the Sounding Stone, spend a piece of a
// budget you consented to at the start of the run, and get an answer that is
// itself the reward. The cooldown is in-fiction ("the stone must recover"), and
// the cooldown IS the rate limit IS the data budget. One mechanism serving the
// game design and the good-citizenship constraint at the same time — the
// cleanest thing in the N4 plan, and the reason this phase was deliberately
// sequenced last.
//
// ---------------------------------------------------------------------------
// What one sounding actually measures
// ---------------------------------------------------------------------------
//
//   1. **An idle baseline.** A few tiny requests, before any load, to establish
//      what the path's latency looks like when nothing is pushing on it. This
//      is the half every consumer speed test skips and the half that makes the
//      next number meaningful.
//   2. **A download sounding.** N bytes from `speed.cloudflare.com/__down`,
//      timed. Real throughput, uncapped — unlike `connection.downlink`, which
//      Chromium clamps at 10 Mbps and Firefox and Safari do not implement.
//   3. **Latency UNDER LOAD, sampled during the download.** The bufferbloat
//      measurement, done properly: idle baseline first, then the same probe
//      while the pipe is full. If loaded RTT climbs far above idle, the path
//      has over-large buffers somewhere and every interactive thing on this
//      connection suffers whenever anything else is downloading.
//   4. **An upload sounding.** A binary POST to `/__up`. Upstream is where
//      consumer connections are actually asymmetric and where bufferbloat is
//      usually worst, and nothing else in this project has ever measured it.
//
// Every one of them fails silently to a neutral value. A blocked probe is
// content ("this network is filtered"), never an error, and never a worse game.
//
// ---------------------------------------------------------------------------
// Budget accounting
// ---------------------------------------------------------------------------
//
// Bytes are counted BEFORE they are spent, against the covenant's run-total
// ceiling, and a sounding that cannot afford its full shape is refused rather
// than truncated. A half-sounding would produce a throughput number measured
// over too short a burst to be meaningful — TCP slow-start alone eats the first
// few hundred kilobytes — and reporting that as a reading would be worse than
// reporting nothing.
// ============================================================================
import { covenantDef } from '../data/covenants';
import { CFG } from '../data/config';

/** Cloudflare's public speed-test endpoints. The same host N4.1's deep wire
 *  already probes, chosen for the same reason: it sets `Timing-Allow-Origin: *`
 *  and returns its own kernel socket statistics in `Server-Timing`, so a
 *  sounding gets the edge's view of the transfer as well as ours.
 *
 *  Cloudflare publishes `@cloudflare/speedtest` on npm — MIT, maintained by
 *  cloudflare.com accounts — which drives these exact endpoints. Shipping a
 *  library so third parties can embed your speed test is about as explicit a
 *  sanction as exists short of a ToS clause. We drive them directly rather than
 *  taking the dependency (that package is a full engine and we want four
 *  numbers), but the sanction is why this is a legitimate host to point at. */
const DOWN = 'https://speed.cloudflare.com/__down?bytes=';
const UP = 'https://speed.cloudflare.com/__up';
/** A tiny `__down` is the latency probe: one byte of payload, so what is timed
 *  is the round trip and not the transfer. */
const PROBE = DOWN + '1';

export interface SoundingResult {
  /** Wall-clock seconds the whole sounding took. */
  tookSec: number;
  /** Bytes actually spent — down + up + probes. Charged to the budget. */
  bytes: number;

  /** Real download throughput, Mbps. 0 = the sounding could not measure it. */
  downMbps: number;
  /** Real upload throughput, Mbps. 0 = unmeasured. */
  upMbps: number;

  /** Median idle round trip, ms, before any load. 0 = unmeasured. */
  idleMs: number;
  /** Median round trip DURING the download, ms. 0 = unmeasured. */
  loadedMs: number;
  /** loaded − idle, ms. The bufferbloat number. Negative is clamped to 0:
   *  a loaded path cannot genuinely be faster than an idle one, and a small
   *  negative is measurement noise, not a discovery. */
  bloatMs: number;
  /** A grade for the above, the way the bufferbloat community grades it. */
  bloatGrade: 'A' | 'B' | 'C' | 'D' | 'F' | '?';

  /** Which DoH resolver answered fastest, and by how much. */
  resolverName: string;
  resolverMs: number;

  /** True if anything at all was measured. False means a filtered network, and
   *  the panel says so rather than showing a row of zeroes. */
  live: boolean;
  /** Veil-legal summary line (pillar 7). */
  verdict: string;
}

export function emptySounding(): SoundingResult {
  return {
    tookSec: 0, bytes: 0, downMbps: 0, upMbps: 0,
    idleMs: 0, loadedMs: 0, bloatMs: 0, bloatGrade: '?',
    resolverName: '', resolverMs: 0,
    live: false, verdict: 'the stone heard nothing',
  };
}

/** Bufferbloat grading, on the thresholds the bufferbloat.net community uses
 *  for added latency under load. Stated as a letter because that is how the
 *  measurement is universally reported and a player who looks it up should
 *  find the same scale. */
export function gradeBloat(addedMs: number): SoundingResult['bloatGrade'] {
  if (addedMs < 5) return 'A';
  if (addedMs < 30) return 'B';
  if (addedMs < 60) return 'C';
  if (addedMs < 200) return 'D';
  return 'F';
}

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[s.length >> 1];
};

export interface SoundingPlan {
  /** Bytes to pull down. */
  downBytes: number;
  /** Bytes to push up. */
  upBytes: number;
  /** How many idle latency probes, and how many under load. */
  probes: number;
}

/** How big a sounding should be, given what is left in the budget.
 *
 *  Deliberately NOT "as big as will fit". A download has to outlast TCP
 *  slow-start to measure steady-state throughput at all — the first few hundred
 *  kilobytes are the congestion window opening, and timing them measures the
 *  handshake rather than the pipe. Below `MIN_DOWN` there is no honest reading
 *  to be had, so the stone refuses rather than reporting the slow-start ramp as
 *  the player's bandwidth.
 *
 *  Upload is a tenth of download because consumer links are asymmetric and
 *  because upstream is the direction where a big burst actually degrades
 *  someone's video call. */
export const MIN_DOWN = 1_000_000;      // 1 MB — below this, slow-start dominates
export const MAX_DOWN = 8_000_000;      // 8 MB — past this we learn nothing new
const UP_RATIO = 0.1;
const PROBE_BYTES = 700;                // headers dominate a 1-byte body

export function planSounding(budgetLeftBytes: number): SoundingPlan | null {
  const probes = 10;                    // 5 idle + 5 loaded
  const overhead = probes * PROBE_BYTES;
  const spendable = budgetLeftBytes - overhead;
  if (spendable < MIN_DOWN * (1 + UP_RATIO)) return null;
  // A quarter of what is left, so a budget buys several soundings rather than
  // one enormous one — the mechanic is a verb you repeat, not a one-shot.
  const want = Math.min(MAX_DOWN, Math.max(MIN_DOWN, Math.floor(spendable * 0.25 / (1 + UP_RATIO))));
  return { downBytes: want, upBytes: Math.floor(want * UP_RATIO), probes };
}

export class SoundingSystem {
  /** The last completed sounding, for the panel and the Lens. */
  last: SoundingResult = emptySounding();
  /** Bytes spent this run, against the covenant's ceiling. */
  spent = 0;
  /** True while a sounding is in flight — the stone is single-shot. */
  busy = false;
  /** Game-clock time the stone becomes usable again. */
  readyAt = 0;
  /** How many soundings this run has completed. */
  count = 0;

  constructor(private ctx: any) {}

  private get covenant() { return covenantDef(this.ctx.state.covenant ?? 'quiet'); }

  /** The covenant row this run is under. Public for the Lens and the panel —
   *  the budget IS the difficulty tier, so both read the same row. */
  pact() { return this.covenant; }

  /** Bytes remaining in this run's budget. */
  budgetLeft(): number {
    return Math.max(0, this.covenant.budgetMB * 1_000_000 - this.spent);
  }

  /** Why the stone will not fire right now, or null if it will.
   *
   *  Returns a REASON rather than a boolean, because every one of these is
   *  something the player needs told: a stone that is simply greyed out with no
   *  explanation is the exact failure the Lens spent two milestones stamping
   *  out on the readings side. */
  blocked(): string | null {
    if (!CFG.n45.enabled) return 'there is no stone to listen with';
    if (this.busy) return 'the stone is already listening';
    const cov = this.covenant;
    if (cov.budgetMB <= 0) {
      return 'the Quiet Pact spends nothing — swear a deeper one to wake the stone';
    }
    if (this.ctx.state.clock < this.readyAt) {
      return `the stone must recover — ${Math.ceil(this.readyAt - this.ctx.state.clock)}s`;
    }
    if (!planSounding(this.budgetLeft())) {
      return this.spent > 0
        ? 'this run’s budget is spent — the stone is quiet until dawn breaks on a new one'
        : 'the budget cannot cover a sounding worth trusting';
    }
    if (!navigator.onLine) return 'the water is still — nothing is out there to hear';
    return null;
  }

  /** Run one sounding. Resolves with the result; never rejects.
   *
   *  Sequenced rather than parallel, and that ordering is the measurement:
   *  idle probes must complete BEFORE the download starts or the "idle"
   *  baseline is measured against a filling buffer, which is precisely the
   *  thing being tested for. */
  async sound(): Promise<SoundingResult> {
    const why = this.blocked();
    if (why) { const r = emptySounding(); r.verdict = why; return r; }

    const plan = planSounding(this.budgetLeft())!;
    this.busy = true;
    const t0 = performance.now();
    const out = emptySounding();

    try {
      // ---- 1. idle baseline -------------------------------------------------
      const idle: number[] = [];
      for (let i = 0; i < plan.probes / 2; i++) {
        const ms = await this.probe();
        if (ms > 0) idle.push(ms);
      }
      out.idleMs = median(idle);
      out.bytes += (plan.probes / 2) * PROBE_BYTES;

      // ---- 2 & 3. download, with latency sampled underneath it -------------
      const loaded: number[] = [];
      let stop = false;
      const sampler = (async () => {
        while (!stop) {
          const ms = await this.probe();
          if (ms > 0) loaded.push(ms);
          out.bytes += PROBE_BYTES;
        }
      })();

      const dl = await this.download(plan.downBytes);
      stop = true;
      await sampler.catch(() => {});
      out.downMbps = dl.mbps;
      out.bytes += dl.bytes;
      out.loadedMs = median(loaded);

      // ---- 4. upload --------------------------------------------------------
      const ul = await this.upload(plan.upBytes);
      out.upMbps = ul.mbps;
      out.bytes += ul.bytes;

      // ---- 5. resolver race -------------------------------------------------
      const race = this.ctx.net?.fastestResolver?.();
      if (race) { out.resolverName = race.label; out.resolverMs = race.ms; }

      out.bloatMs = Math.max(0, out.loadedMs - out.idleMs);
      out.bloatGrade = out.idleMs > 0 && out.loadedMs > 0 ? gradeBloat(out.bloatMs) : '?';
      out.live = out.downMbps > 0 || out.upMbps > 0;
      out.verdict = verdictFor(out);
    } catch {
      // A filtered network is content, not an error. `live` stays false and the
      // panel says the water gave nothing back.
      out.verdict = 'the water gave nothing back — something between here and there is holding it';
    } finally {
      out.tookSec = (performance.now() - t0) / 1000;
      this.busy = false;
      this.spent += out.bytes;
      this.count++;
      this.last = out;
      // The cooldown IS the rate limit. Scaled by how much of the budget this
      // sounding ate, so a big sounding on a big pact costs a proportionally
      // longer wait — the stone recovers at one speed and a deeper listen takes
      // more out of it.
      this.readyAt = this.ctx.state.clock + CFG.n45.cooldownSec;
    }
    return this.last;
  }

  /** One tiny timed request. Returns ms, or 0 if it failed. */
  private async probe(): Promise<number> {
    const t = performance.now();
    try {
      const ctl = new AbortController();
      const tm = setTimeout(() => ctl.abort(), 4000);
      await fetch(PROBE + `&t=${Math.random()}`, { cache: 'no-store', signal: ctl.signal });
      clearTimeout(tm);
      return performance.now() - t;
    } catch { return 0; }
  }

  /** Pull `bytes` and time the steady-state portion.
   *
   *  Timed from FIRST BYTE, not from the fetch call, so DNS, TCP and TLS do not
   *  land inside a throughput number. Those three are already measured properly
   *  by N4.1's deep wire and folding them in here would understate bandwidth on
   *  exactly the cold connections where the handshake is most expensive. */
  private async download(bytes: number): Promise<{ mbps: number; bytes: number }> {
    try {
      const ctl = new AbortController();
      const tm = setTimeout(() => ctl.abort(), 30000);
      const resp = await fetch(DOWN + bytes + `&t=${Math.random()}`, { cache: 'no-store', signal: ctl.signal });
      const reader = resp.body?.getReader();
      if (!reader) { clearTimeout(tm); return { mbps: 0, bytes: 0 }; }
      let got = 0, t0 = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!t0) t0 = performance.now();   // first byte: the clock starts here
        got += value?.length ?? 0;
      }
      clearTimeout(tm);
      const sec = (performance.now() - t0) / 1000;
      return { mbps: sec > 0 ? (got * 8) / sec / 1e6 : 0, bytes: got };
    } catch { return { mbps: 0, bytes: 0 }; }
  }

  /** Push `bytes` and time it. The body is a zero-filled buffer — random data
   *  would be marginally more honest against a compressing middlebox, and
   *  generating megabytes of it on the main thread would cost more frame time
   *  than the measurement is worth. */
  private async upload(bytes: number): Promise<{ mbps: number; bytes: number }> {
    try {
      const body = new Uint8Array(bytes);
      const ctl = new AbortController();
      const tm = setTimeout(() => ctl.abort(), 30000);
      const t0 = performance.now();
      await fetch(UP, { method: 'POST', body, cache: 'no-store', signal: ctl.signal });
      clearTimeout(tm);
      const sec = (performance.now() - t0) / 1000;
      return { mbps: sec > 0 ? (bytes * 8) / sec / 1e6 : 0, bytes };
    } catch { return { mbps: 0, bytes: 0 }; }
  }
}

/** Pillar 7: what the stone heard, not what the instrument printed. */
function verdictFor(r: SoundingResult): string {
  if (!r.live) return 'the water gave nothing back';
  const flow = r.downMbps >= 100 ? 'the deep runs wide and fast'
    : r.downMbps >= 25 ? 'the deep runs clear'
    : r.downMbps >= 5 ? 'the deep runs narrow'
    : 'the deep is a trickle';
  const bloat = r.bloatGrade === 'A' ? ', and it stays steady under weight'
    : r.bloatGrade === 'B' ? ', and it barely stirs under weight'
    : r.bloatGrade === 'C' ? ', but it thickens when something leans on it'
    : r.bloatGrade === 'D' ? ', and it silts up badly under weight'
    : r.bloatGrade === 'F' ? ', and under weight it chokes'
    : '';
  return flow + bloat;
}

// ---------------------------------------------------------------------------
// The reward.
//
// "The results ARE the reward" is the plan's line, and the way to honour it
// without inventing a second buff system is to spend the reading through A8's
// Boon machinery. A Boon is already *a timed entry into the effect vocabulary*,
// already folded into `activeEffects()`, already displayed on the HUD, already
// cleared by newWorld(). A sounding therefore grants a Boon whose STRENGTH is
// the reading — which means a good connection is rewarded, a bad one is not
// punished (it simply pays less), and no new consumption wiring exists at all.
// ---------------------------------------------------------------------------

export interface SoundingReward {
  /** Boon id/name/effects to grant, or null if the sounding earned nothing. */
  boon: { id: string; name: string; blurb: string; effects: string[]; color: string; sec: number } | null;
  /** Flat gold, scaled by throughput. */
  gold: number;
  /** A line for the Chronicle. */
  line: string;
}

/** Turn a reading into a payout.
 *
 *  Three separate things are rewarded, because three separate things were
 *  measured and rewarding only bandwidth would make the other two decorative:
 *
 *    * **Throughput** pays gold. It is the raw size of the pipe, so it pays the
 *      raw fungible thing.
 *    * **Low bufferbloat** pays the Boon. A path that stays responsive under
 *      load is the one virtue here that a bigger pipe cannot buy, so it earns
 *      the thing money cannot: a timed blessing. Grade A or B only.
 *    * **A fast resolver** lengthens it. DNS has driven Scrying since N4.4;
 *      this is the second place it earns its keep. */
export function soundingReward(r: SoundingResult): SoundingReward {
  if (!r.live) {
    return { boon: null, gold: 0, line: 'The stone listened and heard nothing back.' };
  }
  const gold = Math.round(Math.min(400, 20 + r.downMbps * 3 + r.upMbps * 4));

  let boon = null as SoundingReward['boon'];
  if (r.bloatGrade === 'A' || r.bloatGrade === 'B') {
    // Longer for a fast resolver, and clamped so a pathological reading cannot
    // hand out a five-minute buff inside a fifteen-minute run.
    const sec = Math.round(Math.min(150, 60 + (r.resolverMs > 0 && r.resolverMs < 40 ? 45 : 0)
      + (r.bloatGrade === 'A' ? 30 : 0)));
    boon = {
      id: 'sounding_clarity', name: 'Clarity of the Deep',
      blurb: 'the water holds steady under weight — and so do you',
      // Two effects from the C4 vocabulary, both already consumed: the fog
      // presses less and everything the Echoes do hits harder. Naming an
      // unconsumed key here would be a dormant row wearing a reward's coat, and
      // testA8DataRows asserts against exactly that.
      effects: ['night_vision', 'resonance_boost'],
      color: '#7fd6a0', sec,
    };
  }
  const line = boon
    ? `The stone sounded the deep: ${r.downMbps.toFixed(1)} down, ${r.upMbps.toFixed(1)} up, `
      + `steady under weight (${r.bloatGrade}). +${gold} gold and ${boon.name}.`
    : `The stone sounded the deep: ${r.downMbps.toFixed(1)} down, ${r.upMbps.toFixed(1)} up, `
      + `but it silts under weight (${r.bloatGrade}). +${gold} gold.`;
  return { boon, gold, line };
}
