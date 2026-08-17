// ============================================================================
// Resonance → Game mappings (data rows). Every soul-resonance metric and game
// effect is a data row here — never engine code. Adding a new mapping is
// adding a row, same as adding a material or item.
// ============================================================================

/** One resonance→game mapping. */
export interface NetMapping {
  key: string;
  label: string;
  compute: (s: NetworkSnapshot) => number;
  fallback: number;
  unit: string;
  intervalMs: number;
  /** Inspect metadata for the Lens hover detail box. */
  inspect?: NetInspect;
}

/** Inspect metadata — shown in the Lens hover detail box (SOURCE / ACTION / FLOWS INTO). */
export interface NetInspect {
  /** The browser API and how it's implemented. */
  api: string;
  /** The game action that drives it (or 'always active' / 'boot page load'). */
  action: string;
  /** Which game values consume it. */
  flowsInto: string;
}

/** A single step in the resonance chain. */
export interface TraceHop {
  label: string;
  latency: number;
  detail?: string;
}

/** A single beacon echo result — now a DoH resolution, not a fetch. */
export interface BeaconEcho {
  host: string;
  label: string;
  /** Resolution time (ms). -1 = failed. */
  rtt: number;
  detail?: string;
  region: string;
  countryCode: string;
  /** Timestamp when this echo was recorded (performance.now() ms). */
  ts?: number;
  /** Resolved address — the real one, not a hardcoded string. */
  ip?: string;
  /** Record TTL as returned. Near-max implies an authoritative walk. */
  ttl?: number;
  /** Which resolver answered. */
  resolver?: string;
  /** DNSSEC-authenticated answer. */
  ad?: boolean;
}

// Backwards-compat alias
export type EndpointProbe = BeaconEcho;

// ---- M3.5: Action-gated beacon discovery ----
// Beacons are discovered through gameplay. Each action category (attack,
// gather, build, etc.) randomly pings one beacon from its themed pool.

/** A single beacon target — reusable across action pools. */
export interface BeaconTarget {
  /** Hostname to RESOLVE via DoH. The game never fetches these hosts. */
  host: string;
  label: string;
  detail: string;
  region: string;
  countryCode: string;
  /** Hint shown while this beacon is undiscovered. */
  discoveryHint: string;
  /** Inspect metadata for the Lens hover detail box. */
  inspect?: NetInspect;
}

// Backwards-compat alias
export type EndpointTarget = BeaconTarget;

/** DoH resolvers. Both are documented public services that exist to answer
 *  unsolicited queries; both send Access-Control-Allow-Origin: *. */
export const DOH_RESOLVERS: { id: string; label: string; url: string; accept?: string }[] = [
  { id: 'cf', label: '1.1.1.1', url: 'https://cloudflare-dns.com/dns-query', accept: 'application/dns-json' },
  { id: 'gg', label: '8.8.8.8', url: 'https://dns.google/resolve' },
];

/** Wall-clock cadence for the beacon scheduler. Beacon traffic is governed by
 *  real time, never by action frequency — a swing can no longer emit a packet. */
export const WIRE_BUDGET = {
  /** Seconds between scheduled DoH resolutions. */
  beaconIntervalSec: 6,
  /** Jitter fraction applied to the interval so probes never phase-lock. */
  beaconJitter: 0.4,
  /** Seconds between same-origin baseline probes. */
  baselineIntervalSec: 20,
  /** Seconds between Cloudflare trace refreshes (identity + TLS/colo). */
  traceIntervalSec: 300,
  /** Token bucket: sustained requests per minute across ALL outbound paths. */
  ratePerMin: 20,
  /** Token bucket depth. */
  burst: 6,
  /** Max concurrent outbound requests. */
  maxInflight: 2,
  /** Per-host minimum spacing (seconds). */
  hostSpacingSec: 30,
  /** Echo is "fresh" for resonance purposes within this window (ms). */
  freshMs: 12000,
};

/** Passive-sample cooldowns (seconds). These gate zero-request browser reads
 *  and the scheduler's action bias — not network traffic. */
export const ACTION_COOLDOWNS: Record<string, number> = {
  attack: 2,
  gather: 20,
  build: 20,
  craft: 25,
  damage: 25,
  economy: 30,
  explore: 60,
  survive_night: 120,
};

/**
 * Action echo pools. Each game action picks a RANDOM beacon from its pool.
 * Beacons appear in multiple pools — playing any aspect of the game reveals
 * more of the map. Attack → war beacons. Build → fortress beacons.
 * Do everything → full map.
 */
export const ACTION_ECHO_POOLS: Record<string, BeaconTarget[]> = {
  // ---- ⚔ Attack ----
  attack: [
    { host: 'www.yandex.ru',     label: 'Yandex',        detail: 'Moscow, RU',       region: 'Europe',        countryCode: 'RU', discoveryHint: 'A distant sentinel in the frozen east — your strikes echo across the tundra' },
    { host: 'www.naver.com',      label: 'Naver',         detail: 'Seoul, KR',        region: 'Asia-Pacific',  countryCode: 'KR', discoveryHint: 'A watchtower on the eastern peninsula — blades sing through mountain passes' },
    { host: 'www.baidu.com',      label: 'Baidu',         detail: 'Beijing, CN',      region: 'Asia-Pacific',  countryCode: 'CN', discoveryHint: 'The great fortress of the east — your war-cry reaches the Jade Palace' },
    { host: 'www.yahoo.co.jp',    label: 'Yahoo JP',      detail: 'Tokyo, JP',        region: 'Asia-Pacific',  countryCode: 'JP', discoveryHint: 'An island shrine across the eastern sea — battle-hymns on the wind' },
    { host: 'cloudflare.com',   label: 'Cloudflare',    detail: 'anycast CDN',      region: 'Global Anycast', countryCode: '',  discoveryHint: 'A shimmering ward that spans the globe — your blade resonates through its weave' },
    { host: 'www.microsoft.com',  label: 'Microsoft',     detail: 'Redmond, US',      region: 'Americas',      countryCode: 'US', discoveryHint: 'A grand citadel in the western forests — combat-hymns route through its halls' },
  ],

  // ---- 🪓 Gather ----
  gather: [
    { host: 'www.bbc.co.uk',      label: 'BBC',           detail: 'London, GB',       region: 'Europe',        countryCode: 'GB', discoveryHint: 'An ancient archive in the old world — timber routes through misty isles' },
    { host: 'www.baidu.com',      label: 'Baidu',         detail: 'Beijing, CN',      region: 'Asia-Pacific',  countryCode: 'CN', discoveryHint: 'Quarries beneath the eastern mountains — stone sings with ancient power' },
    { host: 'timesofindia.indiatimes.com', label: 'Times of India', detail: 'Mumbai, IN', region: 'Asia-Pacific',  countryCode: 'IN', discoveryHint: 'A silk-loom across the subcontinent — threads of gold and spice' },
    { host: 'www.abc.net.au',     label: 'ABC Australia',  detail: 'Sydney, AU',       region: 'Asia-Pacific',  countryCode: 'AU', discoveryHint: 'A sun-scorched beacon in the far south — raw bounty from the red earth' },
    { host: 'www.news24.com',     label: 'News24',        detail: 'Cape Town, ZA',    region: 'Africa',        countryCode: 'ZA', discoveryHint: 'A watchfire at the southern tip — riches from beneath the Table Mountain' },
    { host: 'www.lemonde.fr',     label: 'Le Monde',      detail: 'Paris, FR',        region: 'Europe',        countryCode: 'FR', discoveryHint: 'A gallery of light in the heart of the continent — harvests blessed by old gods' },
  ],

  // ---- 🏗 Build ----
  build: [
    { host: 'www.microsoft.com',  label: 'Microsoft',     detail: 'Redmond, US',      region: 'Americas',      countryCode: 'US', discoveryHint: 'A grand citadel in the western forests — your walls draw strength from its foundations' },
    { host: 'www.google.com',    label: 'Google',        detail: 'anycast 204',      region: 'Global Anycast', countryCode: '',  discoveryHint: 'A world-lens that sees all — your fortress rests on ancient keystones' },
    { host: 'cloudflare.com',   label: 'Cloudflare',    detail: 'anycast CDN',      region: 'Global Anycast', countryCode: '',  discoveryHint: 'A shimmering ward — your battlements are etched into its weave' },
    { host: 'www.elmundo.es',     label: 'El Mundo',      detail: 'Madrid, ES',       region: 'Europe',        countryCode: 'ES', discoveryHint: 'A sun-baked fortress in Iberia — fortification songs through the sierra' },
    { host: 'www.uol.com.br',     label: 'UOL',           detail: 'São Paulo, BR',    region: 'Americas',      countryCode: 'BR', discoveryHint: 'A green beacon in the southern jungles — your walls echo through the canopy' },
  ],

  // ---- ⚒ Craft ----
  craft: [
    { host: 'www.lemonde.fr',     label: 'Le Monde',      detail: 'Paris, FR',        region: 'Europe',        countryCode: 'FR', discoveryHint: 'A gallery of light — artisan souls resonate through its halls' },
    { host: 'www.bbc.co.uk',      label: 'BBC',           detail: 'London, GB',       region: 'Europe',        countryCode: 'GB', discoveryHint: 'An ancient archive — old-world craftsmanship echoes within' },
    { host: 'www.elmundo.es',     label: 'El Mundo',      detail: 'Madrid, ES',       region: 'Europe',        countryCode: 'ES', discoveryHint: 'A Mediterranean forge — steel tempered by sea winds' },
    { host: 'www.naver.com',      label: 'Naver',         detail: 'Seoul, KR',        region: 'Asia-Pacific',  countryCode: 'KR', discoveryHint: 'A precision forge on the peninsula — blades folded a thousand times' },
  ],

  // ---- 💥 Damage ----
  damage: [
    { host: 'cloudflare.com',   label: 'Cloudflare',    detail: 'anycast CDN',      region: 'Global Anycast', countryCode: '',  discoveryHint: 'A shimmering ward — your wounds are soothed by its weave' },
    { host: 'www.google.com',    label: 'Google',        detail: 'anycast 204',      region: 'Global Anycast', countryCode: '',  discoveryHint: 'A world-lens — pain absorbed by ancient wards' },
    { host: 'www.yandex.ru',      label: 'Yandex',        detail: 'Moscow, RU',       region: 'Europe',        countryCode: 'RU', discoveryHint: 'A distant sentinel — blows land softly in the frozen east' },
  ],

  // ---- 💰 Economy ----
  economy: [
    { host: 'www.uol.com.br',     label: 'UOL',           detail: 'São Paulo, BR',    region: 'Americas',      countryCode: 'BR', discoveryHint: 'A green beacon — trade winds through southern canopies' },
    { host: 'timesofindia.indiatimes.com', label: 'Times of India', detail: 'Mumbai, IN', region: 'Asia-Pacific',  countryCode: 'IN', discoveryHint: 'A silk-loom — spice and gold flow across the subcontinent' },
    { host: 'www.lemonde.fr',     label: 'Le Monde',      detail: 'Paris, FR',        region: 'Europe',        countryCode: 'FR', discoveryHint: 'A gallery of light — continental trade routes blessed by old gods' },
    { host: 'www.microsoft.com',  label: 'Microsoft',     detail: 'Redmond, US',      region: 'Americas',      countryCode: 'US', discoveryHint: 'A grand citadel — gold flows through its ancient halls' },
  ],

  // ---- 🧭 Explore ----
  explore: [
    { host: 'www.yahoo.co.jp',    label: 'Yahoo JP',      detail: 'Tokyo, JP',        region: 'Asia-Pacific',  countryCode: 'JP', discoveryHint: 'An island shrine — discovery reaches the rising sun' },
    { host: 'www.naver.com',      label: 'Naver',         detail: 'Seoul, KR',        region: 'Asia-Pacific',  countryCode: 'KR', discoveryHint: 'A watchtower — new frontiers open on the peninsula' },
    { host: 'www.abc.net.au',     label: 'ABC Australia',  detail: 'Sydney, AU',       region: 'Asia-Pacific',  countryCode: 'AU', discoveryHint: 'A sun-scorched beacon — southern discoveries await' },
    { host: 'www.news24.com',     label: 'News24',        detail: 'Cape Town, ZA',    region: 'Africa',        countryCode: 'ZA', discoveryHint: 'A watchfire — uncharted lands at the southern tip' },
  ],

  // ---- 🌅 Survive Night ----
  survive_night: [
    { host: 'www.news24.com',     label: 'News24',        detail: 'Cape Town, ZA',    region: 'Africa',        countryCode: 'ZA', discoveryHint: 'A watchfire — dawn report from the southern tip' },
    { host: 'www.abc.net.au',     label: 'ABC Australia',  detail: 'Sydney, AU',       region: 'Asia-Pacific',  countryCode: 'AU', discoveryHint: 'A sun-scorched beacon — southern watch through the long night' },
    { host: 'www.yandex.ru',      label: 'Yandex',        detail: 'Moscow, RU',       region: 'Europe',        countryCode: 'RU', discoveryHint: 'A distant sentinel — cold-night vigilance in the frozen east' },
  ],
};

// Backwards-compat alias
export const ACTION_PROBE_POOLS = ACTION_ECHO_POOLS;

/** Flatten all unique beacons from the pools into a single list.
 *  Deduplicated by label. */
export function allBeacons(): BeaconTarget[] {
  const seen = new Set<string>();
  const result: BeaconTarget[] = [];
  for (const pool of Object.values(ACTION_ECHO_POOLS)) {
    for (const ep of pool) {
      if (!seen.has(ep.label)) {
        seen.add(ep.label);
        result.push(ep);
      }
    }
  }
  return result;
}

// Backwards-compat alias
export const allEndpoints = allBeacons;

/** Inspect metadata for each unique beacon (keyed by label). */
export const BEACON_INSPECT: Record<string, NetInspect> = {
  'Yandex':       { api: 'DoH resolution via 1.1.1.1 / 8.8.8.8 — the host itself is never contacted', action: 'scheduled resolution, biased toward attack/damage play', flowsInto: 'damage modifier · realm profile median' },
  'Naver':        { api: 'DoH resolution via 1.1.1.1 / 8.8.8.8 — the host itself is never contacted', action: 'scheduled resolution, biased toward attack/gather/explore play', flowsInto: 'damage modifier · realm profile median' },
  'Baidu':        { api: 'DoH resolution via 1.1.1.1 / 8.8.8.8 — the host itself is never contacted', action: 'scheduled resolution, biased toward attack/gather play', flowsInto: 'damage modifier · realm profile median' },
  'Yahoo JP':     { api: 'DoH resolution via 1.1.1.1 / 8.8.8.8 — the host itself is never contacted', action: 'scheduled resolution, biased toward attack/explore play', flowsInto: 'damage modifier · realm profile median' },
  'Cloudflare':   { api: 'DoH resolution via 1.1.1.1 / 8.8.8.8 — the host itself is never contacted', action: 'scheduled resolution, biased toward attack/build/damage play', flowsInto: 'damage modifier · realm profile median' },
  'Microsoft':    { api: 'DoH resolution via 1.1.1.1 / 8.8.8.8 — the host itself is never contacted', action: 'scheduled resolution, biased toward attack/build/economy play', flowsInto: 'damage modifier · realm profile median' },
  'BBC':          { api: 'DoH resolution via 1.1.1.1 / 8.8.8.8 — the host itself is never contacted', action: 'scheduled resolution, biased toward gather/craft play', flowsInto: 'damage modifier · realm profile variance' },
  'Times of India': { api: 'DoH resolution via 1.1.1.1 / 8.8.8.8 — the host itself is never contacted', action: 'scheduled resolution, biased toward gather/economy play', flowsInto: 'realm profile variance' },
  'ABC Australia':  { api: 'DoH resolution via 1.1.1.1 / 8.8.8.8 — the host itself is never contacted', action: 'scheduled resolution, biased toward gather/explore/night play', flowsInto: 'realm profile variance' },
  'News24':       { api: 'DoH resolution via 1.1.1.1 / 8.8.8.8 — the host itself is never contacted', action: 'scheduled resolution, biased toward gather/explore/night play', flowsInto: 'realm profile variance' },
  'Le Monde':     { api: 'DoH resolution via 1.1.1.1 / 8.8.8.8 — the host itself is never contacted', action: 'scheduled resolution, biased toward gather/craft/economy play', flowsInto: 'realm profile variance' },
  'Google':       { api: 'DoH resolution via 1.1.1.1 / 8.8.8.8 — the host itself is never contacted', action: 'scheduled resolution, biased toward build/damage play', flowsInto: 'damage modifier · realm profile median' },
  'El Mundo':     { api: 'DoH resolution via 1.1.1.1 / 8.8.8.8 — the host itself is never contacted', action: 'scheduled resolution, biased toward build/craft play', flowsInto: 'realm profile variance' },
  'UOL':          { api: 'DoH resolution via 1.1.1.1 / 8.8.8.8 — the host itself is never contacted', action: 'scheduled resolution, biased toward build/economy play', flowsInto: 'realm profile variance' },
};

/** Static inspect metadata for Lens sections that aren't metric rows or beacons. */
export const LENS_SECTION_INSPECT: Record<string, NetInspect> = {
  'connection-rtt':    { api: 'navigator.connection.rtt — quantized to 25 ms buckets. Chrome-only.', action: 'always active (polled)', flowsInto: 'sim speed · damage modifier' },
  'connection-dl':     { api: 'navigator.connection.downlink — capped at 10 Mbps. Chrome-only.', action: 'always active (polled)', flowsInto: 'gold rate · gather speed' },
  'connection-jitter': { api: 'Computed from rtt sample deltas (N=30 ring buffer). Not a browser API.', action: 'always active (recomputed on poll)', flowsInto: 'move speed' },
  'realm-profile':     { api: 'Beacon echo median + variance → D1 biome classifier. Derived from per-route fetch() timings.', action: 'updated on every completed beacon probe', flowsInto: 'biome name · rift stability · color grading' },
  'realm-stability':   { api: 'Timer: 100% → 0% over 5 minutes since last rift. Purely internal state.', action: 'decays each frame; resets on rift', flowsInto: 'rift visual intensity' },
  'identity-ip':       { api: 'cloudflare.com/cdn-cgi/trace → ip field. Gated behind first explore action (F8 privacy).', action: 'revealed by your first explore action', flowsInto: 'Vessel identity display' },
  'identity-isp':      { api: 'Reverse DNS (PTR) on your own IP via DoH. No geo-IP vendor is contacted.', action: 'revealed by your first explore action', flowsInto: 'Vessel identity display' },
  'identity-tls':      { api: 'cloudflare.com/cdn-cgi/trace → tls / kex / http fields — the real negotiated TLS version, key exchange and HTTP protocol.', action: 'revealed by your first explore action', flowsInto: 'display only' },
  'identity-skew':     { api: 'Server Date/ts vs Date.now(), corrected for half the measured RTT.', action: 'updated on every trace and baseline probe', flowsInto: 'display only' },
  'identity-colo':     { api: 'fetch() to cloudflare.com/cdn-cgi/trace → colo/warp fields. Gated behind first explore action.', action: 'revealed by your first explore action', flowsInto: 'Vessel identity display' },
  'vessel-ua':         { api: 'navigator.userAgent — parsed for browser brand only (not the full string). Available everywhere.', action: 'boot page load (static)', flowsInto: 'display only (no mechanics in N2a)' },
  'vessel-gpu':        { api: 'WebGLRenderingContext.getParameter(RENDERER) or WebGPU adapter.info. Available in all modern browsers.', action: 'boot page load (static)', flowsInto: 'display only (no mechanics in N2a)' },
  'vessel-screen':     { api: 'screen.width/height + devicePixelRatio. Available everywhere.', action: 'boot page load (static)', flowsInto: 'display only (no mechanics in N2a)' },
  'routes-origin':     { api: 'PerformanceNavigationTiming — DNS/TCP/TLS/TTFB for this origin\'s page load.', action: 'boot page load (captured once, static)', flowsInto: 'Vessel · ancestral memory' },
  'routes-beacon':     { api: 'DoH resolution via 1.1.1.1 / 8.8.8.8. The beacon host itself is never contacted — the resolver answers. Yields resolution latency, the real IP, TTL and DNSSEC status.', action: 'wall-clock scheduler (~6s, jittered); play biases WHICH beacon is next, never how many', flowsInto: 'damage modifier · realm profile' },
  'routes-baseline':   { api: 'Same-origin fetch with PerformanceResourceTiming — full DNS/TCP/TLS/TTFB breakdown and nextHopProtocol. The only host we unambiguously may contact.', action: 'wall-clock scheduler (~20s)', flowsInto: 'control sample for every other route' },
  'routes-gate':       { api: 'Internal token bucket: 20 req/min sustained, burst 6, max 2 in flight, 30s per-host spacing, Retry-After honoured. Not a browser API.', action: 'governs every outbound request', flowsInto: 'nothing — it is the brake' },
  'routes-resolver':   { api: 'Per-resolver latency stats accumulated by alternating 1.1.1.1 and 8.8.8.8 across the session.', action: 'updated on every DoH query', flowsInto: 'display only' },
  'feed-entry':        { api: 'Internal log ring-buffer — truth-kind entries from network polling, probes, and transitions.', action: 'generated by NetworkSystem on poll/probe/transition', flowsInto: 'Lens Feed display · debug trace' },
};

export interface NetworkSnapshot {
  /** Estimated pulse time (ms). From navigator.connection.rtt. */
  rtt: number;
  /** Estimated flow rate (Mbps). From navigator.connection.downlink. */
  downlink: number;
  /** Connection type: 'ethernet' | 'wifi' | 'cellular' | 'unknown'. */
  connectionType: string;
  /** Effective connection type: '4g' | '3g' | '2g' | 'slow-2g' | 'unknown'. */
  effectiveType: string;
  /** Pulse variance (ms) — computed from connection.rtt deltas only. */
  jitter: number;
  /** Echo variance (ms) — computed from successive echoes to the SAME beacon URL. */
  echoJitter: number;
  /** Is the browser currently online? */
  online: boolean;
  /** Real-world time of day as a fraction 0..1 (0 = midnight, 0.5 = noon). */
  timeOfDay: number;
  /** Logical CPU cores. From navigator.hardwareConcurrency. */
  cpuCores: number;
  /** Device RAM in GB (rounded). From navigator.deviceMemory. */
  deviceMemory: number;
  /** Echo time to a well-known beacon (ms). */
  endpointLatency: number;
  /** Page load DNS time (ms). */
  pageDnsTime: number;
  /** Page load TLS handshake time (ms). */
  pageTlsTime: number;
  /** Page load TTFB (ms). */
  pageTtfb: number;

  // ---- identity ----
  /** Your public IPv4 or IPv6 address. */
  publicIp: string;
  /** Internet Service Provider name. */
  isp: string;
  /** City name (from geo-IP). */
  city: string;
  /** Country code (ISO 3166-1 alpha-2). */
  country: string;
  /** Cloudflare edge colo code. */
  colo: string;
  /** AS number + organization. */
  asn: string;
  /** Whether the user is behind Cloudflare WARP. */
  warp: boolean;

  // ---- X1: New Lens parameters -------------------------------------------
  // (geolocation was deliberately NOT added: it fires a browser permission
  // prompt and the identity beacons already show IP-level geo — the Lens
  // never asks for GPS.)
  /** Battery level 0..1, or -1 if unavailable. */
  batteryLevel: number;
  /** Is the device charging? */
  batteryCharging: boolean;
  /** Browser locale (e.g. 'en-US'). */
  locale: string;
  /** IANA timezone (e.g. 'America/New_York'). */
  timezone: string;
  /** Used JS heap size in MB (Chrome-only). */
  jsHeapUsedMB: number;
  /** Total JS heap size in MB (Chrome-only). */
  jsHeapTotalMB: number;

  /** S1: transient — night RTT stability % (computed at dawn). */
  _nightRttStability?: number;

  // ---- resonance chain ----
  /** Multi-hop connection breakdown. */
  traceChain: TraceHop[];

  // ---- beacon echoes ----
  /** Echo times to well-known beacons. */
  endpointProbes: BeaconEcho[];
}

/** The live network stats store — exposed as window.NW.NET. */
export interface LiveNetState {
  /** Current snapshot (updated at ~1 Hz for most metrics). */
  snap: NetworkSnapshot;
  /** All registered mappings, keyed by .key. */
  mappings: Record<string, NetMapping>;
  /** Get a mapped game value by key — systems read this, not the raw snapshot. */
  get(key: string): number;
  /** Push the current snap to the Rust core as a flat Float32Array. */
  packForCore(): Float32Array;
}

/** A game system mapping: net value → gameplay effect. */
export interface NetGameMapping {
  /** Human label for debug UI. */
  label: string;
  /** Which net mapping key drives this. */
  netKey: string;
  /** Transform function: netValue (from get(netKey)) → game value.
   *  Receives ctx with full snapshot + extra fields for transforms that need
   *  more than a single scalar (e.g. moveSpeed needs echoJitter). */
  transform: (netValue: number, ctx?: NetMappingContext) => number;
  /** Target game param path (e.g. 'simSpeed', 'goldRate'). */
  target: string;
  /** Minimum allowed output (guardrail). */
  min: number;
  /** Maximum allowed output (guardrail). */
  max: number;
  /** True while the target system is not yet implemented (stub rows shipped ahead of
   *  their milestone). The Lens renders dormant threads dimmed — the mapping exists
   *  and computes truthfully, but nothing consumes it yet. */
  dormant?: boolean;
}

/** Context passed to NetGameMapping transforms — the full snapshot + extras. */
export interface NetMappingContext {
  snap: NetworkSnapshot;
  distinctRegionsProbed: number;
}

/** Initial metric mappings — raw snapshot → game-readable values. */
export const NET_METRICS: NetMapping[] = [
  {
    key: 'rtt', label: 'Pulse',
    compute: (s) => s.rtt,
    fallback: 50, unit: 'ms', intervalMs: 1000,
    inspect: { api: 'navigator.connection.rtt — quantized to 25 ms buckets by Chrome; unavailable in Firefox/Safari', action: 'always active (polled at 1 Hz)', flowsInto: 'sim speed · damage modifier' },
  },
  {
    key: 'downlink', label: 'Flow',
    compute: (s) => s.downlink,
    fallback: 10, unit: 'Mbps', intervalMs: 2000,
    inspect: { api: 'navigator.connection.downlink — capped at 10 Mbps by Chrome (anti-fingerprinting); unavailable in Firefox/Safari', action: 'always active (polled at 0.5 Hz)', flowsInto: 'gold rate · gather speed' },
  },
  {
    key: 'jitter', label: 'Flux',
    compute: (s) => s.jitter,
    fallback: 5, unit: 'ms', intervalMs: 1000,
    inspect: { api: 'Computed from navigator.connection.rtt deltas (last 30 samples). Not a browser API — derived statistic.', action: 'always active (recomputed on every rtt poll)', flowsInto: 'enemy wobble' },
  },
  {
    key: 'echoJitter', label: 'Echo Flux',
    compute: (s) => s.echoJitter,
    fallback: 5, unit: 'ms', intervalMs: 1000,
    inspect: { api: 'Successive same-beacon echo RTT deltas (rolling mean). Not a browser API — derived from action-gated probe echoes (F1).', action: 'updated on every beacon echo', flowsInto: 'move speed · resolve per kill (S1)' },
  },
  {
    key: 'effectiveType', label: 'Link Tier',
    compute: (s) => {
      const map: Record<string, number> = { '4g': 1, '3g': 2, '2g': 3, 'slow-2g': 4, 'unknown': 1 };
      return map[s.effectiveType] ?? 1;
    },
    fallback: 1, unit: 'tier', intervalMs: 5000,
    inspect: { api: 'navigator.connection.effectiveType — categorical (4g/3g/2g/slow-2g). Chrome-only; defaults to "4g" in other browsers.', action: 'always active (polled at 0.2 Hz)', flowsInto: 'enemy scaling' },
  },
  {
    key: 'connectionType', label: 'Realm',
    compute: (s) => {
      const map: Record<string, number> = { 'ethernet': 0, 'wifi': 1, 'cellular': 2, 'unknown': 0 };
      return map[s.connectionType] ?? 0;
    },
    fallback: 0, unit: '', intervalMs: 10000,
    inspect: { api: 'navigator.connection.type — Android/ChromeOS only. Desktop browsers always return "unknown".', action: 'always active (polled at 0.1 Hz)', flowsInto: 'realm selection · biome' },
  },
  {
    key: 'online', label: 'Awake',
    compute: (s) => s.online ? 1 : 0,
    fallback: 1, unit: '', intervalMs: 5000,
    inspect: { api: 'navigator.onLine + window online/offline events. Available in all browsers.', action: 'always active (event-driven + polled)', flowsInto: 'global pause · realm (The Hollow)' },
  },
  {
    key: 'timeOfDay', label: 'Real Clock',
    compute: (s) => s.timeOfDay,
    fallback: 0, unit: 'frac', intervalMs: 60000,
    inspect: { api: 'Date.now() → hours·3600 + mins·60 + secs / 86400. Available everywhere.', action: 'always active (polled at ~0.017 Hz)', flowsInto: 'day/night phase sync' },
  },
  {
    key: 'cpuCores', label: 'CPU Cores',
    compute: (s) => s.cpuCores,
    fallback: 4, unit: 'cores', intervalMs: 0,
    inspect: { api: 'navigator.hardwareConcurrency — logical cores. Available in all modern browsers.', action: 'boot page load (static for the session)', flowsInto: 'max simultaneous entities · chunk activation radius' },
  },
  {
    key: 'deviceMemory', label: 'RAM',
    compute: (s) => s.deviceMemory,
    fallback: 4, unit: 'GB', intervalMs: 0,
    inspect: { api: 'navigator.deviceMemory — rounded to nearest 0.25/0.5/1/2/4/8 GB. Chrome-only; defaults to 4 GB elsewhere.', action: 'boot page load (static for the session)', flowsInto: 'inventory capacity · max buildings · soul gear slots' },
  },
  {
    key: 'endpointLatency', label: 'Beacon Echo',
    compute: (s) => s.endpointLatency,
    fallback: 30, unit: 'ms', intervalMs: 10000,
    inspect: { api: 'fetch() timing to a well-known public endpoint (no-cors, fire-and-forget). Cross-origin — duration only (no DNS/TCP/TLS breakdown).', action: 'auto-polled every 10s + action-gated probe echoes', flowsInto: 'damage modifier (best recent echo)' },
  },
  {
    key: 'pageDnsTime', label: 'Page DNS',
    compute: (s) => s.pageDnsTime,
    fallback: 10, unit: 'ms', intervalMs: 0,
    inspect: { api: 'PerformanceNavigationTiming.domainLookupEnd − domainLookupStart. This origin only.', action: 'boot page load (captured once, static)', flowsInto: 'Vessel identity · ancestral memory stats' },
  },
  {
    key: 'pageTlsTime', label: 'Page TLS',
    compute: (s) => s.pageTlsTime,
    fallback: 20, unit: 'ms', intervalMs: 0,
    inspect: { api: 'PerformanceNavigationTiming.connectEnd − secureConnectionStart. This origin only.', action: 'boot page load (captured once, static)', flowsInto: 'Vessel identity · ancestral memory stats' },
  },
  {
    key: 'pageTtfb', label: 'Page TTFB',
    compute: (s) => s.pageTtfb,
    fallback: 50, unit: 'ms', intervalMs: 0,
    inspect: { api: 'PerformanceNavigationTiming.responseStart − requestStart. This origin only.', action: 'boot page load (captured once, static)', flowsInto: 'Vessel identity · ancestral memory stats' },
  },

  // ---- X1: New Lens parameters — browser sensors beyond networking --------
  {
    key: 'batteryLevel', label: 'Battery',
    compute: (s) => s.batteryLevel,
    fallback: 1, unit: 'frac', intervalMs: 30000,
    inspect: { api: 'navigator.getBattery() — Battery Status API. Chrome/Edge; unavailable in Firefox/Safari.', action: 'always active (polled at ~0.03 Hz)', flowsInto: 'resource yield · regen rate (low battery = scarcity)' },
  },
  {
    key: 'batteryCharging', label: 'Charging',
    compute: (s) => s.batteryCharging ? 1 : 0,
    fallback: 1, unit: '', intervalMs: 30000,
    inspect: { api: 'navigator.getBattery().charging — Battery Status API. Chrome/Edge only.', action: 'always active (polled at ~0.03 Hz)', flowsInto: 'day health regen — plugged in heals 20% faster' },
  },
  {
    key: 'locale', label: 'Locale',
    compute: (s) => s.locale ? s.locale.charCodeAt(0) / 26 : 0,
    fallback: 0, unit: '', intervalMs: 0,
    inspect: { api: 'navigator.language — browser UI locale. Available everywhere.', action: 'boot page load (static)', flowsInto: 'nothing yet — surfaced for the Lens only' },
  },
  {
    key: 'timezone', label: 'Timezone',
    compute: (s) => {
      // encode timezone offset as fraction of day
      try { return new Date().getTimezoneOffset() / -1440 + 0.5; } catch { return 0.5; }
    },
    fallback: 0.5, unit: 'frac', intervalMs: 60000,
    inspect: { api: 'Intl.DateTimeFormat().resolvedOptions().timeZone → Date.getTimezoneOffset(). Available everywhere.', action: 'always active (polled at ~0.017 Hz)', flowsInto: 'day/night offset · season flavor' },
  },
  {
    key: 'jsHeapUsed', label: 'JS Heap',
    compute: (s) => s.jsHeapUsedMB,
    fallback: 50, unit: 'MB', intervalMs: 10000,
    inspect: { api: 'performance.memory.usedJSHeapSize — Chrome-only. Fallback: 50 MB.', action: 'always active (polled at 0.1 Hz)', flowsInto: 'Veil Pressure — difficulty scalar (more memory pressure = harder)' },
  },
];

/** Game system mappings — resonance values transformed into gameplay effects. */
export const NET_GAME_MAP: NetGameMapping[] = [
  {
    label: 'Sim Speed',
    netKey: 'rtt',
    // High pulse = slower sim. 50ms = 1×, band clamped to 0.85–1.15× (D4).
    transform: (rtt: number) => Math.max(0.85, Math.min(1.15, 1.0 + (50 - rtt) * 0.003)),
    target: 'simSpeed',
    min: 0.85,
    max: 1.15,
  },
  {
    label: 'Gold Rate',
    netKey: 'downlink',
    // D5: wide lightning bands 0.30–1.50. 1 Mbps → 0.58×, 10 Mbps → 1.25×.
    transform: (dl: number) => Math.max(0.30, Math.min(1.50, 0.5 + dl * 0.075)),
    target: 'goldRate',
    min: 0.30,
    max: 1.50,
  },
  {
    label: 'Enemy Scaling',
    netKey: 'effectiveType',
    // D5: wider band 0.50–1.60. 4g=1×, 3g=1.3×, 2g=1.6×.
    transform: (tier: number) => Math.max(0.50, Math.min(1.60, 0.6 + tier * 0.3)),
    target: 'enemyScale',
    min: 0.50,
    max: 1.60,
  },
  {
    label: 'Day/Night Sync',
    netKey: 'timeOfDay',
    transform: (frac: number) => frac,
    target: 'dayPhase',
    min: 0,
    max: 1,
  },
  {
    label: 'Realm Type',
    netKey: 'connectionType',
    // Wired=0 (stable), Wireless=1 (wild), Cellular=2 (chaos).
    transform: (v: number) => v,
    target: 'realmType',
    min: 0,
    max: 2,
  },
  // ---- D5: Damage is a per-swing rolled modifier (lightning bands) ----
  {
    label: 'Damage',
    netKey: 'endpointLatency',  // carries min/max; actual roll logic is per-swing in NetworkSystem.rollDamageMul()
    // This row is declarative — the roll logic reads its clamps.
    transform: (_v: number) => 1.0, // actual value comes from per-swing roll, not transform
    target: 'damage',
    min: 0.30,
    max: 1.50,
  },
  // ---- N2a: New modifiers from live vars ----
  {
    label: 'Move Speed',
    netKey: 'echoJitter',
    // 1.06 − echoJitter × 0.002, clamp 0.92–1.06 (D4 rationale)
    transform: (jit: number) => Math.max(0.92, Math.min(1.06, 1.06 - jit * 0.002)),
    target: 'moveSpeed',
    min: 0.92,
    max: 1.06,
  },
  {
    label: 'Gather Speed',
    netKey: 'downlink',
    // D5: wide lightning bands 0.50–1.50
    transform: (dl: number) => Math.max(0.50, Math.min(1.50, 0.85 + dl * 0.04)),
    target: 'gatherSpeed',
    min: 0.50,
    max: 1.50,
  },
  {
    label: 'XP Rate',
    netKey: 'rtt',  // ctx carries the real driver (distinctRegionsProbed)
    // 1 + distinctRegionsProbed × 0.06, clamp 1.0–1.30 (now 0.75–1.50 per D5)
    transform: (_rtt: number, ctx?: NetMappingContext) => {
      const regions = ctx?.distinctRegionsProbed ?? 0;
      return Math.max(0.75, Math.min(1.50, 1 + regions * 0.06));
    },
    target: 'xpRate',
    min: 0.75,
    max: 1.50,
  },

  // ---- S1: Vitals — survival stats derived from network metrics ----
  // Base values in CFG.vitals.*; these multipliers apply on top each tick.
  // ALL rows dormant until S1 ships a VitalsSystem that consumes the targets.
  // (resolvePerSurviveNight is the one S1 mapping with NO row yet — it needs a
  // night-RTT-stability tracker in NetworkSystem, built at S1 implementation.)
  {
    label: 'Vigor Decay',
    netKey: 'downlink',
    // Low bandwidth = scarcity = faster hunger. 10Mbps→0.8×, 0.5Mbps→3.0×.
    transform: (dl: number) => {
      if (dl >= 10) return 0.8;
      if (dl >= 5) return 1.0;
      if (dl >= 2) return 1.4;
      if (dl >= 0.5) return 2.0;
      return 3.0;
    },
    target: 'vigorDecay',
    min: 0.8,
    max: 3.0,
  },
  {
    label: 'Vigor Per Kill',
    netKey: 'rtt',
    // Low latency = clean kill = more nourishment. ≤20ms→1.3×, >400ms→0.4×.
    transform: (rtt: number) => {
      if (rtt <= 20) return 1.3;
      if (rtt <= 50) return 1.0;
      if (rtt <= 150) return 0.8;
      if (rtt <= 400) return 0.6;
      return 0.4;
    },
    target: 'vigorPerKill',
    min: 0.4,
    max: 1.3,
  },
  {
    label: 'Resolve Decay',
    netKey: 'effectiveType',
    // Worse connection = mind frays faster. 4g→1×, 2g→2.5×, slow-2g→4×.
    // Tier encoding (NET_METRICS 'effectiveType'): 4g/unknown=1, 3g=2, 2g=3, slow-2g=4.
    transform: (tier: number) => {
      if (tier <= 1) return 1.0;   // 4g / fallback
      if (tier <= 2) return 1.5;   // 3g
      if (tier <= 3) return 2.5;   // 2g
      return 4.0;                   // slow-2g
    },
    target: 'resolveDecay',
    min: 1.0,
    max: 4.0,
  },
  {
    label: 'Resolve Per Kill',
    netKey: 'echoJitter',
    // Stable connection = satisfying kill. <5ms echo jitter→1.4×, ≥60ms→0.3×.
    transform: (jit: number) => {
      if (jit < 5) return 1.4;
      if (jit < 15) return 1.0;
      if (jit < 30) return 0.7;
      if (jit < 60) return 0.5;
      return 0.3;
    },
    target: 'resolvePerKill',
    min: 0.3,
    max: 1.4,
  },
  {
    label: 'Resolve Per Build',
    netKey: 'cpuCores',
    // More cores = stronger anchor. ≥8→1.5×, <4→0.7×.
    transform: (cores: number) => {
      if (cores >= 8) return 1.5;
      if (cores >= 4) return 1.0;
      return 0.7;
    },
    target: 'resolvePerBuild',
    min: 0.7,
    max: 1.5,
  },
  {
    label: 'Resolve Near Hall',
    netKey: 'deviceMemory',
    // More RAM = hall is stronger sanctuary. ≥8GB→1.5×, <4GB→0.6×.
    transform: (ram: number) => {
      if (ram >= 8) return 1.5;
      if (ram >= 4) return 1.0;
      return 0.6;
    },
    target: 'resolveNearHall',
    min: 0.6,
    max: 1.5,
  },
  {
    label: 'Vigor Per Gather',
    netKey: 'endpointLatency',
    // Fast beacon echo = rich gathering node. Same banding as Vigor Per Kill.
    transform: (ms: number) => {
      if (ms <= 20) return 1.3;
      if (ms <= 50) return 1.0;
      if (ms <= 150) return 0.8;
      if (ms <= 400) return 0.6;
      return 0.4;
    },
    target: 'vigorPerGather',
    min: 0.4,
    max: 1.3,
  },
  {
    label: 'Vigor Campfire',
    netKey: 'deviceMemory',
    // More memory = the Watchfire burns steadier. ≥8GB→1.5×, <4GB→0.6×.
    transform: (ram: number) => {
      if (ram >= 8) return 1.5;
      if (ram >= 4) return 1.0;
      return 0.6;
    },
    target: 'vigorPerCampfire',
    min: 0.6,
    max: 1.5,
  },
  {
    label: 'Resolve Night',
    netKey: 'timeOfDay',
    // Real-clock witching hour: late-night play = deeper dark = faster fray.
    // timeOfDay is a 0–1 fraction of the real 24h day.
    transform: (frac: number) => {
      const hour = frac * 24;
      if (hour >= 2 && hour < 5) return 2.5;    // the witching hours
      if (hour < 2) return 1.5;                  // midnight–2am
      if (hour >= 18) return 1.0;                // evening
      return 0.8;                                // daylight hours
    },
    target: 'resolveNightMult',
    min: 0.8,
    max: 2.5,
  },
  {
    label: 'Resolve Per Survive Night',
    netKey: 'rtt',
    // Night-RTT stability: % of night RTT stayed in its median band.
    // Stable night = triumphant dawn. Chaotic night = barely held on.
    // The stability is computed by NetworkSystem at dawn and stored in
    // snap._nightRttStability before this transform runs.
    transform: (_rtt: number, ctx?: NetMappingContext) => {
      const stability = (ctx?.snap as any)?._nightRttStability ?? 100;
      if (stability >= 90) return 1.5;
      if (stability >= 70) return 1.0;
      if (stability >= 50) return 0.7;
      return 0.4;
    },
    target: 'resolvePerSurviveNight',
    min: 0.4,
    max: 1.5,
  },

  // ---- X1: New game mappings from Lens sensors ----------------------------
  {
    label: 'Veil Pressure',
    netKey: 'jsHeapUsed',
    // Memory pressure = the Veil presses harder. 20MB→0.9×, 200MB→1.4×.
    transform: (mb: number) => Math.max(0.85, Math.min(1.5, 0.85 + mb * 0.003)),
    target: 'veilPressure',
    min: 0.85,
    max: 1.5,
  },
  {
    label: 'Battery Scarcity',
    netKey: 'batteryLevel',
    // Low battery = scarcity mode. Full→1.0×, 15%→0.7×, 5%→0.5×.
    transform: (level: number) => {
      if (level < 0) return 1.0; // unavailable
      return Math.max(0.5, Math.min(1.0, level));
    },
    target: 'resourceYield',
    min: 0.5,
    max: 1.0,
  },
  {
    label: 'Charging Bonus',
    netKey: 'batteryCharging',
    // Plugged in = the network flows freely. 1→1.2×, 0→1.0×.
    transform: (v: number) => v > 0 ? 1.2 : 1.0,
    target: 'regenRate',
    min: 1.0,
    max: 1.2,
  },
];
