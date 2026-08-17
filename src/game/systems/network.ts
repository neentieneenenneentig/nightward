// ResonanceSystem — polls browser APIs, maintains a snapshot, computes
// game mappings, and pushes params to the Rust core every frame.
//
// Key design decisions:
// - update() is sync and non-blocking (beacon pings are fire-and-forget)
// - Every metric read is wrapped in a fallback — no NaN/undefined can leak
// - Realm transitions are debounced (5s stability window)
// - Rift events fire on confirmed transitions with 30s cooldown between rifts
// - The Float32Array pack layout is a contract with Rust (see network.ts)
import {
  NET_METRICS, NET_GAME_MAP,
  type NetworkSnapshot, type NetMapping, type NetGameMapping,
  type TraceHop, type BeaconEcho, type BeaconTarget,
  ACTION_ECHO_POOLS, ACTION_COOLDOWNS, allBeacons,
  DOH_RESOLVERS, WIRE_BUDGET,
} from '../data/network';
import { biomeForConnection, biomeForProfile, BIOMES, type BiomeDef } from '../data/biomes';

function noNet(): boolean {
  try {
    if ((globalThis as any).__NW_NO_NET) return true;
    return new URLSearchParams(location.search).has('nonet');
  } catch { return false; }
}

class NetGate {
  private tokens = WIRE_BUDGET.burst;
  private lastRefill = 0;
  private inflight = 0;
  private hostNext: Map<string, number> = new Map();
  private globalUntil = 0;
  readonly off = noNet();
  granted = 0;
  denied = 0;

  private refill(now: number) {
    if (!this.lastRefill) { this.lastRefill = now; return; }
    const gained = ((now - this.lastRefill) / 60000) * WIRE_BUDGET.ratePerMin;
    if (gained <= 0) return;
    this.tokens = Math.min(WIRE_BUDGET.burst, this.tokens + gained);
    this.lastRefill = now;
  }

  take(host: string, spacingSec = WIRE_BUDGET.hostSpacingSec): boolean {
    if (this.off) return false;
    const now = performance.now();
    if (now < this.globalUntil) { this.denied++; return false; }
    if (this.inflight >= WIRE_BUDGET.maxInflight) { this.denied++; return false; }
    if (now < (this.hostNext.get(host) ?? 0)) { this.denied++; return false; }
    this.refill(now);
    if (this.tokens < 1) { this.denied++; return false; }
    this.tokens -= 1;
    this.inflight++;
    this.granted++;
    this.hostNext.set(host, now + spacingSec * 1000);
    return true;
  }

  release() { this.inflight = Math.max(0, this.inflight - 1); }

  /** Honour 429/503 + Retry-After, and back a host off on hard failure. */
  penalise(host: string, resp?: Response | null) {
    const now = performance.now();
    let waitMs = 0;
    if (resp) {
      const ra = resp.headers.get('retry-after');
      if (ra) {
        const secs = Number(ra);
        waitMs = Number.isFinite(secs) ? secs * 1000 : Math.max(0, Date.parse(ra) - Date.now());
      }
      if (resp.status === 429 || resp.status === 503) {
        if (!waitMs) waitMs = 60000;
        this.globalUntil = now + waitMs;
      }
    }
    this.hostNext.set(host, now + Math.max(waitMs, 120000));
  }
}

export class NetworkSystem {
  private gate = new NetGate();
  private baseHref = (() => {
    try { return new URL(document.baseURI).href; } catch { return '/'; }
  })();
  private selfHost = (() => {
    try { return location.hostname || 'origin'; } catch { return 'origin'; }
  })();
  private lastBeaconMs = 0;
  private nextBeaconGap = WIRE_BUDGET.beaconIntervalSec * 1000;
  private lastBaselineMs = 0;
  private lastTraceMs = 0;
  private actionBias: string[] = [];
  private resolverTurn = 0;
  /** Per-resolver latency samples — the resolver race. */
  resolverStats: Map<string, { n: number; total: number; best: number }> = new Map();
  /** Same-origin control probe: full timing, zero third-party exposure. */
  baseline: { ms: number; dns: number; tcp: number; tls: number; ttfb: number; proto: string } | null = null;
  /** TLS version / key exchange / HTTP protocol, from Cloudflare trace. */
  tlsVersion = '';
  kex = '';
  httpProto = '';
  /** Local clock minus server clock (ms). */
  clockSkewMs = 0;
  snap: NetworkSnapshot;
  mappings: Record<string, NetMapping> = {};
  gameMappings: NetGameMapping[] = NET_GAME_MAP;

  // ---- biome & rift state ----
  currentBiome: BiomeDef;
  lastRiftTime = 0;          // timestamp of last rift
  riftStability = 100;       // 0-100%, decays over time
  private queuedRift: string | null = null; // queued connection type for next rift
  private riftCallback: ((from: BiomeDef, to: BiomeDef) => void) | null = null;
  private transitionLogCallback: ((msg: string) => void) | null = null;

  // ---- internal state ----
  /** Connection RTT samples — ONLY connection.rtt values, never HTTP echoes. Used for jitter. */
  private rttSamples: number[] = [];
  /** Per-beacon echo samples keyed by URL. Used for echoJitter (same-beacon successive deltas). */
  private echoSamples: Map<string, number[]> = new Map();
  private lastPollMs = 0;
  private lastConnectionType = '';
  private lastOnline = true;

  // transition debouncing
  private pendingTransition: { from: string; to: string; since: number } | null = null;
  private lastKnownType = '';
  private transitionCallback: ((from: string, to: string) => void) | null = null;

  // ---- M2.3: history buffers for sparklines (last 60s) ----
  historyRtt: number[] = [];
  historyJitter: number[] = [];
  historyBw: number[] = [];
  private historyInterval = 1000; // sample every 1s
  private lastHistorySampleMs = 0;

  // ---- M3.5: IP/geo refresh throttling ----
  private ipFetching = false;
  /** Whether identity probes (IP/geo) have been fetched at least once. */
  private identityFetched = false;

  // ---- Action-gated beacon discovery ----
  /** Set of endpoint labels that have been discovered through gameplay. */
  discoveredEndpoints: Set<string> = new Set();
  /** Per-action-type cooldown timestamps (ms). */
  private actionCooldowns: Map<string, number> = new Map();

  // ---- M3.6v2: Sync RTT → Damage + Resonance Crits ----
  /** Sync RTT at the moment of the last swing (ms). */
  lastSwingRtt: number = 50;
  /** Damage multiplier applied to the last swing. */
  lastSwingDmgMul: number = 1.0;
  /** Endpoint that triggered the last resonance crit (empty if none). */
  lastResonanceLabel: string = '';
  /** Pending resonance from a fast-resolving attack probe — consumed by combat. */
  private pendingResonance: { rtt: number; label: string; multiplier: number } | null = null;
  /** Timestamp of last full attack volley (ms). Throttled to 1 per 1.5s. */
  private lastAttackVolleyMs = 0;
  /** Beacon URLs that have been contacted at least twice — crit-eligible. */
  private warmedRoutes: Set<string> = new Set();

  // ---- M3.6: Passive metric snapshots (zero-request, browser APIs only) ----
  /** Bandwidth snapshot from the most recent gather action (Mbps). */
  lastGatherBw: number = 0;
  /** Jitter snapshot from the most recent craft action (ms). */
  lastCraftJitter: number = 0;
  /** Effective type snapshot from the most recent damage action ('4g', '3g', etc.). */
  lastDamageTier: string = '';
  /** RTT at last dusk (for survive_night drift computation). */
  private duskRtt: number = 0;
  /** RTT drift over the last night (dawn RTT − dusk RTT, ms). */
  nightRttDrift: number = 0;
  /** S1: night-RTT stability tracker — RTT samples collected during the night. */
  private nightRttSamples: number[] = [];
  /** S1: clock time when the current night started. */
  private nightStartClock: number = 0;
  /** DNS/TCP/TLS timing from last build action. */
  lastBuildDns: number = 0;
  lastBuildTcp: number = 0;
  lastBuildTls: number = 0;

  // ---- N2a: Last echo record (for mobs born from operations) ----
  /** Most recent completed probe result. Set on every completed beacon fetch. */
  lastEcho: { ms: number; cold: boolean; jitterAtBirth: number; route: { label: string; region: string; countryCode: string }; tsMs: number } | null = null;
  /** Number of distinct route regions probed this session. */
  distinctRegionsProbed: number = 0;

  /** Record a history sample for sparkline rendering. Called from the render loop. */
  recordHistory(nowMs: number) {
    if (nowMs - this.lastHistorySampleMs < this.historyInterval) return;
    this.lastHistorySampleMs = nowMs;
    const maxSamples = 60; // 60s window at 1Hz
    const push = (arr: number[], v: number) => {
      arr.push(v);
      if (arr.length > maxSamples) arr.shift();
    };
    push(this.historyRtt, this.snap.rtt);
    push(this.historyJitter, this.snap.jitter);
    push(this.historyBw, this.snap.downlink);
  }

  constructor() {
    this.snap = this.freshSnapshot();
    this.lastConnectionType = this.snap.connectionType;
    this.lastKnownType = this.snap.connectionType;
    this.lastOnline = this.snap.online;
    this.currentBiome = this.selectBiome();
    this.buildMappingIndex();
    // F8: Identity probes (IP/geo) are gated behind the first `explore` action.
    // No automatic fetch on boot — "scrying reveals who you are."
    // Boot log: list every external endpoint the game may contact.
    this.logEndpointDisclosure();
  }

  /** Boot-time disclosure of every external endpoint the game contacts. */
  private logEndpointDisclosure() {
    if (this.gate.off) {
      console.log('[NIGHTWARD] Network probing DISABLED (?nonet / __NW_NO_NET). All Wire metrics use neutral fallbacks.');
      return;
    }
    const contacted = [...DOH_RESOLVERS.map(r => r.url), 'https://cloudflare.com/cdn-cgi/trace', this.baseHref];
    const resolved = allBeacons().map(b => b.host).sort();
    console.log(
      '[NIGHTWARD] Endpoints this game CONTACTS: ' + contacted.join(', ')
      + ' — all public services that exist to answer unsolicited requests, rate-limited to '
      + WIRE_BUDGET.ratePerMin + ' req/min total.'
      + '\n[NIGHTWARD] Hostnames this game RESOLVES via those resolvers (never contacted directly): '
      + resolved.join(', ')
      + '\nNo data leaves the browser except the implicit IP in requests to the listed endpoints; nothing is stored server-side.',
    );
  }

  // ---- public API ----

  /** Called once per frame (render, not sim) — polls slow metrics on their interval. */
  update(nowMs: number) {
    this.pollConnection(nowMs);
    this.pollSensors(nowMs);
    this.pollBeacons(nowMs);
    this.pollBaseline(nowMs);
    this.computeJitter();
    this.snap.timeOfDay = this.realTimeOfDay();
    this.detectTransitions(nowMs);
    this.decayStability(nowMs);
    this.pollIpInfo(nowMs);
  }

  /** Get a mapped game value by key. Systems read this, not the raw snapshot. */
  get(key: string): number {
    const m = this.mappings[key];
    if (!m) return 0;
    try { return m.compute(this.snap); } catch { return m.fallback; }
  }

  /** Get a game mapping's transformed value for a target system. */
  getGameValue(target: string): number {
    const gm = this.gameMappings.find(m => m.target === target);
    if (!gm) return 1.0;
    const raw = this.get(gm.netKey);
    try {
      const ctx = { snap: this.snap, distinctRegionsProbed: this.distinctRegionsProbed };
      const val = gm.transform(raw, ctx);
      return Math.max(gm.min, Math.min(gm.max, val));
    } catch {
      return 1.0;
    }
  }

  /** Push the current snap to the Rust core as a flat Float32Array.
   *  Layout matches Rust's `net_params` indices exactly. */
  packForCore(): Float32Array {
    const s = this.snap;
    const tier = ({ '4g': 1, '3g': 2, '2g': 3, 'slow-2g': 4, 'unknown': 1 } as Record<string, number>)[s.effectiveType] ?? 1;
    const realm = ({ 'ethernet': 0, 'wifi': 1, 'cellular': 2, 'unknown': 0 } as Record<string, number>)[s.connectionType] ?? 0;
    return new Float32Array([
      s.rtt, s.downlink, s.jitter, tier, realm, s.online ? 1 : 0, s.timeOfDay,
      s.cpuCores, s.deviceMemory, s.endpointLatency, s.pageDnsTime, s.pageTlsTime, s.pageTtfb,
    ]);
  }

  /** Register a callback for connection-type transitions (used by log.ts). */
  onTransition(cb: (from: string, to: string) => void) {
    this.transitionCallback = cb;
  }

  // ---- rift & biome API ----

  /** Register a callback for rift events (biome changes that trigger visual effects). */
  onRift(cb: (from: BiomeDef, to: BiomeDef) => void) {
    this.riftCallback = cb;
  }

  /** Register a callback for transition log messages. */
  onTransitionLog(cb: (msg: string) => void) {
    this.transitionLogCallback = cb;
  }

  // ---- N2: detailed network event logging ----
  private netLogCallback: ((kind: string, msg: string) => void) | null = null;

  /** Register a callback for detailed network event logs (RTT, BW, jitter, endpoint probes). */
  onNetLog(cb: (kind: string, msg: string) => void) {
    this.netLogCallback = cb;
  }

  private netLog(kind: string, msg: string) {
    if (this.netLogCallback) this.netLogCallback(kind, msg);
  }

  /** Get the current biome definition. */
  getBiome(): BiomeDef {
    return this.currentBiome;
  }

  // ---- D1: profile-based realm selection ----

  /** Compute median and variance from recent beacon echoes. Returns {median, variance} or null. */
  computeRealmProfile(): { median: number; variance: number } | null {
    const echoes: number[] = [];
    for (const probe of this.snap.endpointProbes) {
      if (probe.rtt > 0) echoes.push(probe.rtt);
    }
    if (echoes.length < 2) return null;
    echoes.sort((a, b) => a - b);
    const mid = echoes.length >> 1;
    const median = echoes.length % 2 === 1
      ? echoes[mid]
      : (echoes[mid - 1] + echoes[mid]) / 2;
    // Variance: average squared deviation from median
    let sumSq = 0;
    for (const v of echoes) sumSq += (v - median) ** 2;
    const variance = sumSq / echoes.length;
    return { median, variance };
  }

  /**
   * Select biome using D1 priority:
   * 1. Offline → The Hollow
   * 2. Beacon-echo profile (median + variance) → realm
   * 3. Android connection.type bonus (only if type is known and not 'unknown')
   * 4. Fallback → The Steadfast Vale (calm default)
   */
  selectBiome(): BiomeDef {
    // 1. Offline is always The Hollow
    if (!this.snap.online) return BIOMES[3];

    // 2. Try beacon-echo profile
    const profile = this.computeRealmProfile();
    if (profile) {
      const b = biomeForProfile(profile.median, profile.variance);
      if (b) return b;
    }

    // 3. Android bonus: connection.type (only if known and not 'unknown')
    const ct = biomeForConnection(this.snap.connectionType);
    if (ct) return ct;

    // 4. Fallback
    return BIOMES[0]; // The Steadfast Vale
  }

  /** Get rift stability as 0-1 fraction. */
  getStability(): number {
    return this.riftStability / 100;
  }

  /** Manually trigger a rift to a specific connection type (for testing). */
  triggerRift(type: string) {
    const from = this.currentBiome;
    this.lastKnownType = type;
    this.lastConnectionType = type;
    this.snap.connectionType = type;
    this.currentBiome = this.selectBiome();
    this.riftStability = 100;
    this.lastRiftTime = performance.now();
    if (this.riftCallback) this.riftCallback(from, this.currentBiome);
  }

  /** Get network uptime (real ms since construction). */
  private _startMs = performance.now();
  uptimeMs(): number {
    return performance.now() - this._startMs;
  }

  // ---- internal ----

  private freshSnapshot(): NetworkSnapshot {
    const con = (navigator as any).connection;
    const nav = performance.getEntriesByType('navigation')[0] as any;
    return {
      rtt: this.safeNum(con?.rtt, 50, 1, 5000),
      downlink: this.safeNum(con?.downlink, 10, 0.1, 1000),
      connectionType: con?.type || 'unknown',
      effectiveType: con?.effectiveType || '4g',
      jitter: 5,
      echoJitter: 5,
      online: navigator.onLine,
      timeOfDay: this.realTimeOfDay(),
      cpuCores: navigator.hardwareConcurrency || 4,
      deviceMemory: (navigator as any).deviceMemory || 4,
      endpointLatency: 30,
      pageDnsTime: (nav?.domainLookupEnd && nav?.domainLookupStart) ? nav.domainLookupEnd - nav.domainLookupStart : 10,
      pageTlsTime: (nav?.connectEnd && nav?.secureConnectionStart) ? nav.connectEnd - nav.secureConnectionStart : 20,
      pageTtfb: (nav?.responseStart && nav?.requestStart) ? nav.responseStart - nav.requestStart : 50,
      // M3.5: deep network identity — filled async by fetchIpFromTrace / fetchGeoInfo
      publicIp: '...',
      isp: '...',
      city: '...',
      country: '..',
      colo: '...',
      asn: '...',
      warp: false,
      traceChain: [],
      endpointProbes: [],
      // X1: new Lens fields (battery/heap refreshed by pollSensors)
      batteryLevel: -1,
      batteryCharging: false,
      locale: navigator.language || 'en-US',
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
      jsHeapUsedMB: (performance as any).memory?.usedJSHeapSize ? (performance as any).memory.usedJSHeapSize / 1e6 : 50,
      jsHeapTotalMB: (performance as any).memory?.totalJSHeapSize ? (performance as any).memory.totalJSHeapSize / 1e6 : 100,
    };
  }

  private safeNum(val: any, fallback: number, min: number, max: number): number {
    if (typeof val !== 'number' || val <= 0) return fallback;
    return Math.max(min, Math.min(max, val));
  }

  private realTimeOfDay(): number {
    const d = new Date();
    return (d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds() + d.getMilliseconds() / 1000) / 86400;
  }

  /** X1: device sensors — battery (Chrome/Edge; no permission prompt) and JS
   *  heap. The BatteryManager is fetched once and cached; reads are sync. */
  private battery: any = null;
  private batteryRequested = false;
  private lastSensorMs = 0;
  private pollSensors(nowMs: number) {
    if (nowMs - this.lastSensorMs < 10000) return;
    this.lastSensorMs = nowMs;
    if (!this.batteryRequested) {
      this.batteryRequested = true;
      (navigator as any).getBattery?.()?.then((b: any) => { this.battery = b; }).catch(() => {});
    }
    if (this.battery) {
      this.snap.batteryLevel = this.battery.level ?? -1;
      this.snap.batteryCharging = !!this.battery.charging;
    }
    const mem = (performance as any).memory;
    if (mem?.usedJSHeapSize) {
      this.snap.jsHeapUsedMB = mem.usedJSHeapSize / 1e6;
      this.snap.jsHeapTotalMB = (mem.totalJSHeapSize ?? mem.usedJSHeapSize) / 1e6;
    }
  }

  private pollConnection(nowMs: number) {
    if (nowMs - this.lastPollMs < 1000) return;
    this.lastPollMs = nowMs;
    const con = (navigator as any).connection;
    if (con) {
      const prevRtt = this.snap.rtt;
      const prevDl = this.snap.downlink;
      const rtt = this.safeNum(con.rtt, this.snap.rtt, 1, 5000);
      const dl = this.safeNum(con.downlink, this.snap.downlink, 0.1, 1000);
      this.snap.rtt = rtt;
      this.snap.downlink = dl;
      this.snap.connectionType = con.type || this.snap.connectionType;
      this.snap.effectiveType = con.effectiveType || this.snap.effectiveType;

      // log significant pulse changes (>10ms delta)
      if (Math.abs(rtt - prevRtt) > 10) {
        const dir = rtt > prevRtt ? '↑' : '↓';
        this.netLog('resonance-pulse',
          `Pulse ${dir} ${prevRtt.toFixed(0)}→${rtt.toFixed(0)}ms  |  sim ${this.getGameValue('simSpeed').toFixed(2)}×`);
      }
      // log significant flow changes (>20% delta)
      if (Math.abs(dl - prevDl) / Math.max(prevDl, 0.1) > 0.2) {
        const dir = dl > prevDl ? '↑' : '↓';
        this.netLog('resonance-flow',
          `Flow ${dir} ${prevDl.toFixed(1)}→${dl.toFixed(1)}Mbps  |  gold ${this.getGameValue('goldRate').toFixed(2)}×`);
      }

      // sample RTT into the ring buffer for jitter computation
      this.rttSamples.push(rtt);
      if (this.rttSamples.length > 30) this.rttSamples.shift();
    } else {
      // Firefox/Safari: log that we're using fallback
      if (nowMs - this.lastPollMs < 2000 && this.rttSamples.length === 0) {
        this.netLog('resonance-link', 'Browser connection API unavailable — using fallback defaults');
      }
    }
  }

  /** Wall-clock beacon scheduler. Resolves ONE hostname per tick via DoH.
   *  Nothing in the game loop can raise this rate — only real time can. */
  private pollBeacons(nowMs: number) {
    if (this.gate.off || !this.snap.online) return;
    if (nowMs - this.lastBeaconMs < this.nextBeaconGap) return;
    this.lastBeaconMs = nowMs;
    const j = WIRE_BUDGET.beaconJitter;
    this.nextBeaconGap = WIRE_BUDGET.beaconIntervalSec * 1000 * (1 - j + Math.random() * 2 * j);
    const target = this.pickBeacon();
    if (target) this.resolveBeacon(target);
  }

  /** Undiscovered beacons from recently-played action pools come first, so
   *  "playing reveals the map" survives with zero coupling to action rate. */
  private pickBeacon(): BeaconTarget | null {
    const pools: BeaconTarget[] = [];
    for (const a of this.actionBias) {
      const p = ACTION_ECHO_POOLS[a];
      if (p) pools.push(...p);
    }
    const all = allBeacons();
    const biased = pools.length ? pools : all;
    const fresh = biased.filter(b => !this.discoveredEndpoints.has(b.label));
    const pick = (xs: BeaconTarget[]) => xs.length ? xs[(Math.random() * xs.length) | 0] : null;
    return pick(fresh) ?? pick(all.filter(b => !this.discoveredEndpoints.has(b.label))) ?? pick(biased) ?? pick(all);
  }

  private async resolveBeacon(t: BeaconTarget) {
    const r = await this.resolveHost(t.host);
    if (!r) return;
    if (r.ms < 0) {
      this.mergeProbeResult({ host: t.host, label: t.label, rtt: -1, detail: 'no answer', region: t.region, countryCode: t.countryCode });
      this.discoveredEndpoints.add(t.label);
      this.netLog('resonance-echo', `${t.label}: no answer`);
      return;
    }
    const wasWarm = this.warmedRoutes.has(t.host);
    this.warmedRoutes.add(t.host);
    this.snap.endpointLatency = r.ms;
    this.trackEchoSample(t.host, r.ms);
    this.mergeProbeResult({
      host: t.host, label: t.label, rtt: r.ms, region: t.region, countryCode: t.countryCode,
      detail: r.ip, ip: r.ip, ttl: r.ttl, resolver: r.resolver, ad: r.ad,
    });
    this.discoveredEndpoints.add(t.label);

    const samples = this.echoSamples.get(t.host) ?? [];
    const jitterAtBirth = samples.length >= 2
      ? Math.abs(samples[samples.length - 1] - samples[samples.length - 2]) : 0;
    const regions = new Set<string>();
    for (const p of this.snap.endpointProbes) if (p.rtt > 0) regions.add(p.region);
    regions.add(t.region);
    this.distinctRegionsProbed = regions.size;
    this.lastEcho = {
      ms: r.ms, cold: !wasWarm, jitterAtBirth,
      route: { label: t.label, region: t.region, countryCode: t.countryCode },
      tsMs: performance.now(),
    };
    this.netLog('resonance-echo',
      `${t.label} → ${r.ip} in ${r.ms.toFixed(0)}ms via ${r.resolver} (ttl ${r.ttl}${r.ad ? ' · dnssec' : ''})${wasWarm ? '' : ' — route discovered'}`);
  }

  /** One DoH query. Alternates resolvers so both get raced over a session. */
  private async resolveHost(host: string, type = 'A'): Promise<{ ms: number; ip: string; ttl: number; ad: boolean; resolver: string } | null> {
    const res = DOH_RESOLVERS[this.resolverTurn++ % DOH_RESOLVERS.length];
    const rHost = new URL(res.url).hostname;
    if (!this.gate.take(host, WIRE_BUDGET.hostSpacingSec)) return null;
    const ctl = new AbortController();
    const tm = setTimeout(() => ctl.abort(), 5000);
    const t0 = performance.now();
    try {
      const resp = await fetch(`${res.url}?name=${encodeURIComponent(host)}&type=${type}`, {
        signal: ctl.signal,
        headers: res.accept ? { Accept: res.accept } : undefined,
      });
      if (!resp.ok) { this.gate.penalise(rHost, resp); return { ms: -1, ip: '', ttl: 0, ad: false, resolver: res.label }; }
      const data = await resp.json();
      const ms = performance.now() - t0;
      const ans = (data?.Answer ?? []).filter((a: any) => a.type === 1 || a.type === 28 || a.type === 12);
      const st = this.resolverStats.get(res.label) ?? { n: 0, total: 0, best: Infinity };
      st.n++; st.total += ms; st.best = Math.min(st.best, ms);
      this.resolverStats.set(res.label, st);
      return {
        ms, resolver: res.label,
        ip: ans[0]?.data ?? '',
        ttl: ans[0]?.TTL ?? 0,
        ad: !!data?.AD,
      };
    } catch {
      this.gate.penalise(rHost, null);
      return { ms: -1, ip: '', ttl: 0, ad: false, resolver: res.label };
    } finally {
      clearTimeout(tm);
      this.gate.release();
    }
  }

  /** Same-origin control probe. Full PerformanceResourceTiming breakdown, and
   *  the only host we have unambiguous right to talk to. */
  private async pollBaseline(nowMs: number) {
    if (this.gate.off || !this.snap.online) return;
    if (nowMs - this.lastBaselineMs < WIRE_BUDGET.baselineIntervalSec * 1000) return;
    this.lastBaselineMs = nowMs;
    const url = `${this.baseHref}${this.baseHref.includes('?') ? '&' : '?'}_nw=baseline&t=${Date.now()}`;
    if (!this.gate.take(this.selfHost, 5)) return;
    const ctl = new AbortController();
    const tm = setTimeout(() => ctl.abort(), 5000);
    const t0 = performance.now();
    try {
      const resp = await fetch(url, { signal: ctl.signal, cache: 'no-store' });
      const ms = performance.now() - t0;
      if (!resp.ok) { this.gate.penalise(this.selfHost, resp); return; }
      await resp.arrayBuffer();
      this.readClockSkew(resp, ms);
      const e = performance.getEntriesByType('resource')
        .filter((x: any) => x.name.includes('_nw=baseline')).pop() as any;
      this.baseline = e ? {
        ms,
        dns: Math.max(0, e.domainLookupEnd - e.domainLookupStart),
        tcp: Math.max(0, e.connectEnd - e.connectStart),
        tls: e.secureConnectionStart > 0 ? Math.max(0, e.connectEnd - e.secureConnectionStart) : 0,
        ttfb: Math.max(0, e.responseStart - e.requestStart),
        proto: e.nextHopProtocol || '',
      } : { ms, dns: 0, tcp: 0, tls: 0, ttfb: 0, proto: '' };
      this.trackEchoSample(this.selfHost, ms);
      this.netLog('resonance-echo',
        `origin baseline ${ms.toFixed(0)}ms · dns ${this.baseline.dns.toFixed(0)} · tcp ${this.baseline.tcp.toFixed(0)} · tls ${this.baseline.tls.toFixed(0)} · ttfb ${this.baseline.ttfb.toFixed(0)}${this.baseline.proto ? ` · ${this.baseline.proto}` : ''}`);
    } catch {
      this.gate.penalise(this.selfHost, null);
    } finally {
      clearTimeout(tm);
      this.gate.release();
    }
  }

  private readClockSkew(resp: Response, rttMs: number) {
    const d = resp.headers.get('date');
    if (!d) return;
    const server = Date.parse(d);
    if (!Number.isFinite(server)) return;
    this.clockSkewMs = Date.now() - (server + rttMs / 2);
  }

  private computeJitter() {
    if (this.rttSamples.length < 3) return;
    let sum = 0;
    for (let i = 1; i < this.rttSamples.length; i++) {
      sum += Math.abs(this.rttSamples[i] - this.rttSamples[i - 1]);
    }
    const prevJitter = this.snap.jitter;
    this.snap.jitter = sum / (this.rttSamples.length - 1);
    // log significant flux changes (>15ms delta)
    if (Math.abs(this.snap.jitter - prevJitter) > 15) {
      const dir = this.snap.jitter > prevJitter ? 'spike' : 'drop';
      this.netLog('resonance-flux',
        `Flux ${dir}: ${prevJitter.toFixed(1)}→${this.snap.jitter.toFixed(1)}ms  |  ${this.snap.jitter > 30 ? '⚠ turbulent' : '✓ calm'}`);
    }
    // echo jitter: computed ONLY from same-beacon successive echo deltas
    this.computeEchoJitter();
  }

  /** Debounced connection-type change detection (5s stability window). */
  private detectTransitions(nowMs: number) {
    const con = (navigator as any).connection;
    const curType = con?.type || 'unknown';
    const curOnline = navigator.onLine;

    // 1. Online/offline detection (immediate for offline, 3s debounce for online)
    if (curOnline !== this.lastOnline) {
      if (!curOnline) {
        // Going offline — immediate
        this.lastOnline = false;
        this.snap.online = false;
        this.fireTransition(this.lastKnownType, 'offline');
      } else {
        // Coming back online — debounce 3s
        if (!this.pendingTransition) {
          this.pendingTransition = { from: 'offline', to: this.lastKnownType, since: nowMs };
        }
      }
    }

    // 2. Connection type detection (debounced 5s)
    if (curType !== this.lastKnownType) {
      // Special rules: ignore 'unknown' ↔ 'wifi' flapping
      if ((curType === 'unknown' && this.lastKnownType === 'wifi') ||
          (curType === 'wifi' && this.lastKnownType === 'unknown')) {
        // Keep lastKnownType, don't fire transition
        this.lastConnectionType = curType;
        return;
      }
      // 'none' = offline — immediate
      if (curType === 'none') {
        this.lastKnownType = 'none';
        this.lastOnline = false;
        this.snap.online = false;
        this.fireTransition(this.lastConnectionType, 'offline');
        this.lastConnectionType = curType;
        return;
      }

      if (!this.pendingTransition || this.pendingTransition.to !== curType) {
        this.pendingTransition = { from: this.lastKnownType, to: curType, since: nowMs };
      }
    } else if (this.pendingTransition && this.pendingTransition.to === curType) {
      // Type has been stable — check if debounce window has elapsed
      if (nowMs - this.pendingTransition.since >= 5000) {
        const from = this.pendingTransition.from;
        const to = this.pendingTransition.to;
        this.lastKnownType = to;
        this.lastConnectionType = to;
        this.fireTransition(from, to);
        this.pendingTransition = null;
      }
    } else if (this.pendingTransition) {
      // Type reverted — cancel pending transition
      this.pendingTransition = null;
    }

    // Reset online debounce if we've been back online for 3s
    if (curOnline && !this.lastOnline && this.pendingTransition?.from === 'offline') {
      if (nowMs - this.pendingTransition.since >= 3000) {
        this.lastOnline = true;
        this.snap.online = true;
        this.fireTransition('offline', this.lastKnownType);
        this.pendingTransition = null;
      }
    }
  }

  private fireTransition(from: string, to: string) {
    // N2: update biome via profile-based selection (D1)
    const oldBiome = this.currentBiome;
    this.currentBiome = this.selectBiome();
    this.snap.connectionType = this.lastKnownType;

    // Log the transition
    if (this.transitionLogCallback) {
      const msg = to === 'offline'
        ? 'The world grows still — you have crossed into the Hollow'
        : from === 'offline'
          ? `The world rekindles — you stand in ${this.currentBiome.name}`
          : `Realm Rift: ${oldBiome.name} → ${this.currentBiome.name}`;
      this.transitionLogCallback(msg);
    }

    // N2: fire rift event (with 30s cooldown)
    const now = performance.now();
    if (to !== 'offline' && from !== 'offline') {
      // Realm-to-realm rift
      if (now - this.lastRiftTime >= 30000) {
        this.lastRiftTime = now;
        this.riftStability = 100;
        if (this.riftCallback) this.riftCallback(oldBiome, this.currentBiome);
      } else {
        // Queue the rift
        this.queuedRift = to;
      }
    } else if (to === 'offline') {
      // Going offline — immediate (counts as a rift)
      this.lastRiftTime = now;
      this.riftStability = 100;
      this.snap.online = false;
      if (this.riftCallback) this.riftCallback(oldBiome, BIOMES[3] /* The Hollow */);
    } else if (from === 'offline') {
      // Coming back online — immediate rift
      this.lastRiftTime = now;
      this.riftStability = 100;
      this.snap.online = true;
      if (this.riftCallback) this.riftCallback(BIOMES[3] /* Loopback */, this.currentBiome);
    }

    // Legacy callback
    if (this.transitionCallback) {
      this.transitionCallback(from, to);
    }
  }

  /** N2: decay rift stability over time (5 minutes to 0%). */
  private decayStability(nowMs: number) {
    if (this.riftStability <= 0) return;
    // Decay: 100% → 0% over 5 minutes = 300,000 ms
    // Per-frame at ~60fps = 16ms → ~0.0053% per frame
    this.riftStability = Math.max(0, this.riftStability - (100 / 300000) * 16.67);

    // Process queued rift if cooldown elapsed
    if (this.queuedRift && performance.now() - this.lastRiftTime >= 30000) {
      const toType = this.queuedRift;
      this.queuedRift = null;
      const oldBiome = this.currentBiome;
      this.lastKnownType = toType;
      this.lastConnectionType = toType;
      this.snap.connectionType = toType;
      this.currentBiome = this.selectBiome();
      this.lastRiftTime = performance.now();
      this.riftStability = 100;
      if (this.riftCallback) this.riftCallback(oldBiome, this.currentBiome);
    }
  }

  // ---- identity probing (IP, ISP, geo, colo) ----

  /** Periodic refresh for IP info (ipify + Cloudflare trace) and geo (ipapi.co). */
  private pollIpInfo(nowMs: number) {
    // F8 design law: stays dark until the player's first explore action.
    if (!this.identityFetched || this.gate.off) return;
    if (nowMs - this.lastTraceMs > WIRE_BUDGET.traceIntervalSec * 1000) {
      this.lastTraceMs = nowMs;
      this.fetchCloudflareTrace();
    }
  }

  // ---- M3.5: Action-gated beacon echoes ----
  // Beacons are discovered through gameplay actions. Each action randomly
  // pings one beacon from its themed pool. Attack → war beacons.
  // Build → fortress beacons. Do everything → full map.

  /**
   * Called by game systems when the player performs an action. Randomly picks
   * a beacon from the action's themed pool and pings it. Cooldowns prevent
   * spam (one ping per action type every N seconds).
   *
   * SPECIAL CASE — attack: fires a volley of 3 pings drawn from ALL pools
   * (not just the attack pool), with NO cooldown. Every swing sends echoes.
   */
  /**
   * Game actions no longer emit packets. They bias which beacon the wall-clock
   * scheduler resolves next, and — for attack — CONSUME the freshest existing
   * measurement to arm a resonance crit. Swing rate is fully decoupled from
   * request rate.
   */
  probeAction(action: string) {
    this.actionBias = [action, ...this.actionBias.filter(a => a !== action)].slice(0, 3);
    if (action === 'attack') this.armResonance();
  }

  /** Arm a crit from the most recent fresh echo on a warmed route. */
  private armResonance() {
    const now = performance.now();
    if (now - this.lastAttackVolleyMs < 1500) return;
    this.lastAttackVolleyMs = now;
    if (this.pendingResonance) return;
    let best: BeaconEcho | null = null;
    for (const p of this.snap.endpointProbes) {
      if (p.rtt <= 0 || p.rtt >= 30) continue;
      if (!p.ts || now - p.ts > WIRE_BUDGET.freshMs) continue;
      if (!this.warmedRoutes.has(p.host)) continue;
      if (!best || p.rtt < best.rtt) best = p;
    }
    if (!best) return;
    this.pendingResonance = { rtt: best.rtt, label: best.label, multiplier: 1.5 };
    this.netLog('resonance', `⚡ Resonance: ${best.label} @ ${best.rtt}ms → crit ready!`);
  }

  /** Merge a single echo result into snap.endpointProbes, replacing any
   *  previous result for the same label. */
  /** Track an echo latency sample per beacon URL and recompute echoJitter. */
  private trackEchoSample(url: string, lat: number) {
    let samples = this.echoSamples.get(url);
    if (!samples) {
      samples = [];
      this.echoSamples.set(url, samples);
    }
    samples.push(lat);
    if (samples.length > 10) samples.shift(); // per-beacon ring buffer
  }

  /** Compute echoJitter from successive same-beacon echo deltas. */
  private computeEchoJitter() {
    let totalDelta = 0;
    let deltaCount = 0;
    for (const samples of this.echoSamples.values()) {
      if (samples.length < 2) continue;
      for (let i = 1; i < samples.length; i++) {
        totalDelta += Math.abs(samples[i] - samples[i - 1]);
        deltaCount++;
      }
    }
    if (deltaCount > 0) {
      this.snap.echoJitter = totalDelta / deltaCount;
    }
  }

  /** Merge a single echo result into snap.endpointProbes, replacing any
   *  previous result for the same label. Stamps ts for F4 recency checks. */
  private mergeProbeResult(result: BeaconEcho) {
    result.ts = performance.now();
    const probes = this.snap.endpointProbes;
    const idx = probes.findIndex(p => p.label === result.label);
    if (idx >= 0) {
      probes[idx] = result;
    } else {
      probes.push(result);
    }
    // Keep sorted by echo time ascending
    probes.sort((a, b) => (a.rtt < 0 ? Infinity : a.rtt) - (b.rtt < 0 ? Infinity : b.rtt));
  }

  /**
   * Get all unique beacons from all pools.
   */
  getAllEndpoints(): BeaconTarget[] {
    return allBeacons();
  }

  // ---- D5: Lightning Bands — per-swing seeded-rng damage roll ----

  /** Center value of the last damage roll. */
  lastSwingCenter = 1.0;
  /** Half-range of the last damage roll. */
  lastSwingHalf = 0.0;
  /** Best echo used for the last damage roll center (ms). */
  lastSwingBestEchoMs = 0;

  /**
   * Roll a per-swing damage multiplier using the seeded game rng.
   * "Lightning bands" — damage is rolled, not stepped. Wide and wild per D5.
   *
   * @param rng Seeded rng function returning [0,1). MUST be the game rng for determinism.
   * @param opts C1: non-swing damage sources (echoes) share the one damage law but
   *   pass `stash: false` so they never overwrite the pending swing's stashed roll,
   *   `label` for their Lens line, and `quiet: true` for high-frequency rolls
   *   (Cinder Trail patches) that would drown the feed.
   * @returns The damage multiplier and roll debug info.
   */
  rollDamageMul(rng: () => number, opts?: { label?: string; stash?: boolean; quiet?: boolean }): { mul: number; center: number; half: number; bestEchoMs: number } {
    const bestEchoMs = this.bestRecentEcho();
    const echoJit = this.snap.echoJitter;

    // Read clamps from the NET_GAME_MAP damage row (data-driven, live-tweakable)
    const dmgRow = this.gameMappings.find(m => m.target === 'damage');
    const dmgMin = dmgRow?.min ?? 0.30;
    const dmgMax = dmgRow?.max ?? 1.50;

    // center: fast route → high center. 1.45 − echoMs/250, clamp 0.55–1.30
    const center = Math.max(0.55, Math.min(1.30, 1.45 - (bestEchoMs > 0 ? bestEchoMs : this.snap.rtt) / 250));
    // half: calm ≈ ±0.17, stormy ≈ ±0.60
    const half = 0.15 + Math.max(0, Math.min(1, echoJit / 60)) * 0.45;
    // roll: center ± half, clamped to damage band from data row
    const roll = Math.max(dmgMin, Math.min(dmgMax, center + (rng() * 2 - 1) * half));

    if (opts?.stash !== false) {
      this.lastSwingRtt = bestEchoMs > 0 ? bestEchoMs : this.snap.rtt;
      this.lastSwingDmgMul = roll;
      this.lastSwingCenter = center;
      this.lastSwingHalf = half;
      this.lastSwingBestEchoMs = bestEchoMs;
    }

    // Lens feed: technical line for every roll (quiet suppresses high-frequency sources)
    if (!opts?.quiet) {
      this.netLog('resonance',
        `${opts?.label ?? 'swing'} roll ${roll.toFixed(2)}× ← echo ${bestEchoMs > 0 ? bestEchoMs.toFixed(0) : '—'} ms, center ${center.toFixed(2)} ± ${half.toFixed(2)}`);
    }

    return { mul: roll, center, half, bestEchoMs };
  }

  /** @deprecated — use rollDamageMul(rng) instead. Kept for compat. */
  getDamageMul(): number {
    // Fallback: use Math.random() if no rng provided (non-deterministic, test-only path)
    return this.rollDamageMul(() => Math.random()).mul;
  }

  /** Get the best (lowest positive) echo RTT from the last 10s of probes. */
  private bestRecentEcho(): number {
    let best = Infinity;
    const now = performance.now();
    for (const probe of this.snap.endpointProbes) {
      if (probe.rtt <= 0) continue;
      const age = (probe as any).ts ? now - (probe as any).ts : 0;
      if (age <= 10000 && probe.rtt < best) best = probe.rtt;
    }
    return best === Infinity ? 0 : best;
  }

  /**
   * Consume a pending resonance crit from a fast echo.
   * Returns null if no resonance is pending. Called by combat.resolveHit().
   */
  consumeResonance(): { rtt: number; label: string; multiplier: number } | null {
    const r = this.pendingResonance;
    this.pendingResonance = null;
    if (r) this.lastResonanceLabel = r.label;
    return r;
  }

  /** @deprecated — use getDamageMul() instead. Kept for compat. */
  getAttackSpeedMul(): number { return 1.0; }

  /**
   * Sample passive browser APIs for a non-attack action. ZERO fetch() calls —
   * only reads already-available browser metrics. Called alongside probeAction()
   * by game systems.
   */
  samplePassive(action: string) {
    const con = (navigator as any).connection;
    switch (action) {
      case 'gather': {
        if (con?.downlink != null) {
          this.lastGatherBw = this.safeNum(con.downlink, this.snap.downlink, 0.1, 1000);
        } else {
          this.lastGatherBw = this.snap.downlink;
        }
        this.netLog('resonance', `Gather flow snapshot: ${this.lastGatherBw.toFixed(1)} Mbps`);
        break;
      }
      case 'build': {
        const nav = performance.getEntriesByType('navigation')[0] as any;
        if (nav) {
          if (nav.domainLookupStart != null && nav.domainLookupEnd != null)
            this.lastBuildDns = nav.domainLookupEnd - nav.domainLookupStart;
          else this.lastBuildDns = this.snap.pageDnsTime;
          if (nav.connectStart != null && nav.connectEnd != null)
            this.lastBuildTcp = nav.connectEnd - nav.connectStart;
          this.lastBuildTls = (nav.connectEnd != null && nav.secureConnectionStart != null)
            ? nav.connectEnd - nav.secureConnectionStart : this.snap.pageTlsTime;
        }
        this.netLog('resonance',
          `Build timing: DNS ${this.lastBuildDns.toFixed(1)}ms · TCP ${this.lastBuildTcp.toFixed(1)}ms · TLS ${this.lastBuildTls.toFixed(1)}ms`);
        break;
      }
      case 'craft': {
        this.lastCraftJitter = this.snap.jitter;
        this.netLog('resonance', `Craft flux snapshot: ${this.lastCraftJitter.toFixed(1)}ms`);
        break;
      }
      case 'damage': {
        this.lastDamageTier = con?.effectiveType || this.snap.effectiveType;
        this.netLog('resonance', `Damage link snapshot: ${this.lastDamageTier}`);
        break;
      }
      case 'explore': {
        this.buildTraceChain();
        this.netLog('resonance', `Explore: refreshed resonance chain (${this.snap.traceChain.length} hops)`);
        // F8: first explore action triggers identity probes — "scrying reveals who you are"
        if (!this.identityFetched) {
          this.identityFetched = true;
          this.lastTraceMs = performance.now();
          this.fetchCloudflareTrace().then(() => this.resolvePtr());
          this.netLog('resonance', 'Scrying: probing connection identity...');
        }
        break;
      }
      case 'survive_night': {
        this.nightRttDrift = this.snap.rtt - this.duskRtt;
        const dir = this.nightRttDrift > 0 ? 'lengthened' : 'shortened';
        this.netLog('resonance',
          `Night pulse drift: ${this.nightRttDrift > 0 ? '+' : ''}${this.nightRttDrift.toFixed(0)}ms ${dir}`);
        break;
      }
    }
  }

  /** Snapshot the current pulse as the dusk baseline.
   *  Also begins collecting RTT samples for the night-stability tracker. */
  snapshotDuskRtt() {
    this.duskRtt = this.snap.rtt;
    this.nightRttSamples = []; // start fresh for the night ahead
    this.netLog('resonance', `Dusk pulse baseline: ${this.duskRtt.toFixed(0)}ms`);
  }

  /** Called every frame during the night to collect RTT samples. */
  sampleNightRtt() {
    if (this.nightRttSamples.length < 600) { // cap at ~10 min of 1Hz samples
      this.nightRttSamples.push(this.snap.rtt);
    }
  }

  /** Compute night-RTT stability at dawn.
   *  Stability = % of samples where RTT stayed within ±25% of median.
   *  Stores result in snap._nightRttStability for resolvePerSurviveNight mapping. */
  computeNightRttStability(): number {
    const samples = this.nightRttSamples;
    if (samples.length < 4) {
      this.snap._nightRttStability = 100; // not enough data = assume stable
      return 100;
    }
    // sort and find median
    const sorted = [...samples].sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    const median = sorted.length % 2 === 1
      ? sorted[mid]
      : (sorted[mid - 1] + sorted[mid]) / 2;
    if (median <= 0) {
      this.snap._nightRttStability = 100;
      return 100;
    }
    // count samples within ±25% of median
    const band = median * 0.25;
    const stable = samples.filter(s => Math.abs(s - median) <= band).length;
    const pct = Math.round((stable / samples.length) * 100);
    this.snap._nightRttStability = pct;
    this.netLog('resonance',
      `Night pulse stability: ${pct}% (${stable}/${samples.length} in ${median.toFixed(0)}±${band.toFixed(0)}ms band)`);
    return pct;
  }

  // ---- M3.5: passive identity probes (IP, ISP, geo, colo) ----
  // These are NOT gated behind actions — they identify the player's connection
  // and always load on init. Only the endpoint latency probes are action-gated.

  /**
   * Cloudflare's own diagnostic endpoint — the single identity source now that
   * ipify (redundant) and ipapi.co (1000/day trial, already 429'd us) are gone.
   * Yields ip, colo, country, warp, HTTP version, TLS version and key exchange.
   */
  private async fetchCloudflareTrace() {
    if (this.ipFetching || this.gate.off) return;
    if (!this.gate.take('cloudflare.com', 60)) return;
    this.ipFetching = true;
    const ctl = new AbortController();
    const tm = setTimeout(() => ctl.abort(), 5000);
    const t0 = performance.now();
    try {
      const resp = await fetch('https://cloudflare.com/cdn-cgi/trace', { signal: ctl.signal, cache: 'no-store' });
      if (!resp.ok) { this.gate.penalise('cloudflare.com', resp); return; }
      const text = await resp.text();
      const p: Record<string, string> = {};
      for (const line of text.split('\n')) {
        const eq = line.indexOf('=');
        if (eq > 0) p[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
      }
      if (p['ip']) this.snap.publicIp = p['ip'];
      if (p['colo']) this.snap.colo = p['colo'];
      if (p['warp']) this.snap.warp = p['warp'] === 'on';
      if (p['loc']) this.snap.country = p['loc'];
      if (p['tls']) this.tlsVersion = p['tls'];
      if (p['kex']) this.kex = p['kex'];
      if (p['http']) this.httpProto = p['http'];
      if (p['ts']) {
        const server = Number(p['ts']) * 1000;
        if (Number.isFinite(server)) this.clockSkewMs = Date.now() - (server + (performance.now() - t0) / 2);
      }
      this.buildTraceChain();
      this.netLog('net-ep',
        `Cloudflare: ${this.snap.publicIp} · colo ${this.snap.colo} · ${this.snap.country} · ${this.tlsVersion} ${this.kex} · ${this.httpProto} · WARP ${this.snap.warp ? 'on' : 'off'}`);
    } catch {
      this.gate.penalise('cloudflare.com', null);
    } finally {
      clearTimeout(tm);
      this.gate.release();
      this.ipFetching = false;
    }
  }

  /** Reverse-DNS our own public IP. Real ISP naming, no geo-IP vendor needed. */
  private async resolvePtr() {
    const ip = this.snap.publicIp;
    if (!ip || ip === '...' || ip.includes(':')) return;
    const parts = ip.split('.');
    if (parts.length !== 4) return;
    const r = await this.resolveHost(`${parts.reverse().join('.')}.in-addr.arpa`, 'PTR');
    if (r && r.ms >= 0 && r.ip) {
      this.snap.isp = r.ip.replace(/\.$/, '');
      this.netLog('net-ep', `Reverse DNS: ${ip} → ${this.snap.isp}`);
    }
  }

  /** Snapshot of outbound request accounting — the Lens shows this verbatim. */
  wireStats() {
    return {
      granted: this.gate.granted,
      denied: this.gate.denied,
      off: this.gate.off,
      resolvers: [...this.resolverStats.entries()].map(([label, s]) => ({
        label, n: s.n, avg: s.total / Math.max(1, s.n), best: s.best === Infinity ? 0 : s.best,
      })),
    };
  }

  /**
   * Build a pseudo-traceroute chain from Performance API timings + Cloudflare trace.
   * While true ICMP traceroute is impossible in browser JS, we can reconstruct the
   * connection path: Browser → DNS Resolver → TCP Handshake → TLS Negotiation →
   * CDN Edge (Cloudflare colo) → Origin Server (TTFB).
   */
  private buildTraceChain() {
    const nav = performance.getEntriesByType('navigation')[0] as any;
    const chain: TraceHop[] = [];

    // Hop 1: DNS lookup
    if (nav?.domainLookupStart != null && nav?.domainLookupEnd != null) {
      const dnsMs = nav.domainLookupEnd - nav.domainLookupStart;
      chain.push({
        label: 'DNS Resolver',
        latency: dnsMs > 0 ? dnsMs : (this.snap.pageDnsTime || 0),
        detail: dnsMs > 0 ? `${dnsMs.toFixed(1)}ms` : 'cached',
      });
    }

    // Hop 2: TCP connect (SYN → SYN-ACK → ACK)
    if (nav?.connectStart != null && nav?.connectEnd != null) {
      const tcpMs = nav.connectEnd - nav.connectStart;
      chain.push({
        label: 'TCP Handshake',
        latency: tcpMs > 0 ? tcpMs : 0,
        detail: tcpMs > 0 ? `${tcpMs.toFixed(1)}ms` : 'reused',
      });
    }

    // Hop 3: TLS handshake
    if (nav?.secureConnectionStart != null && nav?.connectEnd != null) {
      const tlsMs = nav.connectEnd - nav.secureConnectionStart;
      chain.push({
        label: 'TLS Negotiation',
        latency: tlsMs > 0 ? tlsMs : (this.snap.pageTlsTime || 0),
        detail: tlsMs > 0 ? `${tlsMs.toFixed(1)}ms` : 'session-resume',
      });
    }

    // Hop 4: CDN Edge (Cloudflare colo)
    const coloLabel = this.snap.colo && this.snap.colo !== '...'
      ? `CDN Edge (${this.snap.colo})` : 'CDN Edge';
    chain.push({
      label: coloLabel,
      latency: this.snap.endpointLatency > 0 ? this.snap.endpointLatency : 0,
      detail: this.snap.colo && this.snap.colo !== '...'
        ? `${this.snap.endpointLatency.toFixed(0)}ms RTT · colo ${this.snap.colo}`
        : `${this.snap.endpointLatency.toFixed(0)}ms RTT`,
    });

    // Hop 5: TTFB (time to first byte from origin behind CDN)
    chain.push({
      label: 'Origin (TTFB)',
      latency: this.snap.pageTtfb > 0 ? this.snap.pageTtfb : 0,
      detail: `${this.snap.pageTtfb.toFixed(0)}ms to first byte`,
    });

    this.snap.traceChain = chain;
  }

  private buildMappingIndex() {
    for (const m of NET_METRICS) {
      this.mappings[m.key] = m;
    }
  }
}
