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
} from '../data/network';
import { biomeForConnection, biomeForProfile, BIOMES, type BiomeDef } from '../data/biomes';

export class NetworkSystem {
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
  private lastEndpointMs = 0;
  private lastConnectionType = '';
  private lastOnline = true;
  private endpointFetching = false; // guard against overlapping fetches

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
  private lastIpFetchMs = 0;
  private ipFetching = false;
  private lastGeoFetchMs = 0;
  private geoFetching = false;
  /** Whether identity probes (IP/geo) have been fetched at least once. */
  private identityFetched = false;

  // ---- Action-gated beacon discovery ----
  /** Set of endpoint labels that have been discovered through gameplay. */
  discoveredEndpoints: Set<string> = new Set();
  /** Per-action-type cooldown timestamps (ms). */
  private actionCooldowns: Map<string, number> = new Map();
  /** Per-action-type last probed label (avoid same endpoint twice in a row). */
  private lastProbedLabel: Map<string, string> = new Map();
  /** Guard against probing the same URL concurrently. */
  private activeProbes: Set<string> = new Set();

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
  /** DNS/TCP/TLS timing from last build action. */
  lastBuildDns: number = 0;
  lastBuildTcp: number = 0;
  lastBuildTls: number = 0;

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
    const endpoints = new Set<string>();
    for (const pool of Object.values(ACTION_ECHO_POOLS)) {
      for (const ep of pool) endpoints.add(ep.url);
    }
    // Also the identity endpoints
    endpoints.add('https://api.ipify.org');
    endpoints.add('https://ipapi.co/json/');
    endpoints.add('https://cloudflare.com/cdn-cgi/trace');
    // Also the hardcoded poll endpoints
    endpoints.add('https://www.google.com/generate_204');
    endpoints.add('https://www.microsoft.com/favicon.ico');

    const list = [...endpoints].sort().join(', ');
    console.log('[NIGHTWARD] External endpoints this game may contact (discovery gated behind in-game actions): '
      + list + '. No data leaves the browser except the implicit IP in HTTP requests to these listed public endpoints; nothing is stored server-side.');
  }

  // ---- public API ----

  /** Called once per frame (render, not sim) — polls slow metrics on their interval. */
  update(nowMs: number) {
    this.pollConnection(nowMs);
    this.pollEndpoint(nowMs);
    this.computeJitter();
    this.snap.timeOfDay = this.realTimeOfDay();
    this.detectTransitions(nowMs);
    // N2: decay rift stability over time
    this.decayStability(nowMs);
    // M3.5: periodically refresh deep network data (IP/geo every 5 min)
    // NOTE: endpoint probes are NO LONGER auto-polled here — they are gated
    // behind in-game actions via probeAction().
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
      const val = gm.transform(raw);
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

  /** Fire-and-forget beacon ping. Non-blocking — update() does NOT await. */
  private pollEndpoint(nowMs: number) {
    if (nowMs - this.lastEndpointMs < 10000) return;
    this.lastEndpointMs = nowMs;
    if (this.endpointFetching) return;
    this.endpointFetching = true;
    const t0 = performance.now();
    const endpoints = [
      'https://cloudflare.com/cdn-cgi/trace',
      'https://www.google.com/generate_204',
      'https://www.microsoft.com/favicon.ico',
    ];
    this.netLog('resonance-echo', `probing ${new URL(endpoints[0]).hostname}...`);
    this.tryEndpoints(endpoints, 0, t0);
  }

  private tryEndpoints(endpoints: string[], idx: number, t0: number) {
    if (idx >= endpoints.length) {
      this.netLog('resonance-echo', `All beacons unreachable — using fallback`);
      this.endpointFetching = false;
      return;
    }
    const url = endpoints[idx];
    const host = new URL(url).hostname;
    fetch(url, { mode: 'no-cors', cache: 'no-store' })
      .then(() => {
        const lat = performance.now() - t0;
        this.snap.endpointLatency = lat;
        this.trackEchoSample(url, lat);
        this.netLog('resonance-echo',
          `${host} echoed in ${lat.toFixed(0)}ms`);
        this.endpointFetching = false;
      })
      .catch(() => {
        this.netLog('resonance-echo', `${host} unreachable — trying next beacon...`);
        this.tryEndpoints(endpoints, idx + 1, t0);
      });
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
    // Refresh IP + Cloudflare trace every 5 minutes
    if (nowMs - this.lastIpFetchMs > 300_000) {
      this.fetchIpInfo();
    }
    // Refresh geo info every 5 minutes
    if (nowMs - this.lastGeoFetchMs > 300_000) {
      this.fetchGeoInfo();
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
  probeAction(action: string) {
    // Attack: one echo per swing (always), full volley at most once per 1.5s (F3)
    if (action === 'attack') {
      const now = performance.now();
      // Always fire a single echo to a random attack-pool beacon
      const pool = ACTION_ECHO_POOLS['attack'];
      if (pool && pool.length > 0) {
        const lastLabel = this.lastProbedLabel.get('attack');
        const candidates = pool.filter(p => p.label !== lastLabel);
        const ep = candidates.length > 0
          ? candidates[(Math.random() * candidates.length) | 0]
          : pool[(Math.random() * pool.length) | 0];
        this.lastProbedLabel.set('attack', ep.label);
        this.probeSingleEndpoint(ep.url, ep.label, ep.detail, ep.region, ep.countryCode, 'attack');
      }
      // Full volley (3 echoes from all pools) only every 1.5s
      if (now - this.lastAttackVolleyMs >= 1500) {
        this.lastAttackVolleyMs = now;
        this.probeAttackVolley(3);
      }
      return;
    }

    const pool = ACTION_ECHO_POOLS[action];
    if (!pool || pool.length === 0) return;

    // Check cooldown
    const cooldownMs = (ACTION_COOLDOWNS[action] ?? 20) * 1000;
    const now = performance.now();
    const lastProbe = this.actionCooldowns.get(action) ?? 0;
    if (now - lastProbe < cooldownMs) return;

    // Mark the cooldown
    this.actionCooldowns.set(action, now);

    // Pick a random beacon from the pool (avoid the same one twice in a row if pool > 1)
    let ep: BeaconTarget;
    if (pool.length === 1) {
      ep = pool[0];
    } else {
      const lastLabel = this.lastProbedLabel.get(action);
      const candidates = pool.filter(p => p.label !== lastLabel);
      ep = candidates.length > 0
        ? candidates[(Math.random() * candidates.length) | 0]
        : pool[(Math.random() * pool.length) | 0];
      this.lastProbedLabel.set(action, ep.label);
    }

    // Fire the echo
    this.probeSingleEndpoint(ep.url, ep.label, ep.detail, ep.region, ep.countryCode, action);
  }

  /**
   * Fire N echoes to random beacons drawn from ALL pools. Used by the attack
   * action — every swing sends echoes, picking random global beacons.
   * Fast echoes (<30ms) trigger resonance crits.
   */
  private probeAttackVolley(count: number) {
    const all = allBeacons();
    if (all.length === 0) return;
    // Shuffle and pick `count` unique beacons
    const picked: BeaconTarget[] = [];
    const pool = [...all];
    for (let i = 0; i < count && pool.length > 0; i++) {
      const idx = (Math.random() * pool.length) | 0;
      picked.push(pool[idx]);
      pool.splice(idx, 1);
    }
    for (const ep of picked) {
      this.probeSingleEndpoint(ep.url, ep.label, ep.detail, ep.region, ep.countryCode, 'attack');
    }
  }

  /**
   * Ping a single beacon. Results are merged into snap.endpointProbes,
   * replacing any previous result for the same label. The beacon is marked
   * as "discovered".
   *
   * When action is 'attack' and echo < 30ms, sets pendingResonance
   * for the combat system to consume as a resonance crit on the current swing.
   */
  private probeSingleEndpoint(url: string, label: string, detail: string, region: string, countryCode: string, action?: string) {
    // Don't ping the same URL concurrently
    if (this.activeProbes.has(url)) return;
    this.activeProbes.add(url);
    this.netLog('resonance-echo', `Echo: ${label} (${detail}) ...`);

    const t0 = performance.now();
    fetch(url, { mode: 'no-cors', cache: 'no-store' })
      .then(() => {
        const rtt = Math.round(performance.now() - t0);
        this.mergeProbeResult({ host: url, label, rtt, detail, region, countryCode });
        this.discoveredEndpoints.add(label);
        this.activeProbes.delete(url);
        this.trackEchoSample(url, rtt); // F1: per-beacon echo tracking for echoJitter

        // F3: route warmth — first contact is "discovery" (never crits),
        // second+ contact warms the route (crit-eligible)
        const wasWarm = this.warmedRoutes.has(url);
        if (!wasWarm) {
          this.warmedRoutes.add(url);
          this.netLog('resonance-echo', `${label}: ${rtt}ms (${region}) — route discovered`);
        } else {
          this.netLog('resonance-echo', `${label}: ${rtt}ms (${region})`);
        }

        // fast echo → resonance crit ONLY from warmed routes (F3)
        if (action === 'attack' && rtt > 0 && rtt < 30 && wasWarm) {
          this.pendingResonance = { rtt, label, multiplier: 1.5 };
          this.netLog('resonance',
            `⚡ Resonance: ${label} @ ${rtt}ms → crit ready!`);
        }
      })
      .catch(() => {
        this.mergeProbeResult({ host: url, label, rtt: -1, detail: 'unreachable', region, countryCode });
        this.discoveredEndpoints.add(label);
        this.activeProbes.delete(url);
        this.netLog('resonance-echo', `${label}: unreachable`);
      });

    // Safety timeout: if the fetch hangs >10s, release the guard
    setTimeout(() => {
      if (this.activeProbes.has(url)) {
        this.mergeProbeResult({ host: url, label, rtt: -1, detail: 'timeout', region, countryCode });
        this.discoveredEndpoints.add(label);
        this.activeProbes.delete(url);
      }
    }, 10000);
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

  // ---- M3.6v2: Sync Pulse → Damage + Resonance Crits ----

  /**
   * Get the damage multiplier. Drives from best recent beacon-echo latency
   * (continuous, not quantized) when available; falls back to connection.rtt
   * with 25ms-grid-aligned tier edges (F4).
   *   ≤20ms  → 1.4×  (resonant clarity)
   *   20-40ms → 1.2× (sharp edge)
   *   40-80ms → 1.05× (slightly keen)
   *   80-200ms→ 1.0×  (steady)
   *   200-400ms→0.85× (dulled by distance)
   *   >400ms → 0.7×  (heavy interference)
   */
  getDamageMul(): number {
    // 1. Try best recent beacon echo (continuous latency)
    const bestEcho = this.bestRecentEcho();
    if (bestEcho > 0) {
      this.lastSwingRtt = bestEcho;
      return this.lastSwingDmgMul = this.rttToDamageMul(bestEcho);
    }

    // 2. Fall back to connection.rtt (quantized to 25ms buckets)
    const con = (navigator as any).connection;
    const rtt = con?.rtt != null ? this.safeNum(con.rtt, this.snap.rtt, 1, 5000) : this.snap.rtt;
    this.lastSwingRtt = rtt;
    return this.lastSwingDmgMul = this.rttToDamageMul(rtt);
  }

  /** Map an RTT value to a damage multiplier. */
  private rttToDamageMul(rtt: number): number {
    if (rtt <= 20) return 1.4;
    if (rtt <= 40) return 1.2;
    if (rtt <= 80) return 1.05;
    if (rtt <= 200) return 1.0;
    if (rtt <= 400) return 0.85;
    return 0.7;
  }

  /** Get the best (lowest positive) echo RTT from the last 10s of probes. */
  private bestRecentEcho(): number {
    let best = Infinity;
    const now = performance.now();
    for (const probe of this.snap.endpointProbes) {
      // Only consider probes with valid RTT and within ~10s
      if (probe.rtt <= 0) continue;
      // Use the probe's timestamp if available, otherwise treat all as recent
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
          this.fetchIpInfo();
          this.fetchGeoInfo();
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

  /** Snapshot the current pulse as the dusk baseline. */
  snapshotDuskRtt() {
    this.duskRtt = this.snap.rtt;
    this.netLog('resonance', `Dusk pulse baseline: ${this.duskRtt.toFixed(0)}ms`);
  }

  // ---- M3.5: passive identity probes (IP, ISP, geo, colo) ----
  // These are NOT gated behind actions — they identify the player's connection
  // and always load on init. Only the endpoint latency probes are action-gated.

  /**
   * Fetch your public IP via ipify.org (proven CORS-enabled, always works).
   * Then try Cloudflare trace for colo/warp supplemental data.
   */
  private async fetchIpInfo() {
    if (this.ipFetching) return;
    this.ipFetching = true;
    this.lastIpFetchMs = performance.now();
    try {
      const resp = await fetch('https://api.ipify.org?format=json', { cache: 'no-store' });
      if (resp.ok) {
        const data = await resp.json();
        if (data['ip']) this.snap.publicIp = data['ip'];
      }
    } catch {
      // Silently fall back
    }
    this.ipFetching = false;
    // After getting IP, try Cloudflare trace for colo/warp (may fail on localhost)
    this.fetchCloudflareTrace();
  }

  /**
   * Try Cloudflare's /cdn-cgi/trace for colo, warp status, and HTTP version.
   * This endpoint is CORS-enabled in production but may fail on localhost.
   * Failure is silent — colo/warp stay as '...' / false.
   */
  private async fetchCloudflareTrace() {
    try {
      const resp = await fetch('https://cloudflare.com/cdn-cgi/trace', { cache: 'no-store' });
      if (!resp.ok) return;
      const text = await resp.text();
      const parsed: Record<string, string> = {};
      for (const line of text.split('\n')) {
        const eq = line.indexOf('=');
        if (eq > 0) parsed[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
      }
      if (parsed['colo']) this.snap.colo = parsed['colo'];
      if (parsed['warp']) this.snap.warp = parsed['warp'] === 'on';
      if (parsed['loc'] && this.snap.country === '..') this.snap.country = parsed['loc'];
      // Build connection chain now that we have colo info
      this.buildTraceChain();
      this.netLog('net-ep', `Cloudflare: colo ${this.snap.colo} · WARP ${this.snap.warp ? 'on' : 'off'}`);
    } catch {
      // Cloudflare trace not available (e.g. localhost) — colo stays as '...'
    }
  }

  /**
   * Fetch geo-IP info from ipapi.co (free tier, no key needed for non-commercial).
   * Returns JSON: { ip, city, country_code, org, asn, ... }
   * Fully CORS-enabled.
   */
  private async fetchGeoInfo() {
    if (this.geoFetching) return;
    this.geoFetching = true;
    this.lastGeoFetchMs = performance.now();
    try {
      const resp = await fetch('https://ipapi.co/json/', { cache: 'no-store' });
      if (!resp.ok) { this.geoFetching = false; return; }
      const data = await resp.json();
      if (data['ip'] && this.snap.publicIp === '...') this.snap.publicIp = data['ip'];
      if (data['org'])          this.snap.isp = data['org'];
      if (data['city'])         this.snap.city = data['city'];
      if (data['country_code']) this.snap.country = data['country_code'];
      if (data['asn'])          this.snap.asn = data['asn'];
      this.netLog('net-ep', `Geo-IP: ${this.snap.city}, ${this.snap.country} · ${this.snap.isp} · ${this.snap.asn}`);
    } catch {
      // Silently fall back
    }
    this.geoFetching = false;
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
