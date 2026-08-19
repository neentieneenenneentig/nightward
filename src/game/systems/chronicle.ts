// N4.2/N4.3 — the Chronicle: one time-series store for the whole run.
//
// What existed before: three plain arrays of 60 numbers, refreshed at 1 Hz.
// That is a one-minute sliding window, not a measurement history, and it could
// not answer the actual question — "what changed?" — because by the time you
// noticed something had changed, the thing it changed FROM had already been
// shifted off the front.
//
// Two decisions here are load-bearing:
//
// 1. **Aggregates, not decimation.** A 15-minute run at 1 Hz is ~900 samples
//    per series, which is fine, but a long session is not. Old samples collapse
//    into 10-second buckets that keep min/median/p95/max/count. Naive
//    downsampling (keep every tenth sample) would be simpler and would throw
//    away exactly the data worth keeping: THE OUTLIERS ARE THE INTERESTING
//    PART. A 400 ms spike that lasted two seconds is the whole story of a
//    network event, and it is precisely what "every tenth sample" deletes.
//
// 2. **Every sample carries its provenance.** A 25 ms-bucketed browser guess
//    and a µs-precision kernel RTT are not the same kind of number, and a store
//    that forgets which is which lets the Lens present them identically — the
//    one thing the Lens must never do.

/** How a number came to be known. The Lens renders these differently, and the
 *  export preserves them, because a reading without its provenance is a rumour. */
export type Quality =
  | 'measured'      // we timed it ourselves, or a kernel did
  | 'reported'      // the browser told us, at whatever precision it felt like
  | 'derived'       // we computed it from other numbers
  | 'unavailable';  // and the series carries WHY

export interface Sample { t: number; v: number; q: Quality }

/** A 10-second bucket of collapsed samples. min/max are kept because they are
 *  the events; median and p95 because they are the shape. */
export interface Bucket {
  t: number; n: number;
  min: number; med: number; p95: number; max: number;
  q: Quality;
}

export interface SeriesMeta {
  key: string;
  label: string;
  unit: string;
  /** Set when the series cannot be sampled at all on this browser/network, and
   *  says why in plain language. The Lens prints it verbatim — "unavailable"
   *  with no reason is indistinguishable from "broken". */
  unavailable?: string;
}

const FINE_SEC = 120;      // full 1 Hz resolution for the last two minutes
const BUCKET_SEC = 10;

class Series {
  fine: Sample[] = [];
  buckets: Bucket[] = [];
  constructor(public meta: SeriesMeta) {}

  push(t: number, v: number, q: Quality) {
    if (!Number.isFinite(v)) return;    // a NaN in the store is a NaN in the export
    this.fine.push({ t, v, q });
    this.compact(t);
  }

  private compact(now: number) {
    // Only whole buckets are allowed to collapse.
    //
    // Compacting everything older than `now - FINE_SEC` looks right and is
    // wrong: once the window starts sliding, exactly ONE sample ages out per
    // push, so every "bucket" ends up holding a single sample and its median is
    // that sample. A 900ms spike then reports med=900 — the aggregate becomes a
    // rename of the raw value and the whole retention scheme does nothing. So
    // the cutoff is rounded DOWN to a bucket boundary, and a bucket is only
    // flushed once every sample that could belong to it has aged out.
    const cutoff = Math.floor((now - FINE_SEC) / BUCKET_SEC) * BUCKET_SEC;
    if (this.fine.length === 0 || this.fine[0].t >= cutoff) return;
    const old: Sample[] = [];
    while (this.fine.length && this.fine[0].t < cutoff) old.push(this.fine.shift()!);
    if (!old.length) return;
    let start = Math.floor(old[0].t / BUCKET_SEC) * BUCKET_SEC;
    let group: Sample[] = [];
    const flush = () => {
      if (!group.length) return;
      const vs = group.map((s) => s.v).sort((a, b) => a - b);
      this.buckets.push({
        t: start,
        n: vs.length,
        min: vs[0],
        med: vs[vs.length >> 1],
        p95: vs[Math.min(vs.length - 1, Math.floor(vs.length * 0.95))],
        max: vs[vs.length - 1],
        q: group[group.length - 1].q,
      });
      group = [];
    };
    for (const s of old) {
      const b = Math.floor(s.t / BUCKET_SEC) * BUCKET_SEC;
      if (b !== start) { flush(); start = b; }
      group.push(s);
    }
    flush();
  }

  /** Newest value, or null if the series has never been sampled. */
  get last(): Sample | null { return this.fine.length ? this.fine[this.fine.length - 1] : null; }

  /** A flat series for drawing: buckets (median) followed by fine samples. */
  plot(): number[] {
    const out: number[] = [];
    for (const b of this.buckets) out.push(b.med);
    for (const s of this.fine) out.push(s.v);
    return out;
  }

  /** Mean and standard deviation over the HALF-OPEN window [from, to).
   *
   *  An explicit window rather than "the last N seconds": the baseline has to
   *  EXCLUDE the recent window it is being compared against, or the samples
   *  under test drag the baseline toward themselves and hide the very step the
   *  detector exists to find.
   *
   *  Returns null below `minN` — a baseline computed from three samples is not
   *  a baseline, and change detection built on one produces nothing but noise. */
  stats(from: number, to: number, minN = 8): { mean: number; sd: number; n: number } | null {
    const vs: number[] = [];
    for (let i = this.fine.length - 1; i >= 0; i--) {
      const t = this.fine[i].t;
      if (t >= to) continue;
      if (t < from) break;
      vs.push(this.fine[i].v);
    }
    if (vs.length < minN) return null;
    const mean = vs.reduce((a, b) => a + b, 0) / vs.length;
    const varc = vs.reduce((a, b) => a + (b - mean) * (b - mean), 0) / vs.length;
    return { mean, sd: Math.sqrt(varc), n: vs.length };
  }
}

/** A detected step change — both a Lens Feed line and (N4.3) a world event. */
export interface ChronicleEvent {
  t: number;
  key: string;
  label: string;
  dir: 'up' | 'down';
  from: number;
  to: number;
  /** How many standard deviations outside the baseline band. */
  sigma: number;
}

export class ChronicleStore {
  private series = new Map<string, Series>();
  /** Session start in ms, so every `t` is seconds since boot rather than an
   *  epoch — an exported chronicle should not carry a wall-clock timestamp the
   *  player did not ask to share. */
  readonly bootMs = Date.now();
  events: ChronicleEvent[] = [];
  private lastEventAt = new Map<string, number>();

  /** Seconds between repeat events for the same series. Without this a network
   *  hovering on the threshold emits one event per sample and the Feed becomes
   *  the same wall of noise the pickup toasts were before B5 aggregated them. */
  private static readonly EVENT_COOLDOWN = 25;
  private static readonly MAX_EVENTS = 200;

  define(meta: SeriesMeta) {
    const existing = this.series.get(meta.key);
    if (existing) { existing.meta = meta; return; }
    this.series.set(meta.key, new Series(meta));
  }

  push(key: string, t: number, v: number, q: Quality) {
    const s = this.series.get(key);
    if (!s) return;
    s.push(t, v, q);
    this.detect(s, t);
  }

  get(key: string): Series | undefined { return this.series.get(key); }
  keys(): string[] { return [...this.series.keys()]; }
  metaOf(key: string): SeriesMeta | undefined { return this.series.get(key)?.meta; }
  last(key: string): Sample | null { return this.series.get(key)?.last ?? null; }
  plot(key: string): number[] { return this.series.get(key)?.plot() ?? []; }

  /** Change detection — the thing the ask was actually about.
   *
   *  A short window is compared against a longer baseline that EXCLUDES it, so
   *  the recent samples cannot drag the baseline toward themselves and hide the
   *  very step being looked for. The band is expressed in standard deviations
   *  rather than as a fixed percentage: a satellite link that always wobbles by
   *  80 ms should not fire an event every minute, and a fibre link that never
   *  moves should fire on 20 ms. */
  private detect(s: Series, now: number) {
    if (s.meta.unavailable) return;
    const recent = s.stats(now - 15, now + 1, 6);
    const base = s.stats(now - 105, now - 15, 20);
    if (!recent || !base) return;
    const sd = Math.max(base.sd, Math.abs(base.mean) * 0.05, 1e-6);
    const sigma = (recent.mean - base.mean) / sd;
    if (Math.abs(sigma) < 3) return;
    const lastAt = this.lastEventAt.get(s.meta.key) ?? -1e9;
    if (now - lastAt < ChronicleStore.EVENT_COOLDOWN) return;
    this.lastEventAt.set(s.meta.key, now);
    this.events.push({
      t: now, key: s.meta.key, label: s.meta.label,
      dir: sigma > 0 ? 'up' : 'down',
      from: base.mean, to: recent.mean, sigma,
    });
    if (this.events.length > ChronicleStore.MAX_EVENTS) this.events.shift();
  }

  /** Drain events for the caller to turn into Feed lines / world events. */
  takeEvents(): ChronicleEvent[] {
    const out = this.events.slice();
    this.events.length = 0;
    return out;
  }

  /** The export. The panel is a data-collection instrument, so the data has to
   *  be able to leave it — same instinct that made the Playwright timeline
   *  artifacts worth keeping. Provenance travels with every series. */
  toJSON(extra: Record<string, unknown> = {}) {
    const series: Record<string, unknown> = {};
    for (const [key, s] of this.series) {
      series[key] = {
        label: s.meta.label,
        unit: s.meta.unit,
        unavailable: s.meta.unavailable ?? null,
        buckets: s.buckets,
        fine: s.fine,
      };
    }
    return {
      format: 'nightward-chronicle',
      version: 1,
      sessionStart: new Date(this.bootMs).toISOString(),
      exportedAt: new Date().toISOString(),
      ...extra,
      events: this.events,
      series,
    };
  }
}


/** The series the Chronicle strip draws and the export dumps. Keyed so the
 *  strip can ask for 'pulse'/'flow'/'fray' without knowing where they come
 *  from — the deep wire fills them when it is live and the browser estimates
 *  fill them when it is not, and the QUALITY tag on each sample is what keeps
 *  that honest. */
export const CHRONICLE_SERIES: SeriesMeta[] = [
  { key: 'pulse', label: 'Latency',    unit: 'ms' },
  { key: 'flow',  label: 'Throughput', unit: 'Mbps' },
  { key: 'fray',  label: 'Loss',       unit: '%' },
  { key: 'silt',  label: 'Bufferbloat',unit: '%' },
  { key: 'flux',  label: 'Jitter',     unit: 'ms' },
];

/** Sample every series once. Called at 1 Hz from the render loop.
 *
 *  Each sample records WHERE it came from: a kernel min_rtt is `measured`, a
 *  25 ms-bucketed browser guess is `reported`. A store that flattened the two
 *  would let the export claim precision it never had. */
export function sampleChronicle(store: ChronicleStore, net: any, tSec: number) {
  const s = net.snap;
  const live = !!s.deepLive;
  store.push('pulse', tSec, live && s.pulseMs > 0 ? s.pulseMs : s.rtt, live && s.pulseMs > 0 ? 'measured' : 'reported');
  store.push('flow', tSec, live && s.flowMbps > 0 ? s.flowMbps : s.downlink, live && s.flowMbps > 0 ? 'measured' : 'reported');
  store.push('fray', tSec, live ? s.fray * 100 : 0, live ? 'measured' : 'unavailable');
  store.push('silt', tSec, live ? s.silt * 100 : 0, live ? 'measured' : 'unavailable');
  store.push('flux', tSec, live && s.fluxMs > 0 ? s.fluxMs : s.jitter, live && s.fluxMs > 0 ? 'measured' : 'derived');
}

/** The export button. The Lens is a data-collection instrument, so the data has
 *  to be able to leave it. Nothing here is uploaded anywhere — it is a local
 *  download, and the session start is the only timestamp included. */
export function exportChronicle(store: ChronicleStore, net: any, state: any) {
  const s = net.snap;
  const payload = store.toJSON({
    seed: state?.seed,
    realm: net.getBiome?.()?.id,
    snapshot: {
      deepLive: s.deepLive,
      rtt: s.rtt, downlink: s.downlink, jitter: s.jitter,
      pulseMs: s.pulseMs, fluxMs: s.fluxMs, flowMbps: s.flowMbps,
      fray: s.fray, silt: s.silt, aperture: s.aperture,
      effectiveType: s.effectiveType, connectionType: s.connectionType,
      colo: s.colo, country: s.country,
    },
    l4: net.deep?.l4 ?? null,
    deepTimings: net.deep ? [...net.deep.timings.values()] : [],
    gate: net.wireStats?.() ?? null,
  });
  try {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `nightward-chronicle-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  } catch { /* a download blocked by the browser is not worth taking the frame for */ }
  return payload;
}
