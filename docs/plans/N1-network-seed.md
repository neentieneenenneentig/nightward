# N1 — Network Seed (the data plumbing)

Goal: live browser network metrics flow into the game as first-class game parameters,
surfaced alongside `NW.CFG` and `NW.MATS` as `NW.NET`. No new rendering, no new systems
— pure data plumbing. After N1, `window.NW.NET.rtt` drives sim speed, `.downlink` drives
gold regen, `.effectiveType` sets the difficulty tier, and the day/night cycle syncs to
the real clock.

This brief is implementation-grade; the **Acceptance checklist** at the bottom is the
post-merge verification contract — run it verbatim. Prereq: R2 merged (`v0.15.1-r2-fire-fix`)
— `pushMaterials()`/`pushFireParams()` pattern, `window.NW.CFG`/`NW.MATS` live-tuning
convention.

## The one big idea (learning sidebar)
The browser exposes surprisingly rich network data through standard APIs — no npm packages,
no native binaries, no permissions dialogs. `navigator.connection` (Chromium-only) gives
RTT, downlink, and connection type. `fetch()` + `performance.now()` gives latency to any
public endpoint. `Date.now()` gives the real clock. WebRTC can discover the local IP.

**The design rule**: every network→game mapping must be a data row in `src/game/data/network.ts`,
never engine code. Adding a new metric mapping is adding a row, same as adding a material or
item. The mapping functions are live-tweakable at runtime via `window.NW.NET`.

**Graceful degradation**: when a metric is unavailable (e.g., `navigator.connection` in Firefox),
the game falls back to a documented sensible default. The game is always playable — network
data enhances, it does not gate.

## Browser API availability & edge cases

### API support matrix (detailed)

| API | Chrome 80+ | Edge 80+ | Firefox (all) | Safari (all) | Returns when unsupported | Notes |
|-----|-----------|----------|---------------|-------------|--------------------------|-------|
| `navigator.connection` | ✅ Full | ✅ Full | ❌ `undefined` | ❌ `undefined` | `undefined` | Chrome-only; not on standards track — may be removed in future |
| `.connection.rtt` | ✅ number | ✅ number | — | — | fallback: 50 | Returns 0 on some Chrome versions when estimate unavailable → treat 0 as fallback |
| `.connection.downlink` | ✅ number | ✅ number | — | — | fallback: 10 | Returns ∞ or very large values on fast connections → clamp to 1000 Mbps |
| `.connection.effectiveType` | ✅ string | ✅ string | — | — | fallback: `'4g'` | Can be `'slow-2g'`, `'2g'`, `'3g'`, `'4g'` — map to tier 4/3/2/1 |
| `.connection.type` | ✅ string | ✅ string | — | — | fallback: `'ethernet'` | Can be `'cellular'`, `'ethernet'`, `'wifi'`, `'wimax'`, `'bluetooth'`, `'other'`, `'unknown'`, `'none'` |
| `.connection.addEventListener('change')` | ✅ | ✅ | — | — | never fires | Use polling fallback (1s interval) — the event is a bonus, not relied upon |
| `navigator.hardwareConcurrency` | ✅ | ✅ | ✅ | ✅ | fallback: 4 | Returns logical cores; may be reduced for privacy (some browsers cap at 2) |
| `navigator.deviceMemory` | ✅ | ✅ | ❌ | ❌ | fallback: 4 | Chrome-only; returns 0.25/0.5/1/2/4/8 GB rounded |
| `navigator.onLine` | ✅ | ✅ | ✅ | ✅ | fallback: `true` | Can be `true` even when internet is unreachable (only reports LAN connectivity) |
| `window` `'online'`/`'offline'` events | ✅ | ✅ | ✅ | ✅ | never fires | Fires on OS-level network change; may not fire for VPN or VM network changes |
| `performance.getEntriesByType('navigation')` | ✅ | ✅ | ✅ | ✅ | empty array | Returns an array with one entry; check `.length > 0` before accessing |
| `performance.now()` | ✅ | ✅ | ✅ | ✅ | — | Monotonic clock, sub-millisecond precision; used for timing fetch() probes |
| `fetch()` | ✅ | ✅ | ✅ | ✅ | throws | `no-cors` mode for opaque responses; `cache: 'no-store'` to bypass browser cache |
| `Date.now()` | ✅ | ✅ | ✅ | ✅ | — | Wall clock; subject to system time changes (NTP sync, user adjustment, DST) |

### Edge cases by metric

**RTT (navigator.connection.rtt):**
- Chrome may return `0` when the estimate is not yet available (fresh browser start, first 5-10 seconds).
  Treat `0` as "unknown" → use fallback (50ms).
- RTT values > 5000ms are possible on extremely poor connections (satellite, congested cellular).
  Clamp to 5000ms max to avoid degenerate sim behavior (sim speed → 0.01×).
- RTT can spike momentarily (WiFi interference, bufferbloat). The jitter computation is the defense —
  single-spike RTT doesn't directly affect sim speed; the rolling average does.

**Downlink (navigator.connection.downlink):**
- Chrome returns Mbps as a float (e.g., 10.2). On very fast connections, may return ∞ or 1000+.
  Clamp to [0.1, 1000] range.
- Downlink of 0 means "no estimate" — use fallback (10 Mbps).
- Downlink is an *estimate* of achievable bandwidth, not measured throughput. It can be wrong.
  The game doesn't depend on accuracy — it uses downlink as a *flavor parameter*, not a measurement.

**Connection type (navigator.connection.type):**
- WiFi connections may flap between `'wifi'` and `'unknown'` during brief disconnects or when the
  OS reports ambiguity. Debounce: require a type to persist for ≥5 seconds before treating it as
  a transition. Ignore `'unknown'` ↔ `'wifi'` transitions entirely (treat `'unknown'` as the
  last known type).
- `'bluetooth'` and `'wimax'` are possible but rare. Map `'bluetooth'` to cellular (tier 2, chaos),
  `'wimax'` to wifi (tier 1, wild).
- `'none'` means the browser reports no connection, but `navigator.onLine` may still be `true`.
  Treat `'none'` as offline regardless of `navigator.onLine`.

**fetch() endpoint timing:**
- `no-cors` mode means the response is opaque — we can't read the body, but we CAN measure the
  round-trip time (fetch resolves when headers arrive). This is sufficient.
- Corporate proxies may block `cloudflare.com/cdn-cgi/trace`. Fallback endpoints in order:
  1. `https://cloudflare.com/cdn-cgi/trace` (returns a short text/plain body, fast)
  2. `https://www.google.com/generate_204` (returns 204 No Content, fast)
  3. `https://www.microsoft.com/favicon.ico` (any small static resource works)
  If ALL fail, `endpointLatency` stays at fallback (30ms). The game doesn't error.
- `cache: 'no-store'` is critical — without it, the browser may serve a cached response with
  ~0ms timing, making the metric useless.
- DNS/TLS time is included in the fetch timing (first request to a domain). Subsequent requests
  reuse the connection and are faster. This is fine — the metric reflects the *current* state
  of the connection pool.

**Performance API navigation timing:**
- `performance.getEntriesByType('navigation')` may return an empty array if the page was loaded
  via `file://` or in a sandboxed iframe. Check `.length > 0` before accessing.
- Individual timing fields (`domainLookupStart`, `secureConnectionStart`, etc.) may be 0 if the
  corresponding phase didn't happen (e.g., TLS 0 on HTTP pages, DNS 0 if cached). In these cases,
  the computed difference is 0 — treat as "no data," use fallback.
- Navigation timing reflects the INITIAL page load, not the current network state. This is
  intentional — "ancestral memory" is a permanent character stat for the run, set once at boot.

**Real clock (Date.now()):**
- System clock changes (NTP sync, user adjustment, DST) cause the time-of-day fraction to jump.
  The game doesn't need to handle this — the fraction is read each frame, so it naturally
  corrects. DST transitions (1-hour jump) may cause a brief visual day/night skip — acceptable.
- Timezone: `Date.now()` returns UTC epoch, but `getHours()`/`getMinutes()`/`getSeconds()` use
  LOCAL time. This is intentional — the player's local time-of-day drives the game clock, so
  "3am" means 3am wherever the player is.

### Error handling strategy

The rule: **every metric read is wrapped in a fallback.** There is no code path where an
unavailable API causes an error, NaN, or undefined to propagate to game systems.

```ts
// Pattern used for every metric access:
const rtt = con?.rtt;                          // undefined if con is null
if (typeof rtt !== 'number' || rtt <= 0) {     // 0 means "no estimate" on some Chrome versions
  this.snap.rtt = 50;                           // fallback
} else {
  this.snap.rtt = Math.max(1, Math.min(5000, rtt)); // clamp to sensible range
}
```

All game systems that read `net.get(key)` receive a number. The `get()` method catches
exceptions in `compute()` and returns the mapping's `fallback` value. Systems never need
to null-check network values.

## Performance characteristics

### Frame budget for network polling

The `NetworkSystem.update(nowMs)` call is designed to be negligible in the render loop:

| Operation | Frequency | Cost | Notes |
|-----------|-----------|------|-------|
| `pollConnection()` — field reads | Every frame, gates at 1s | ~4 property reads, ~4 assignments | Effectively free (the 1s gate returns immediately on 59 of 60 frames at 60fps) |
| `pollEndpoint()` — async fetch | Every frame, gates at 10s | ~0.1ms sync + async fetch (non-blocking) | The `await` does NOT block the render loop — `pollEndpoint` is fire-and-forget (no `await` in `update()`) |
| `computeJitter()` | Every frame | O(30) = ~30 arithmetic ops | ~0.01ms — trivial |
| `realTimeOfDay()` | Every frame | `new Date()` + arithmetic | ~0.005ms — `Date` constructor is fast |
| `detectTransitions()` | Every frame | 2 string comparisons | ~0.001ms |
| `packForCore()` | Every frame | `new Float32Array(13)` | ~0.02ms — 52 bytes, negligible GC (young-gen collection) |

**Total per-frame cost (amortized): < 0.03ms sync + fire-and-forget async fetch every 10s.**

The `pollEndpoint()` async fetch: the key design decision is that `update()` does NOT `await`
the fetch. Instead, `pollEndpoint()` fires the fetch and attaches a `.then()` callback that
updates `snap.endpointLatency` when it resolves. The render loop never blocks on network I/O.

```ts
// Correct — non-blocking:
private pollEndpoint(nowMs: number) {
  if (nowMs - this.lastEndpointPoll < 10000) return;
  this.lastEndpointPoll = nowMs;
  const t0 = performance.now();
  fetch('https://cloudflare.com/cdn-cgi/trace', { mode: 'no-cors', cache: 'no-store' })
    .then(() => { this.snap.endpointLatency = performance.now() - t0; })
    .catch(() => { /* keep last value */ });
}
```

### Memory characteristics
- `NetworkSnapshot`: 13 fields, plain object — ~200 bytes, allocated once at construction, mutated in-place
- `rttSamples`: `number[]`, max 30 elements — ~240 bytes
- `Float32Array(13)`: allocated once per frame for Rust upload — 52 bytes, young-gen GC
- `NetMapping` records: ~13 entries, each with a `compute` closure — ~5KB total, loaded once at boot
- **Total memory pressure: < 10KB, zero heap growth after boot.**

### What happens when the tab is backgrounded
- `requestAnimationFrame` stops firing (browser throttles background tabs).
- `setInterval`/`setTimeout` are throttled to ≤1Hz.
- `fetch()` may still complete but with reduced priority.
- **Result:** `update()` stops being called. Network metrics freeze at their last values.
  When the tab is foregrounded, `update()` resumes and metrics refresh within 1 frame.
  This is acceptable — the game pauses when backgrounded, so stale network data doesn't matter.

## Expanded system integration contracts

Each sim system that reads network params follows a strict contract. These are the exact
integration points — implementers should read these as the spec.

### Contract: `daynight.ts` — Real clock sync

```
INPUT:  net.get('timeOfDay') → number (0..1 fraction of day)
OUTPUT: state.clock.dayPhase → number (0..1, same scale)

WHEN:   every sim tick (before dayPhase is used for tint/spawn calculations)

LOGIC:
  const realFrac = net.get('timeOfDay');
  if (realFrac > 0) {  // 0 means "no real clock data" — shouldn't happen since fallback computes it
    // Smooth toward real time: lerp by 0.1 per sim tick to avoid visual jumps
    // (but snap on first tick or if difference > 0.5 — handle DST / timezone edge)
    const diff = realFrac - state.clock.dayPhase;
    if (Math.abs(diff) > 0.5 || state.clock.dayPhase === 0) {
      state.clock.dayPhase = realFrac;  // snap
    } else {
      state.clock.dayPhase += diff * 0.1;  // smooth
    }
  }
  // else: use existing fixed day-length cycle (CFG.dayLengthMs)
```

**Design decision:** smooth toward real time rather than snapping every frame. This prevents
the day/night cycle from jittering when the system clock changes by small amounts (NTP sync).
The 0.1 lerp factor means the game clock converges to real time within ~10 sim ticks (~1.7s
at 60fps) — fast enough to feel responsive, slow enough to avoid visual glitches.

### Contract: `economy.ts` — Gold rate scaling

```
INPUT:  net.get('downlink') → number (transform applied; output range [0.3, 2.0])
OUTPUT: goldPerTick → number (multiplied by the mapping)

WHEN:   every gold tick (CFG.goldTickMs interval — not every sim tick)

LOGIC:
  const goldMul = net.get('downlink');  // already transformed via NET_GAME_MAP['goldRate']
  const baseGold = CFG.goldPerTick;
  state.gold += baseGold * goldMul * dt;
```

### Contract: `hordes.ts` — Enemy scaling

```
INPUT:  net.get('effectiveType') → number (transform applied; output range [1.0, 3.0])
OUTPUT: enemy HP multiplier, enemy damage multiplier

WHEN:   on enemy spawn (applied once per enemy, not re-evaluated every tick)

LOGIC:
  const enemyMul = net.get('effectiveType');  // already transformed via NET_GAME_MAP['enemyScale']
  enemy.maxHp = Math.round(baseHp * enemyMul);
  enemy.damage = Math.round(baseDmg * enemyMul);
```

**Design decision:** scaling is applied at spawn time, not continuously. This means an enemy
that spawns during a 2g period stays tough even if the connection improves to 4g. This is
intentional — it creates "scarred" enemies that carry the memory of bad network conditions.
(N2 can add visual indicators — "2g-scarred" enemies with glitchy particle auras.)

### Contract: `rules.ts` / sim loop — Sim speed

```
INPUT:  net.get('rtt') → number (transform applied; output range [0.3, 2.0])
OUTPUT: effective STEP duration → number (ms per sim tick, multiplied by mapping)

WHEN:   every sim tick, before systems run

LOGIC:
  const simMul = net.get('rtt');  // already transformed via NET_GAME_MAP['simSpeed']
  // simMul < 1.0 = slow motion (high RTT), simMul > 1.0 = fast motion (low RTT)
  // Apply as a multiplier to the fixed STEP duration:
  const effectiveDt = STEP * simMul;
```

**Design decision:** RTT drives sim speed multiplicatively. High RTT → slow sim (easier, more
time to react). This is "lag compensation as a game mechanic" — instead of the game feeling
sluggish on bad connections (which it would if we did nothing), we deliberately slow the sim
to give the player MORE time. This inverts the typical frustration of lag into a deliberate
gameplay affordance. The narrative: "Your connection is struggling, so the realm slows to
match your pace."

### Contract: `log.ts` — Network event logging

```
INPUT:  NetworkSystem emits events: 'transition' (type change), 'online', 'offline'
OUTPUT: LogEntry with kind: 'network', pushed to the event ring-buffer

WHEN:   on transition detection (debounced — see below)

LOGIC:
  // In NetworkSystem.detectTransitions():
  if (typeChanged && typeStableFor >= 5000) {
    logSystem.push({
      kind: 'network',
      message: `Realm shifted: ${lastType} → ${newType}`,
      color: 0x00FFAA,  // cyan for network events
    });
  }
```

### Transition debouncing spec

The `detectTransitions()` method must debounce connection-type changes to prevent flapping:

```
ALGORITHM:
  On each call:
    1. Read current type from navigator.connection.type (or fallback 'unknown')
    2. If type differs from lastKnownType:
       a. If pendingTransition is null → set pendingTransition = { from: lastKnownType, to: type, since: nowMs }
       b. If pendingTransition.to === type → do nothing (still waiting for stability)
       c. If pendingTransition.to !== type → reset pendingTransition (type changed AGAIN during debounce window)
    3. If pendingTransition is set AND (nowMs - pendingTransition.since) >= 5000:
       a. Commit: lastKnownType = pendingTransition.to
       b. Fire transition event: { from: pendingTransition.from, to: pendingTransition.to }
       c. Clear pendingTransition
    4. If type === lastKnownType AND pendingTransition is set:
       a. Cancel: clear pendingTransition (type reverted during debounce window)

SPECIAL RULES:
  - 'unknown' → 'wifi' or 'wifi' → 'unknown': IGNORE. These are spurious. Only commit when
    transitioning between known types (ethernet, wifi, cellular).
  - 'wifi' ↔ 'ethernet': debounce 5s (wired connections are stable — this is a real change).
  - 'wifi' ↔ 'cellular': debounce 5s (hotspot on/off).
  - Any → offline: IMMEDIATE (don't debounce — going offline is unambiguous).
  - Offline → Any: debounce 3s (reconnection may flap briefly).
```

## Rust layout — exact byte specification

The `Float32Array` layout for `set_network_params()` is a contract between TS and Rust.
Both sides must agree on indices. This is the authoritative layout:

```
Index  | Field              | Type  | Range / Notes
-------|--------------------|-------|------------------
0      | rtt                | f32   | 1..5000 ms, clamped
1      | downlink           | f32   | 0.1..1000 Mbps, clamped
2      | jitter             | f32   | 0..500 ms (MAD of RTT samples)
3      | effectiveTier      | f32   | 1.0=4g, 2.0=3g, 3.0=2g, 4.0=slow-2g
4      | connectionRealm    | f32   | 0.0=ethernet, 1.0=wifi, 2.0=cellular
5      | online             | f32   | 0.0=offline, 1.0=online
6      | timeOfDay          | f32   | 0.0..1.0 (midnight..midnight)
7      | cpuCores           | f32   | 1..64 (logical cores, may be capped)
8      | deviceMemory       | f32   | 0.25, 0.5, 1, 2, 4, 8 (GB, rounded by browser)
9      | endpointLatency    | f32   | 1..5000 ms
10     | pageDnsTime        | f32   | 0..5000 ms (0 = no data)
11     | pageTlsTime        | f32   | 0..5000 ms (0 = no data or no TLS)
12     | pageTtfb           | f32   | 0..5000 ms
-------|--------------------|-------|------------------
TOTAL: 13 × 4 bytes = 52 bytes
```

The Rust side receives a `&[f32]` slice. Accessors use `.get(index).copied().unwrap_or(fallback)`.
The fallback is the same value documented in the metrics table above. This means if TS sends a
shorter array (future-proofing), Rust handles it gracefully.

### Rust test additions (N1)

In addition to the existing R0–R2 tests, add these in `lib.rs`:

```rust
#[test]
fn network_params_default_on_fresh_core() {
    let mut core = Core::new(12345, 4096, 16);
    // Before any upload, accessors return fallbacks
    assert_eq!(core.net_rtt(), 50.0);
    assert_eq!(core.net_downlink(), 10.0);
    assert_eq!(core.net_online(), 1.0);
}

#[test]
fn network_params_upload_and_readback() {
    let mut core = Core::new(12345, 4096, 16);
    let params: Vec<f32> = vec![
        45.0, 12.5, 3.2, 1.0, 0.0, 1.0, 0.5,
        8.0, 16.0, 28.0, 5.0, 15.0, 42.0,
    ];
    core.set_network_params(&params);
    assert_eq!(core.net_rtt(), 45.0);
    assert_eq!(core.net_downlink(), 12.5);
    assert_eq!(core.net_jitter(), 3.2);
    assert_eq!(core.net_time_of_day(), 0.5);
}

#[test]
fn network_params_short_slice_uses_fallbacks() {
    let mut core = Core::new(12345, 4096, 16);
    // Simulate old TS client sending only 5 params
    core.set_network_params(&[10.0, 20.0, 30.0, 1.0, 0.0]);
    assert_eq!(core.net_rtt(), 10.0);         // index 0 — present
    assert_eq!(core.net_downlink(), 20.0);     // index 1 — present
    assert_eq!(core.net_time_of_day(), 0.0);   // index 6 — missing, fallback
    assert_eq!(core.net_page_ttfb(), 50.0);    // index 12 — missing, fallback
}
```

These tests are backward-compatible — they don't touch any existing sim logic. They verify
only the data upload/readback contract.

```ts
/** One network→game mapping. Every field is a function from the current NetworkSnapshot
 *  to a game-visible value. Adding a mapping is a row edit — never engine code. */
export interface NetMapping {
  /** Key in `NW.NET.*` — the live value players see and systems read. */
  key: string;
  /** Human-readable label for the HUD / debug panel. */
  label: string;
  /** Compute the value from a snapshot. Returns a number (game-visible). */
  compute: (s: NetworkSnapshot) => number;
  /** Fallback when the source metric is unavailable (e.g. Firefox). */
  fallback: number;
  /** Unit string for display (e.g. "ms", "Mbps", "×"). */
  unit: string;
  /** How often this metric should be re-sampled (ms). 0 = once at boot. */
  intervalMs: number;
}

export interface NetworkSnapshot {
  /** Estimated round-trip time (ms). From navigator.connection.rtt, or fetch-timing. */
  rtt: number;
  /** Estimated downlink bandwidth (Mbps). From navigator.connection.downlink. */
  downlink: number;
  /** Connection type: 'ethernet' | 'wifi' | 'cellular' | 'unknown'. */
  connectionType: string;
  /** Effective connection type: '4g' | '3g' | '2g' | 'slow-2g' | 'unknown'. */
  effectiveType: string;
  /** RTT variance (ms) — computed from the last N fetch samples. */
  jitter: number;
  /** Is the browser currently online? */
  online: boolean;
  /** Real-world time of day as a fraction 0..1 (0 = midnight, 0.5 = noon). */
  timeOfDay: number;
  /** Logical CPU cores. From navigator.hardwareConcurrency. */
  cpuCores: number;
  /** Device RAM in GB (rounded). From navigator.deviceMemory. */
  deviceMemory: number;
  /** Latency to a well-known endpoint (ms). e.g., fetch https://cloudflare.com/cdn-cgi/trace. */
  endpointLatency: number;
  /** Page load DNS time (ms). From performance.getEntriesByType('navigation'). */
  pageDnsTime: number;
  /** Page load TLS handshake time (ms). */
  pageTlsTime: number;
  /** Page load TTFB (ms). */
  pageTtfb: number;
}

/** The live network stats store — exposed as window.NW.NET. */
export interface LiveNetState {
  /** Current snapshot (updated at ~1 Hz for most metrics, on-demand for RTT timing). */
  snap: NetworkSnapshot;
  /** All registered mappings, keyed by .key. */
  mappings: Record<string, NetMapping>;
  /** Get a mapped game value by key — systems read this, not the raw snapshot. */
  get(key: string): number;
}
```

### Initial mappings (the ones that ship in N1)

| key | label | compute | fallback | unit | intervalMs |
|-----|-------|---------|----------|------|------------|
| `rtt` | RTT | `s.rtt` | 50 | ms | 1000 |
| `downlink` | Bandwidth | `s.downlink` | 10 | Mbps | 2000 |
| `jitter` | Jitter | `s.jitter` | 5 | ms | 1000 |
| `effectiveType` | Connection Tier | `{ '4g':1, '3g':2, '2g':3, 'slow-2g':4, 'unknown':1 }[s.effectiveType]` | 1 | tier | 5000 |
| `connectionType` | Realm | `{ 'ethernet':0, 'wifi':1, 'cellular':2, 'unknown':0 }[s.connectionType]` | 0 | — | 10000 |
| `online` | Online | `s.online ? 1 : 0` | 1 | — | 5000 |
| `timeOfDay` | Real Clock | `s.timeOfDay` | computed | frac | 60000 |
| `cpuCores` | CPU Cores | `s.cpuCores` | 4 | cores | 0 |
| `deviceMemory` | RAM | `s.deviceMemory` | 4 | GB | 0 |
| `endpointLatency` | Endpoint RTT | `s.endpointLatency` | 30 | ms | 10000 |
| `pageDnsTime` | Page DNS | `s.pageDnsTime` | 10 | ms | 0 |
| `pageTlsTime` | Page TLS | `s.pageTlsTime` | 20 | ms | 0 |
| `pageTtfb` | Page TTFB | `s.pageTtfb` | 50 | ms | 0 |

### Game system mappings (the actual gameplay effects — also data rows in a second table)

```ts
export interface NetGameMapping {
  /** Human label for debug UI. */
  label: string;
  /** Which net mapping key drives this. */
  netKey: string;
  /** Transform function: netValue (from get(netKey)) → game value.
   *  e.g., rttMs → simSpeedMultiplier. */
  transform: (netValue: number) => number;
  /** Target game param path (e.g., 'simSpeed', 'goldRate'). Written into CFG-equivalent. */
  target: string;
  /** Minimum allowed output (guardrail). */
  min: number;
  /** Maximum allowed output (guardrail). */
  max: number;
}

export const NET_GAME_MAP: NetGameMapping[] = [
  {
    label: 'Sim Speed',
    netKey: 'rtt',
    // High RTT = slow sim (lag compensation). 50ms RTT = 1×, 500ms = 0.5×.
    transform: (rtt: number) => Math.max(0.3, Math.min(2.0, 50 / Math.max(rtt, 10))),
    target: 'simSpeed',
    min: 0.3,
    max: 2.0,
  },
  {
    label: 'Gold Rate',
    netKey: 'downlink',
    // More bandwidth = more gold. 10 Mbps = 1×, 1 Mbps = 0.5×, 50 Mbps = 1.5×.
    transform: (dl: number) => Math.max(0.3, Math.min(2.0, 0.5 + dl / 20)),
    target: 'goldRate',
    min: 0.3,
    max: 2.0,
  },
  {
    label: 'Enemy Scaling',
    netKey: 'effectiveType',
    // Worse connection = harder enemies. 4g=1×, 3g=1.4×, 2g=2×.
    transform: (tier: number) => 0.6 + tier * 0.4,
    target: 'enemyScale',
    min: 1.0,
    max: 3.0,
  },
  {
    label: 'Day/Night Sync',
    netKey: 'timeOfDay',
    // Syncs sim clock to real time. fraction 0..1 maps to in-game day cycle.
    transform: (frac: number) => frac,
    target: 'dayPhase',
    min: 0,
    max: 1,
  },
  {
    label: 'Connection Realm',
    netKey: 'connectionType',
    // Ethernet=0 (stable), WiFi=1 (wild), Cellular=2 (chaos). Affects biome/event tables.
    transform: (v: number) => v,
    target: 'realmType',
    min: 0,
    max: 2,
  },
];
```

## `src/game/systems/network.ts` (NEW) — NetworkSystem

```ts
import { CFG } from '../data/config';
import { NetworkSnapshot, NET_GAME_MAP, type NetMapping, type LiveNetState } from '../data/network';

export class NetworkSystem {
  snap: NetworkSnapshot;
  mappings: Record<string, NetMapping>;
  private rttSamples: number[] = [];
  private lastFetchMs = 0;
  private lastConnectionType = '';
  private lastOnline = true;

  constructor() {
    this.snap = this.freshSnapshot();
    this.mappings = {}; // populated by registerMappings()
    this.registerMappings();
  }

  /** Called once per sim frame — polls slow metrics on their interval. */
  update(nowMs: number) {
    // poll navigator.connection every ~1s
    this.pollConnection(nowMs);
    // poll endpoint latency every ~10s
    this.pollEndpoint(nowMs);
    // compute jitter from the last N RTT samples
    this.computeJitter();
    // update time-of-day (cheap — no interval needed)
    this.snap.timeOfDay = this.realTimeOfDay();
    // detect connection type changes → push log event
    this.detectTransitions(nowMs);
  }

  private freshSnapshot(): NetworkSnapshot {
    const con = (navigator as any).connection;
    const nav = performance.getEntriesByType('navigation')[0] as any;
    return {
      rtt: con?.rtt ?? 50,
      downlink: con?.downlink ?? 10,
      connectionType: con?.type ?? 'unknown',
      effectiveType: con?.effectiveType ?? '4g',
      jitter: 5,
      online: navigator.onLine,
      timeOfDay: this.realTimeOfDay(),
      cpuCores: navigator.hardwareConcurrency ?? 4,
      deviceMemory: (navigator as any).deviceMemory ?? 4,
      endpointLatency: 30,
      pageDnsTime: nav?.domainLookupEnd - nav?.domainLookupStart ?? 10,
      pageTlsTime: nav?.connectEnd - nav?.secureConnectionStart ?? 20,
      pageTtfb: nav?.responseStart - nav?.requestStart ?? 50,
    };
  }

  private realTimeOfDay(): number {
    const d = new Date();
    return (d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds()) / 86400;
  }

  private pollConnection(nowMs: number) {
    if (nowMs - this.lastFetchMs < 1000) return;
    this.lastFetchMs = nowMs;
    const con = (navigator as any).connection;
    if (con) {
      this.snap.rtt = con.rtt ?? this.snap.rtt;
      this.snap.downlink = con.downlink ?? this.snap.downlink;
      this.snap.connectionType = con.type ?? this.snap.connectionType;
      this.snap.effectiveType = con.effectiveType ?? this.snap.effectiveType;
      // sample RTT into the ring buffer for jitter computation
      this.rttSamples.push(this.snap.rtt);
      if (this.rttSamples.length > 30) this.rttSamples.shift();
    }
  }

  private async pollEndpoint(nowMs: number) {
    if (nowMs - this.lastFetchMs < 10000) return;
    this.lastFetchMs = nowMs;
    try {
      const t0 = performance.now();
      await fetch('https://cloudflare.com/cdn-cgi/trace', { mode: 'no-cors', cache: 'no-store' });
      this.snap.endpointLatency = performance.now() - t0;
    } catch { /* offline — endpointLatency keeps its last value */ }
    // also track RTT via the successful fetch
    this.rttSamples.push(this.snap.endpointLatency);
    if (this.rttSamples.length > 30) this.rttSamples.shift();
  }

  private computeJitter() {
    if (this.rttSamples.length < 3) return;
    let sum = 0;
    for (let i = 1; i < this.rttSamples.length; i++) {
      sum += Math.abs(this.rttSamples[i] - this.rttSamples[i - 1]);
    }
    this.snap.jitter = sum / (this.rttSamples.length - 1);
  }

  private detectTransitions(nowMs: number) {
    const con = (navigator as any).connection;
    const type = con?.type ?? 'unknown';
    const online = navigator.onLine;
    if (type !== this.lastConnectionType) {
      // connection type changed — "rift" event for N2, log event for now
      this.lastConnectionType = type;
    }
    if (online !== this.lastOnline) {
      this.lastOnline = online;
      this.snap.online = online;
    }
  }

  // ---- public API ----

  get(key: string): number {
    const m = this.mappings[key];
    if (!m) return 0;
    try { return m.compute(this.snap); } catch { return m.fallback; }
  }

  /** Push the current snap to the Rust core as a flat Float32Array — same pattern
   *  as pushMaterials() / pushFireParams(). The core stores it for sim-side reads. */
  packForCore(): Float32Array {
    const s = this.snap;
    // layout: [rtt, downlink, jitter, effectiveTier, connectionType, online, timeOfDay,
    //          cpuCores, deviceMemory, endpointLatency, pageDnsTime, pageTlsTime, pageTtfb]
    const tier = { '4g':1, '3g':2, '2g':3, 'slow-2g':4, 'unknown':1 }[s.effectiveType] ?? 1;
    const realm = { 'ethernet':0, 'wifi':1, 'cellular':2, 'unknown':0 }[s.connectionType] ?? 0;
    return new Float32Array([
      s.rtt, s.downlink, s.jitter, tier, realm, s.online ? 1 : 0, s.timeOfDay,
      s.cpuCores, s.deviceMemory, s.endpointLatency, s.pageDnsTime, s.pageTlsTime, s.pageTtfb,
    ]);
  }

  private registerMappings() {
    // Mappings are defined in network.ts data table — this populates the lookup.
    // (Imported at module init.)
  }
}
```

## Rust — `nightward-core` additions

A single new method on `Core`, following the exact `set_materials`/`set_fire_params` pattern:

```rust
// New field on Core:
net_params: Vec<f32>,   // uploaded network snapshot, 13 floats (see layout above)

pub fn set_network_params(&mut self, p: &[f32]) {
    self.net_params = p.to_vec();
}

// Individual accessors — used by sim systems that need network data
fn net_rtt(&self) -> f32 { self.net_params.get(0).copied().unwrap_or(50.0) }
fn net_downlink(&self) -> f32 { self.net_params.get(1).copied().unwrap_or(10.0) }
fn net_jitter(&self) -> f32 { self.net_params.get(2).copied().unwrap_or(5.0) }
// ...etc for all 13 fields
```

**For N1, the core does NOTHING with these values yet.** The accessors exist so N3
(Living Network — where fire/wetness read network metrics) can use them without a
second Rust edit. The field is uploaded but unused — exactly like `fire_params` was
in R1 before R2 filled in `tick()`.

## TS integration

**`src/wasm/core.ts`**: no changes needed (the `set_network_params` call goes through
the existing `Core` class, wasm-bindgen handles it).

**`src/game/world/core.ts` (`WorldCore`)** — new passthrough:
```ts
pushNetworkParams() { this.core.set_network_params(net.packForCore()); }
```

**`main.ts`** — boot order addition + frame wiring:
```ts
// After all system construction, before the game loop:
const net = new NetworkSystem();
(window as any).NW.NET = net; // live-tweakable at runtime
ctx.net = net;

// In render(), once per frame (not once per sim step — network polling is
// wall-clock-driven, not sim-tick-driven):
net.update(performance.now());
worldCore.pushNetworkParams();

// Apply the game mappings — these override CFG values multiplicatively:
// (Do this in the sim step, reading from net, so it's deterministic per tick.)
// Context reads e.g. net.get('rtt') → transforms → multiplies gold rate, enemy scale, etc.
```

**`window.NW.NET`** surface:
```ts
// The NetworkSystem instance, plus the mappings table:
NW.NET = {
  snap: net.snap,        // the raw snapshot
  get: (k) => net.get(k), // mapped game value
  mappings: NET_GAME_MAP,  // the data rows — editable!
};
// Players can live-tune: NW.NET.mappings[0].transform = (rtt) => ...
```

**HUD**: a small semi-transparent readout in the top-left corner (3 lines, fixed-width
font, toggled via a new `I` hotkey — "info"):

```
RTT  45 ms  │  ↓10.2 Mbps  │  🛜 wifi  4g
Sim  0.91×  │  Gold 1.01×   │  Enemies 1.00×
```

Styled with the existing RPGUI font (Press Start 2P at ~8px). This is the ONLY new
rendering in N1. No new sprites, no new chunk passes, no overlays.

## Systems that read network params (N1)

The sim systems read `net.get(key)` to apply the mappings. The integration points:

- **`daynight.ts`**: if `net.get('timeOfDay')` is available (>0), use it to set
  `state.clock`'s day phase offset so the in-game clock syncs to real time.
  Otherwise, use the existing fixed day-length cycle.
- **`economy.ts`**: multiply tribute gold tick by `net.get('downlink')` transform
  (the `goldRate` mapping).
- **`hordes.ts`**: multiply enemy HP/damage by `net.get('effectiveType')` transform
  (the `enemyScale` mapping).
- **`rules.ts`** or **`main.ts`** sim loop: multiply `STEP` by `net.get('rtt')` transform
  (the `simSpeed` mapping) — this is the "lag compensation as game mechanic" effect.
- **`log.ts`**: when `connectionType` or `online` transitions, push a log event
  (new `'network'` LogKind + UI color for it — cyan/lime).

## Explicitly OUT of scope
- No new biomes, materials, or content — that's N2.
- No visual effects for network events — N2.
- No HUD beyond the 3-line info readout — G1 adds the full debug panel.
- No Rust sim changes that USE the network params — N3.
- No local agent — A1.
- No `navigator.connection` polyfill for Firefox — the fallback defaults ARE the polyfill.

## Acceptance checklist (post-merge verification)

Static, in the worktree:
1. `npm run wasm` + `npm run typecheck` + `npm run build` green.
2. `cargo test` — all existing R1+R2 tests still pass; `Core` accepts `set_network_params`
   without panicking; accessors return defaults when no params uploaded.

Live on main, at `?seed=1234`:
3. **`NW.NET` exists:** `typeof NW.NET.get === 'function'` → true.
4. **Info HUD visible:** press `I` → 3-line network readout appears top-left; press again → hides.
5. **RTT drives sim speed:** inject `NW.NET.mappings.find(m=>m.netKey==='rtt').transform = () => 0.5` →
   sim visibly runs at half speed (observe `__nw.state.clock` advance rate vs. wall clock).
6. **Downlink drives gold:** inject `NW.NET.mappings.find(m=>m.netKey==='downlink').transform = () => 2.0` →
   gold ticks at 2× the rate.
7. **Effective type scales enemies:** inject `NW.NET.mappings.find(m=>m.netKey==='effectiveType').transform = () => 3.0` →
   spawned foe HP/dmg = 3× baseline.
8. **Real clock syncs day/night:** assert `net.snap.timeOfDay` is within ±0.01 of the actual
   wall-clock fraction at the moment of check.
9. **Connection transition logs:** manually set `net.snap.connectionType = 'cellular'` (trigger the
   detection path) → a `'network'` log event appears in the event log.
10. **Offline fallback:** `net.snap.online = false` → game still runs, gold/enemies use fallback
    defaults (observe no NaN/undefined in the HUD readout).
11. **Graceful degradation (Firefox):** simulate by deleting `(navigator as any).connection` before
    constructing `NetworkSystem` → `snap.rtt === 50` (fallback), `snap.downlink === 10` (fallback),
    game runs normally.
12. **Live re-upload:** edit `NW.NET.mappings` entries → changes take effect next sim tick, no reload.
    `worldCore.pushNetworkParams()` pushes a fresh `Float32Array` each frame; verify via
    `__nw.core.net_params` (expose the underlying wasm field on `WorldCore` for this check).
