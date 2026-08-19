// N4.1 — The Deep Wire.
//
// Everything the game measured before this was an INFERENCE. `connection.rtt`
// is quantised to 25 ms buckets and rounded for fingerprinting resistance;
// `connection.downlink` is capped at 10 Mbps and absent outside Chromium;
// jitter was a statistic computed from those buckets, so it was measuring the
// quantiser as much as the network. Packet loss was believed impossible from a
// browser at all.
//
// It is not. A Cloudflare edge that terminates our TCP connection will hand
// back its own kernel socket statistics in a `Server-Timing` header:
//
//   server-timing: cfL4;desc="?proto=TCP&rtt=2915&min_rtt=2372&rtt_var=1277
//     &sent=4&recv=6&lost=0&retrans=0&sent_bytes=2838&recv_bytes=660
//     &delivery_rate=1214165&cwnd=52&unsent_bytes=0&cid=a3b0..&ts=46"
//
// That is a TCP_INFO dump for our own connection, in MICROSECONDS, including
// `lost` and `retrans`. Real packet loss, from a browser, with no local agent.
//
// The second half is `Timing-Allow-Origin`. Without it the browser deliberately
// zeroes every cross-origin timing field, which is why the fourteen favicon
// beacons can NEVER give a DNS/TCP/TLS breakdown no matter how they are timed.
// With it, the full waterfall becomes readable. That splits the beacon pool in
// two — DEEP beacons that can be measured, SHALLOW ones that can only be timed
// — and the Lens has to show which is which, because the whole point of that
// panel is that it does not lie.
//
// Everything here fails silently into a neutral value. A blocked probe is
// content ("this network is filtered"), not an error, and no player is ever
// locked out of a balanced game by a middlebox.

/** One parsed `cfL4` description — the edge's kernel TCP socket state. */
export interface CfL4 {
  proto: string;
  /** Smoothed RTT, ms (the header carries µs). */
  rtt: number;
  /** Lowest RTT the socket has seen, ms. The path's physical floor. */
  minRtt: number;
  /** RTT variance, ms. Kernel-measured jitter, not inferred from buckets. */
  rttVar: number;
  sent: number;
  recv: number;
  /** Packets the kernel considers lost. */
  lost: number;
  /** Retransmissions — the best single "this network is unwell" signal there is. */
  retrans: number;
  sentBytes: number;
  recvBytes: number;
  /** Bytes/sec the socket actually achieved. Uncapped, unlike `downlink`. */
  deliveryRate: number;
  /** Congestion window in segments — how much the path will accept in flight. */
  cwnd: number;
  unsentBytes: number;
  cid: string;
  /** performance.now() when this was observed. */
  atMs: number;
}

/** A cross-origin resource whose host set `Timing-Allow-Origin`, so the browser
 *  filled the timing fields in instead of zeroing them. */
export interface DeepTiming {
  host: string;
  dns: number;
  tcp: number;
  tls: number;
  ttfb: number;
  total: number;
  transferSize: number;
  encodedSize: number;
  proto: string;
  atMs: number;
}

/** Every number here is untrusted third-party text being turned into a value a
 *  game system will divide by. `n()` is the whole defence: anything that is not
 *  a finite number in range becomes the fallback, never NaN.
 *  (WORKFLOW Pitfall 4 — a single NaN propagates through the mapping table and
 *  silently zeroes half the game's modifiers.) */
function n(v: string | undefined, fallback = 0, max = 1e12): number {
  if (v == null || v === '') return fallback;
  const x = Number(v);
  if (!Number.isFinite(x) || x < 0 || x > max) return fallback;
  return x;
}

/**
 * Parse a `cfL4` description. The value looks like a query string with a
 * leading `?`, but it arrives inside a quoted header parameter and Cloudflare
 * has changed its field set before — so this reads by KEY and never by
 * position, and tolerates missing, extra, and reordered fields.
 *
 * Returns null only when the input has no usable RTT at all; a partial dump is
 * still worth having.
 */
export function parseCfL4(desc: string | null | undefined): CfL4 | null {
  if (!desc) return null;
  const body = desc.replace(/^"?\??/, '').replace(/"$/, '');
  const kv = new Map<string, string>();
  for (const pair of body.split('&')) {
    const i = pair.indexOf('=');
    if (i <= 0) continue;
    kv.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
  }
  const US = 1000;                       // the header is microseconds
  const rtt = n(kv.get('rtt')) / US;
  const minRtt = n(kv.get('min_rtt')) / US;
  if (rtt <= 0 && minRtt <= 0) return null;
  return {
    proto: (kv.get('proto') ?? '').slice(0, 12),
    rtt,
    minRtt,
    rttVar: n(kv.get('rtt_var')) / US,
    sent: n(kv.get('sent')),
    recv: n(kv.get('recv')),
    lost: n(kv.get('lost')),
    retrans: n(kv.get('retrans')),
    sentBytes: n(kv.get('sent_bytes')),
    recvBytes: n(kv.get('recv_bytes')),
    deliveryRate: n(kv.get('delivery_rate')),
    cwnd: n(kv.get('cwnd')),
    unsentBytes: n(kv.get('unsent_bytes')),
    cid: (kv.get('cid') ?? '').slice(0, 32),
    atMs: performance.now(),
  };
}

/**
 * Parse a raw `Server-Timing` header into name → {dur, desc}.
 *
 * Hand-rolled rather than relying on `PerformanceServerTiming`, because the two
 * routes are not interchangeable: the header is readable whenever
 * `access-control-expose-headers` lists it, while the PerformanceObserver route
 * additionally needs `Timing-Allow-Origin`. Some paths give one and not the
 * other, so the Deep Wire reads both and takes whichever arrives.
 */
export function parseServerTiming(header: string | null | undefined): Map<string, { dur: number; desc: string }> {
  const out = new Map<string, { dur: number; desc: string }>();
  if (!header) return out;
  // Split on commas that are not inside a quoted string — descriptions contain
  // commas in the wild and a naive split shreds them.
  let depth = 0, start = 0;
  const parts: string[] = [];
  for (let i = 0; i < header.length; i++) {
    const c = header[i];
    if (c === '"') depth ^= 1;
    else if (c === ',' && !depth) { parts.push(header.slice(start, i)); start = i + 1; }
  }
  parts.push(header.slice(start));

  for (const raw of parts) {
    const segs = raw.split(';');
    const name = segs[0].trim();
    if (!name) continue;
    let dur = 0, desc = '';
    for (const seg of segs.slice(1)) {
      const i = seg.indexOf('=');
      if (i < 0) continue;
      const k = seg.slice(0, i).trim(), v = seg.slice(i + 1).trim();
      if (k === 'dur') dur = n(v);
      else if (k === 'desc') desc = v.replace(/^"|"$/g, '');
    }
    out.set(name, { dur, desc });
  }
  return out;
}

/** Hosts known to send `Timing-Allow-Origin: *`. Verified 2026-08-17; a host
 *  that stops sending it simply stops producing DeepTiming entries — the
 *  observer checks the actual entry rather than trusting this list. */
export const TAO_HOSTS = new Set([
  'speed.cloudflare.com',
  'cdnjs.cloudflare.com',
  'cdn.jsdelivr.net',
]);

/** 1 byte of body. The whole point of N4.1 is that the interesting data is in
 *  the HEADERS — spending the player's bandwidth to read a kernel counter would
 *  be absurd. The real throughput test is a separate, opt-in verb (N4.5). */
export const DEEP_PROBE_URL = 'https://speed.cloudflare.com/__down?bytes=1';
export const DEEP_PROBE_HOST = 'speed.cloudflare.com';

export interface DeepWireHost {
  /** Rate-limit gate. Returns false when the probe must not fire. */
  take(host: string, spacingSec?: number): boolean;
  release(): void;
  penalise(host: string, resp?: Response | null): void;
  log(kind: string, msg: string): void;
}

/**
 * The Deep Wire itself: one scheduled header-only probe, plus a passive
 * observer that harvests any TAO-enabled resource the page happens to load.
 */
export class DeepWire {
  /** Most recent kernel socket dump, or null if we have never got one. */
  l4: CfL4 | null = null;
  /** Rolling cfL4 history for change detection and the Lens strip. */
  history: CfL4[] = [];
  /** Most recent full waterfall per TAO host. */
  timings = new Map<string, DeepTiming>();
  /** Cloudflare `cf-meta-*` identity, harvested as a side effect of the probe. */
  meta: Record<string, string> = {};
  /** Why the Deep Wire has no data, if it has none. Shown in the Lens verbatim:
   *  a blocked probe is content, not an error. */
  status: 'idle' | 'live' | 'blocked' | 'off' = 'idle';
  /** Consecutive probe failures. Backs the probe off rather than hammering. */
  private fails = 0;
  private lastProbeMs = -1e9;
  private observer: PerformanceObserver | null = null;

  private static readonly MAX_HISTORY = 120;

  constructor(private host: DeepWireHost, private intervalSec = 45) {}

  /** Install the passive observer. Cheap and callback-driven — it costs nothing
   *  until a resource actually loads, and it needs no requests of its own. */
  start() {
    if (this.observer || typeof PerformanceObserver === 'undefined') return;
    try {
      this.observer = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) this.harvest(e as PerformanceResourceTiming);
      });
      this.observer.observe({ type: 'resource', buffered: true });
    } catch { this.observer = null; }
  }

  stop() { try { this.observer?.disconnect(); } catch { /* ignore */ } this.observer = null; }

  /** Pull whatever a resource entry is willing to give.
   *
   *  The TAO test is done on the ENTRY, not on a hostname allowlist: a host can
   *  stop sending the header, and a proxy can strip it. An entry without TAO has
   *  every timing field zeroed, which is indistinguishable from a perfect
   *  connection — so a zero `responseStart` is treated as "no data", never as
   *  "0 ms". Getting that backwards would report a filtered network as the
   *  fastest one the game has ever seen. */
  private harvest(e: PerformanceResourceTiming) {
    if (!e || !e.name) return;
    let host = '';
    try { host = new URL(e.name).hostname; } catch { return; }

    // serverTiming rides along on TAO-enabled entries
    const st = (e as any).serverTiming as ReadonlyArray<{ name: string; description: string }> | undefined;
    if (st && st.length) {
      for (const s of st) {
        if (s.name !== 'cfL4') continue;
        const parsed = parseCfL4(s.description);
        if (parsed) this.record(parsed);
      }
    }

    const hasTao = e.responseStart > 0 || e.connectEnd > e.connectStart;
    if (!hasTao) return;
    this.timings.set(host, {
      host,
      dns: Math.max(0, e.domainLookupEnd - e.domainLookupStart),
      tcp: Math.max(0, e.connectEnd - e.connectStart),
      tls: e.secureConnectionStart > 0 ? Math.max(0, e.connectEnd - e.secureConnectionStart) : 0,
      ttfb: Math.max(0, e.responseStart - e.requestStart),
      total: Math.max(0, e.responseEnd - e.startTime),
      transferSize: e.transferSize ?? 0,
      encodedSize: e.encodedBodySize ?? 0,
      proto: e.nextHopProtocol ?? '',
      atMs: performance.now(),
    });
  }

  private record(l4: CfL4) {
    this.l4 = l4;
    this.history.push(l4);
    if (this.history.length > DeepWire.MAX_HISTORY) this.history.shift();
    this.status = 'live';
    this.fails = 0;
  }

  /** Fire the scheduled probe if it is due and the gate allows it. Safe to call
   *  every frame; it is a no-op almost every time. */
  tick(nowMs: number) {
    if (this.status === 'off') return;
    // Exponential-ish backoff: a network that blocks this endpoint should be
    // asked once a minute at first and then left alone, not polled forever.
    const gap = this.intervalSec * 1000 * Math.min(16, 1 + this.fails * 3);
    if (nowMs - this.lastProbeMs < gap) return;
    this.lastProbeMs = nowMs;
    void this.probe();
  }

  async probe(): Promise<CfL4 | null> {
    if (!this.host.take(DEEP_PROBE_HOST, 20)) return null;
    const ctl = new AbortController();
    const tm = setTimeout(() => ctl.abort(), 6000);
    try {
      const resp = await fetch(DEEP_PROBE_URL, { signal: ctl.signal, cache: 'no-store' });
      if (!resp.ok) { this.host.penalise(DEEP_PROBE_HOST, resp); this.fail('http ' + resp.status); return null; }
      await resp.arrayBuffer();

      // Identity, consolidated. This is the same request — the IP, colo and
      // country come back as a SIDE EFFECT of a measurement we already wanted,
      // which is what let N4.0 retire api.ipify.org and ipapi.co outright.
      for (const k of ['ip', 'colo', 'country', 'city', 'asn', 'postalCode', 'latitude', 'longitude', 'timezone']) {
        const v = resp.headers.get('cf-meta-' + k) ?? resp.headers.get('cf-meta-' + k.toLowerCase());
        if (v) this.meta[k] = v.slice(0, 64);
      }

      const l4 = parseCfL4(parseServerTiming(resp.headers.get('server-timing')).get('cfL4')?.desc);
      if (!l4) { this.fail('no cfL4 in response'); return null; }
      this.record(l4);
      this.host.log('resonance-echo',
        `deep wire · rtt ${l4.rtt.toFixed(2)}ms · min ${l4.minRtt.toFixed(2)}ms · var ${l4.rttVar.toFixed(2)}ms` +
        ` · lost ${l4.lost} · retrans ${l4.retrans} · cwnd ${l4.cwnd}`);
      return l4;
    } catch {
      this.host.penalise(DEEP_PROBE_HOST, null);
      this.fail('unreachable');
      return null;
    } finally {
      clearTimeout(tm);
      this.host.release();
    }
  }

  private fail(why: string) {
    this.fails++;
    if (this.fails >= 3 && this.status !== 'live') {
      this.status = 'blocked';
      this.host.log('resonance', `The deep wire is silent here (${why}). Falling back to estimates.`);
    }
  }

  // ---- derived truths ------------------------------------------------------
  // Each returns a NEUTRAL value when there is no data, never a sentinel that a
  // caller might treat as a real reading.

  /** **Fray** — loss and retransmission as a 0..1 severity. The clearest
   *  "hostile network" signal there is, and the only one that was previously
   *  believed unavailable to a browser at all. */
  get fray(): number {
    const l = this.l4;
    if (!l) return 0;
    const packets = l.sent + l.recv;
    if (packets <= 0) return 0;
    // retrans is weighted above lost: a kernel that is retransmitting is
    // actively fighting the path, whereas a single lost packet on a long-lived
    // socket is ordinary.
    return Math.min(1, (l.lost + l.retrans * 1.5) / Math.max(8, packets));
  }

  /** **Silt** — how far the current RTT sits above the path's own floor, 0..1.
   *  Buffers filling up IS the wire silting. Measured against min_rtt rather
   *  than an absolute threshold, so a genuinely distant player is not
   *  permanently penalised for living far from an edge. */
  get silt(): number {
    const l = this.l4;
    if (!l || l.minRtt <= 0) return 0;
    return Math.min(1, Math.max(0, (l.rtt - l.minRtt) / Math.max(20, l.minRtt * 4)));
  }

  /** **Aperture** — congestion window in segments; how much the path will
   *  currently accept in flight. Neutral 10 is the common initial cwnd. */
  get aperture(): number { return this.l4?.cwnd || 10; }

  /** **Flow** — real achieved throughput in Mbps. Replaces `downlink`, which is
   *  capped at 10 Mbps and absent outside Chromium. 0 means "unmeasured", and
   *  callers must fall back rather than treat it as a stalled link. */
  get flowMbps(): number {
    const r = this.l4?.deliveryRate ?? 0;
    return r > 0 ? (r * 8) / 1e6 : 0;
  }

  /** **Pulse** — the path's true latency floor in ms, or 0 if unmeasured. */
  get pulseMs(): number { return this.l4?.minRtt || 0; }

  /** **Flux** — kernel-measured RTT variance in ms, or 0 if unmeasured. */
  get fluxMs(): number { return this.l4?.rttVar || 0; }

  /** Is anything in here real? The Lens uses this to tag every number it shows
   *  as measured or estimated, which is the difference between the panel being
   *  a diagnostic and being decoration. */
  get isLive(): boolean { return this.status === 'live' && this.l4 != null; }

  /** Deep hosts seen this session — the ones a waterfall can be read from. */
  get deepHosts(): string[] { return [...this.timings.keys()]; }
}
