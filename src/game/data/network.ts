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
}

/** A single step in the resonance chain. */
export interface TraceHop {
  label: string;
  latency: number;
  detail?: string;
}

/** A single beacon echo result. */
export interface BeaconEcho {
  host: string;
  label: string;
  /** Echo time (ms). -1 = unreachable. */
  rtt: number;
  detail?: string;
  region: string;
  countryCode: string;
  /** Timestamp when this echo was recorded (performance.now() ms). */
  ts?: number;
}

// Backwards-compat alias
export type EndpointProbe = BeaconEcho;

// ---- M3.5: Action-gated beacon discovery ----
// Beacons are discovered through gameplay. Each action category (attack,
// gather, build, etc.) randomly pings one beacon from its themed pool.

/** A single beacon target — reusable across action pools. */
export interface BeaconTarget {
  /** URL to ping (no-cors fire-and-forget). */
  url: string;
  label: string;
  detail: string;
  region: string;
  countryCode: string;
  /** Hint shown while this beacon is undiscovered. */
  discoveryHint: string;
}

// Backwards-compat alias
export type EndpointTarget = BeaconTarget;

/** Cooldown (seconds) per action type before the next echo can fire. */
export const ACTION_COOLDOWNS: Record<string, number> = {
  attack: 0,   // no cooldown — every swing sends an echo volley
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
    { url: 'https://www.yandex.ru/favicon.ico',     label: 'Yandex',        detail: 'Moscow, RU',       region: 'Europe',        countryCode: 'RU', discoveryHint: 'A distant sentinel in the frozen east — your strikes echo across the tundra' },
    { url: 'https://www.naver.com/favicon.ico',      label: 'Naver',         detail: 'Seoul, KR',        region: 'Asia-Pacific',  countryCode: 'KR', discoveryHint: 'A watchtower on the eastern peninsula — blades sing through mountain passes' },
    { url: 'https://www.baidu.com/favicon.ico',      label: 'Baidu',         detail: 'Beijing, CN',      region: 'Asia-Pacific',  countryCode: 'CN', discoveryHint: 'The great fortress of the east — your war-cry reaches the Jade Palace' },
    { url: 'https://www.yahoo.co.jp/favicon.ico',    label: 'Yahoo JP',      detail: 'Tokyo, JP',        region: 'Asia-Pacific',  countryCode: 'JP', discoveryHint: 'An island shrine across the eastern sea — battle-hymns on the wind' },
    { url: 'https://cloudflare.com/cdn-cgi/trace',   label: 'Cloudflare',    detail: 'anycast CDN',      region: 'Global Anycast', countryCode: '',  discoveryHint: 'A shimmering ward that spans the globe — your blade resonates through its weave' },
    { url: 'https://www.microsoft.com/favicon.ico',  label: 'Microsoft',     detail: 'Redmond, US',      region: 'Americas',      countryCode: 'US', discoveryHint: 'A grand citadel in the western forests — combat-hymns route through its halls' },
  ],

  // ---- 🪓 Gather ----
  gather: [
    { url: 'https://www.bbc.co.uk/favicon.ico',      label: 'BBC',           detail: 'London, GB',       region: 'Europe',        countryCode: 'GB', discoveryHint: 'An ancient archive in the old world — timber routes through misty isles' },
    { url: 'https://www.baidu.com/favicon.ico',      label: 'Baidu',         detail: 'Beijing, CN',      region: 'Asia-Pacific',  countryCode: 'CN', discoveryHint: 'Quarries beneath the eastern mountains — stone sings with ancient power' },
    { url: 'https://timesofindia.indiatimes.com/favicon.ico', label: 'Times of India', detail: 'Mumbai, IN', region: 'Asia-Pacific',  countryCode: 'IN', discoveryHint: 'A silk-loom across the subcontinent — threads of gold and spice' },
    { url: 'https://www.abc.net.au/favicon.ico',     label: 'ABC Australia',  detail: 'Sydney, AU',       region: 'Asia-Pacific',  countryCode: 'AU', discoveryHint: 'A sun-scorched beacon in the far south — raw bounty from the red earth' },
    { url: 'https://www.news24.com/favicon.ico',     label: 'News24',        detail: 'Cape Town, ZA',    region: 'Africa',        countryCode: 'ZA', discoveryHint: 'A watchfire at the southern tip — riches from beneath the Table Mountain' },
    { url: 'https://www.lemonde.fr/favicon.ico',     label: 'Le Monde',      detail: 'Paris, FR',        region: 'Europe',        countryCode: 'FR', discoveryHint: 'A gallery of light in the heart of the continent — harvests blessed by old gods' },
  ],

  // ---- 🏗 Build ----
  build: [
    { url: 'https://www.microsoft.com/favicon.ico',  label: 'Microsoft',     detail: 'Redmond, US',      region: 'Americas',      countryCode: 'US', discoveryHint: 'A grand citadel in the western forests — your walls draw strength from its foundations' },
    { url: 'https://www.google.com/generate_204',    label: 'Google',        detail: 'anycast 204',      region: 'Global Anycast', countryCode: '',  discoveryHint: 'A world-lens that sees all — your fortress rests on ancient keystones' },
    { url: 'https://cloudflare.com/cdn-cgi/trace',   label: 'Cloudflare',    detail: 'anycast CDN',      region: 'Global Anycast', countryCode: '',  discoveryHint: 'A shimmering ward — your battlements are etched into its weave' },
    { url: 'https://www.elmundo.es/favicon.ico',     label: 'El Mundo',      detail: 'Madrid, ES',       region: 'Europe',        countryCode: 'ES', discoveryHint: 'A sun-baked fortress in Iberia — fortification songs through the sierra' },
    { url: 'https://www.uol.com.br/favicon.ico',     label: 'UOL',           detail: 'São Paulo, BR',    region: 'Americas',      countryCode: 'BR', discoveryHint: 'A green beacon in the southern jungles — your walls echo through the canopy' },
  ],

  // ---- ⚒ Craft ----
  craft: [
    { url: 'https://www.lemonde.fr/favicon.ico',     label: 'Le Monde',      detail: 'Paris, FR',        region: 'Europe',        countryCode: 'FR', discoveryHint: 'A gallery of light — artisan souls resonate through its halls' },
    { url: 'https://www.bbc.co.uk/favicon.ico',      label: 'BBC',           detail: 'London, GB',       region: 'Europe',        countryCode: 'GB', discoveryHint: 'An ancient archive — old-world craftsmanship echoes within' },
    { url: 'https://www.elmundo.es/favicon.ico',     label: 'El Mundo',      detail: 'Madrid, ES',       region: 'Europe',        countryCode: 'ES', discoveryHint: 'A Mediterranean forge — steel tempered by sea winds' },
    { url: 'https://www.naver.com/favicon.ico',      label: 'Naver',         detail: 'Seoul, KR',        region: 'Asia-Pacific',  countryCode: 'KR', discoveryHint: 'A precision forge on the peninsula — blades folded a thousand times' },
  ],

  // ---- 💥 Damage ----
  damage: [
    { url: 'https://cloudflare.com/cdn-cgi/trace',   label: 'Cloudflare',    detail: 'anycast CDN',      region: 'Global Anycast', countryCode: '',  discoveryHint: 'A shimmering ward — your wounds are soothed by its weave' },
    { url: 'https://www.google.com/generate_204',    label: 'Google',        detail: 'anycast 204',      region: 'Global Anycast', countryCode: '',  discoveryHint: 'A world-lens — pain absorbed by ancient wards' },
    { url: 'https://www.yandex.ru/favicon.ico',      label: 'Yandex',        detail: 'Moscow, RU',       region: 'Europe',        countryCode: 'RU', discoveryHint: 'A distant sentinel — blows land softly in the frozen east' },
  ],

  // ---- 💰 Economy ----
  economy: [
    { url: 'https://www.uol.com.br/favicon.ico',     label: 'UOL',           detail: 'São Paulo, BR',    region: 'Americas',      countryCode: 'BR', discoveryHint: 'A green beacon — trade winds through southern canopies' },
    { url: 'https://timesofindia.indiatimes.com/favicon.ico', label: 'Times of India', detail: 'Mumbai, IN', region: 'Asia-Pacific',  countryCode: 'IN', discoveryHint: 'A silk-loom — spice and gold flow across the subcontinent' },
    { url: 'https://www.lemonde.fr/favicon.ico',     label: 'Le Monde',      detail: 'Paris, FR',        region: 'Europe',        countryCode: 'FR', discoveryHint: 'A gallery of light — continental trade routes blessed by old gods' },
    { url: 'https://www.microsoft.com/favicon.ico',  label: 'Microsoft',     detail: 'Redmond, US',      region: 'Americas',      countryCode: 'US', discoveryHint: 'A grand citadel — gold flows through its ancient halls' },
  ],

  // ---- 🧭 Explore ----
  explore: [
    { url: 'https://www.yahoo.co.jp/favicon.ico',    label: 'Yahoo JP',      detail: 'Tokyo, JP',        region: 'Asia-Pacific',  countryCode: 'JP', discoveryHint: 'An island shrine — discovery reaches the rising sun' },
    { url: 'https://www.naver.com/favicon.ico',      label: 'Naver',         detail: 'Seoul, KR',        region: 'Asia-Pacific',  countryCode: 'KR', discoveryHint: 'A watchtower — new frontiers open on the peninsula' },
    { url: 'https://www.abc.net.au/favicon.ico',     label: 'ABC Australia',  detail: 'Sydney, AU',       region: 'Asia-Pacific',  countryCode: 'AU', discoveryHint: 'A sun-scorched beacon — southern discoveries await' },
    { url: 'https://www.news24.com/favicon.ico',     label: 'News24',        detail: 'Cape Town, ZA',    region: 'Africa',        countryCode: 'ZA', discoveryHint: 'A watchfire — uncharted lands at the southern tip' },
  ],

  // ---- 🌅 Survive Night ----
  survive_night: [
    { url: 'https://www.news24.com/favicon.ico',     label: 'News24',        detail: 'Cape Town, ZA',    region: 'Africa',        countryCode: 'ZA', discoveryHint: 'A watchfire — dawn report from the southern tip' },
    { url: 'https://www.abc.net.au/favicon.ico',     label: 'ABC Australia',  detail: 'Sydney, AU',       region: 'Asia-Pacific',  countryCode: 'AU', discoveryHint: 'A sun-scorched beacon — southern watch through the long night' },
    { url: 'https://www.yandex.ru/favicon.ico',      label: 'Yandex',        detail: 'Moscow, RU',       region: 'Europe',        countryCode: 'RU', discoveryHint: 'A distant sentinel — cold-night vigilance in the frozen east' },
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
  /** Transform function: netValue (from get(netKey)) → game value. */
  transform: (netValue: number) => number;
  /** Target game param path (e.g. 'simSpeed', 'goldRate'). */
  target: string;
  /** Minimum allowed output (guardrail). */
  min: number;
  /** Maximum allowed output (guardrail). */
  max: number;
}

/** Initial metric mappings — raw snapshot → game-readable values. */
export const NET_METRICS: NetMapping[] = [
  {
    key: 'rtt', label: 'Pulse',
    compute: (s) => s.rtt,
    fallback: 50, unit: 'ms', intervalMs: 1000,
  },
  {
    key: 'downlink', label: 'Flow',
    compute: (s) => s.downlink,
    fallback: 10, unit: 'Mbps', intervalMs: 2000,
  },
  {
    key: 'jitter', label: 'Flux',
    compute: (s) => s.jitter,
    fallback: 5, unit: 'ms', intervalMs: 1000,
  },
  {
    key: 'effectiveType', label: 'Link Tier',
    compute: (s) => {
      const map: Record<string, number> = { '4g': 1, '3g': 2, '2g': 3, 'slow-2g': 4, 'unknown': 1 };
      return map[s.effectiveType] ?? 1;
    },
    fallback: 1, unit: 'tier', intervalMs: 5000,
  },
  {
    key: 'connectionType', label: 'Realm',
    compute: (s) => {
      const map: Record<string, number> = { 'ethernet': 0, 'wifi': 1, 'cellular': 2, 'unknown': 0 };
      return map[s.connectionType] ?? 0;
    },
    fallback: 0, unit: '', intervalMs: 10000,
  },
  {
    key: 'online', label: 'Awake',
    compute: (s) => s.online ? 1 : 0,
    fallback: 1, unit: '', intervalMs: 5000,
  },
  {
    key: 'timeOfDay', label: 'Real Clock',
    compute: (s) => s.timeOfDay,
    fallback: 0, unit: 'frac', intervalMs: 60000,
  },
  {
    key: 'cpuCores', label: 'CPU Cores',
    compute: (s) => s.cpuCores,
    fallback: 4, unit: 'cores', intervalMs: 0,
  },
  {
    key: 'deviceMemory', label: 'RAM',
    compute: (s) => s.deviceMemory,
    fallback: 4, unit: 'GB', intervalMs: 0,
  },
  {
    key: 'endpointLatency', label: 'Beacon Echo',
    compute: (s) => s.endpointLatency,
    fallback: 30, unit: 'ms', intervalMs: 10000,
  },
  {
    key: 'pageDnsTime', label: 'Page DNS',
    compute: (s) => s.pageDnsTime,
    fallback: 10, unit: 'ms', intervalMs: 0,
  },
  {
    key: 'pageTlsTime', label: 'Page TLS',
    compute: (s) => s.pageTlsTime,
    fallback: 20, unit: 'ms', intervalMs: 0,
  },
  {
    key: 'pageTtfb', label: 'Page TTFB',
    compute: (s) => s.pageTtfb,
    fallback: 50, unit: 'ms', intervalMs: 0,
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
    // Downlink observable range is (0, 10] Mbps (anti-fingerprinting cap).
    // 1 Mbps → 0.58×, 5 Mbps → 0.88×, 10 Mbps → 1.25×.
    transform: (dl: number) => Math.max(0.5, Math.min(1.25, 0.5 + dl * 0.075)),
    target: 'goldRate',
    min: 0.5,
    max: 1.25,
  },
  {
    label: 'Enemy Scaling',
    netKey: 'effectiveType',
    // Weaker link = harder enemies. 4g=1×, 3g=1.4×, 2g=2×.
    transform: (tier: number) => 0.6 + tier * 0.4,
    target: 'enemyScale',
    min: 1.0,
    max: 3.0,
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
  // ---- N2a: New modifiers from live vars ----
  {
    label: 'Move Speed',
    netKey: 'rtt',  // reuse rtt via jitter for move speed
    // 1.06 − echoJitter × 0.002, clamp 0.92–1.06
    transform: (_rtt: number) => {
      // reads echoJitter from the live snap — not ideal but matches brief formula
      return 1.06; // placeholder; actual driven by echoJitter at call site
    },
    target: 'moveSpeed',
    min: 0.92,
    max: 1.06,
  },
  {
    label: 'Gather Speed',
    netKey: 'downlink',
    // 0.85 + downlink × 0.04, clamp 0.85–1.25
    transform: (dl: number) => Math.max(0.85, Math.min(1.25, 0.85 + dl * 0.04)),
    target: 'gatherSpeed',
    min: 0.85,
    max: 1.25,
  },
  {
    label: 'XP Rate',
    netKey: 'rtt',  // placeholder — actually driven by distinctRegionsProbed
    // 1 + distinctRegionsProbed × 0.06, clamp 1.0–1.30
    transform: (_rtt: number) => 1.0, // actual driven by distinctRegionsProbed
    target: 'xpRate',
    min: 1.0,
    max: 1.30,
  },
];
