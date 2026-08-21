# N4 — The Deep Wire

> **Status:** N4.0 SHIPPED 2026-08-17. N4.1–N4.7 planned, not implemented.
> **Written:** 2026-08-17
> **Supersedes nothing.** Extends N1 → N2a → N2b → N3 (all shipped).
> **Depends on:** nothing. Touches `data/network.ts`, `systems/network.ts`, `main.ts` (Lens),
> plus new files. Does **not** overlap Batch B / B5's file set, so it can run in parallel
> with them.

---

## 0. The ask

User direction, verbatim (2026-08-17):

> *"lets work on the networking panel (cant remember our name for it right now). side cart
> style, the game itself is a network testing tool right, it tries to determine as much
> information as possible about the environment it is in — whether local stuff executed in
> the browser execution space we running, or whether it hits some api that provides
> additional information about the caller (itself in this case). in addition and on top of
> the previous is the tests that are run over time, the stats in regards to changes in
> pings, latency, download, upload, etc. go absolutely crazy with the research… so our
> immediate todos are networking expansion then linking new networking stuff into the game
> loop somehow"*

Four distinct asks, and they are not the same thing:

1. **Panel → side cart.** The Lens is currently a centred modal that covers the game.
2. **Local environment interrogation.** What can be learned *without* leaving the browser.
3. **Remote interrogation.** What a third party can tell us about the caller — us.
4. **Tests over time.** Not instantaneous readings: *series*, *trends*, *deltas*. Ping,
   latency, download, upload, measured repeatedly, with the change being the interesting
   part.

The panel is named **The Lens** (`O` key). GDD §4.4.

---

## 1. Where we actually are

Honest audit of what ships today, because half of this plan is admitting the current
implementation is shallower than the GDD claims.

| Claim | Reality |
|---|---|
| "19 tracked metrics" | True, but ~7 of them are `navigator.*` static reads and 3 are page-load timings captured once at boot and never refreshed. |
| "Beacon echoes measure latency" | They measure `fetch()` wall-clock to `mode: 'no-cors'` favicons. That number includes DNS + TCP + TLS + request + response + **browser queueing and main-thread scheduling**. It is not latency. On a cold route it is dominated by handshakes; on a warm one, by the event loop. |
| "Download/bandwidth" | `navigator.connection.downlink`, which Chrome **caps at 10 Mbps** and quantises, and which Firefox and Safari do not implement at all. We have never measured throughput. |
| "Upload" | Not measured. At all. Nothing in the codebase uploads a byte. |
| "Jitter" | Computed from `connection.rtt` deltas — a value Chrome quantises to **25 ms buckets**. Its jitter is therefore almost always 0 or 25. `echoJitter` (same-beacon fetch deltas) is the better of the two and is the one worth keeping. |
| "Packet loss" | Not measured, and the ROADMAP lists it under *"what we CANNOT get from a browser."* **This turns out to be wrong — see §2.1.** |
| "DNS resolution time → Scrying" | Listed in the ROADMAP's design-reference table. Never implemented. There is no DNS code in the repo. |
| History | `historyRtt` / `historyJitter` / `historyBw` — three arrays, 60 samples each, 1 Hz, ring-buffered. 60 seconds of memory in a 15-minute run, and `drawSparkline()` exists but **is never called**. |

So the honest summary: **we have a wide, well-structured mapping layer sitting on top of a
thin and partly fictional measurement layer.** The mapping architecture (`NET_METRICS` →
`NET_GAME_MAP` data rows, live-editable) is genuinely good and N4 should not touch its
shape. What N4 replaces is what feeds it.

---

## 2. Research — verified, with evidence

Everything below was checked against the live internet on 2026-08-17 with `curl`, not
recalled. Response headers are quoted verbatim. Anything I could not verify from a terminal
is marked **[verify in browser]** and carries a fallback.

### 2.1 The headline: Cloudflare hands us the kernel's TCP state

`https://speed.cloudflare.com/__down?bytes=N` responds with:

```
HTTP/1.1 200 OK
Access-Control-Allow-Origin: *
timing-allow-origin: *
access-control-expose-headers: server-timing, content-length, cf-meta-ip,
  cf-meta-request-time, cf-meta-colo, cf-meta-asn, cf-meta-country, cf-meta-city,
  cf-meta-postalCode, cf-meta-latitude, cf-meta-longitude, cf-meta-timezone
Server-Timing: cfSpeedEdge;dur=4, cfSpeedWorker;dur=29
server-timing: cfL4;desc="?proto=TCP&rtt=2915&min_rtt=2372&rtt_var=1277&sent=4&recv=6
  &lost=0&retrans=0&sent_bytes=2838&recv_bytes=660&delivery_rate=1214165&cwnd=52
  &unsent_bytes=0&cid=a3b0a8b4484ce02d&ts=46&x=0"
cf-meta-ip: 169.0.120.158
```

That `cfL4` description is **the edge server's kernel TCP socket statistics** — effectively
a `TCP_INFO` dump for our own connection:

| Field | Meaning | Why it matters here |
|---|---|---|
| `rtt` | Smoothed RTT, **microseconds** | 2915 µs = 2.9 ms. Not a 25 ms bucket. Real precision. |
| `min_rtt` | Lowest RTT seen on this socket | The path's true floor — its physical distance cost. |
| `rtt_var` | RTT variance | **Real jitter**, measured by a kernel, not inferred from fetch noise. |
| `lost` | Packets the kernel considers lost | **Packet loss. From a browser.** |
| `retrans` | Retransmissions | The single best "this network is unwell" signal available. |
| `delivery_rate` | Bytes/sec the socket achieved | A real throughput estimate, uncapped. |
| `cwnd` | Congestion window (segments) | How much the path will currently accept in flight. |
| `sent` / `recv` / `sent_bytes` / `recv_bytes` | Packet and byte counters | Lets us derive per-packet efficiency. |

Two independent ways to read it, **both confirmed available**:

- `server-timing` is in `access-control-expose-headers`, so
  `(await fetch(url)).headers.get('server-timing')` returns it.
- `timing-allow-origin: *` is set, so the same data appears on
  `PerformanceResourceTiming.serverTiming` as a `PerformanceServerTiming` entry
  (`{name: 'cfL4', description: '?proto=TCP&rtt=...'}`), **and** the full timing waterfall
  (`domainLookupStart/End`, `connectStart/End`, `secureConnectionStart`, `requestStart`,
  `responseStart`, `transferSize`, `encodedBodySize`, `nextHopProtocol`) becomes readable
  for this cross-origin resource instead of being zeroed.

This one endpoint is the difference between *"the game guesses at your network"* and
*"the game reads your network."* **It should become the spine of the whole system.**

> **Correction to record in the ROADMAP.** The line under *"What we CANNOT get from a
> browser"* implies packet loss and true RTT need a local agent. For any path terminating
> at a Cloudflare edge that exposes `cfL4`, they do not. ICMP, pcap, ARP, LAN enumeration
> and WiFi dBm remain genuinely impossible — that part stands.

### 2.2 Real download and upload

Both verified working with permissive CORS **and** TAO:

- **Download:** `GET https://speed.cloudflare.com/__down?bytes=N` → `N` bytes of
  `application/octet-stream`.
- **Upload:** `POST https://speed.cloudflare.com/__up` with a binary body. Verified with a
  200 KB body; the response's `cfL4` reported `recv_bytes=200983`, confirming the edge
  actually received and accounted for the payload.

  ```
  server-timing: cfL4;desc="?proto=TCP&rtt=3392&min_rtt=2975&rtt_var=1950&sent=44
    &recv=151&lost=0&retrans=0&sent_bytes=2838&recv_bytes=200983
    &delivery_rate=456201&cwnd=52&unsent_bytes=0"
  ```

Measured *properly* — which means: subtract TTFB from total, so we time the **body
transfer**, not the handshake; and read the body through a `ReadableStream` so we can see
the throughput *ramp* (TCP slow-start is visible as a rising curve) rather than a single
averaged scalar. The ramp shape is itself diagnostic: a curve that rises and plateaus is a
healthy path; one that rises and collapses is a congested or shaped one.

**This is the direct answer to "download, upload" in the ask.** It is also the single
riskiest thing in this plan, because it spends the player's data — see §6.1.

### 2.3 Real DNS, from the browser

Both major DoH resolvers are CORS-open. Verified:

```
$ curl -H "Accept: application/dns-json" \
    "https://cloudflare-dns.com/dns-query?name=github.com&type=A"
{"Status":0,"TC":false,"RD":true,"RA":true,"AD":false,"CD":false,
 "Question":[{"name":"github.com","type":1}],
 "Answer":[{"name":"github.com","type":1,"TTL":8,"data":"20.87.245.0"}]}
```

- `https://cloudflare-dns.com/dns-query?name=…&type=…` — needs
  `Accept: application/dns-json`. (`ct=` as a query param returns 400; the header is the
  working form. Both return `Access-Control-Allow-Origin: *`.)
- `https://dns.google/resolve?name=…&type=…` — plain JSON, `Access-Control-Allow-Origin: *`.

What this unlocks, all of it real:

- **Resolver race.** Ask both resolvers the same question and compare latency and answers.
  Divergent answers are a genuine signal (CDN geo-steering, or DNS interception).
- **`AD` flag** — DNSSEC-authenticated. A real trust property of the answer.
- **`TTL`** — how long the record lives. Short TTLs mean an actively-steered CDN.
- **Record types beyond A:** `AAAA` (does this host have IPv6?), `MX`, `TXT`, `NS`, `CAA`,
  and `PTR` for **reverse DNS on our own public IP** — which frequently reveals the ISP's
  internal naming, geography and access technology in the hostname itself
  (`…dsl…`, `…fibre…`, `…lte…`, city codes).
- Resolving each beacon's hostname gives us **the actual IP we're talking to**, which turns
  the abstract beacon list into a real routing picture.

This closes an item the ROADMAP has carried unimplemented since N1: *"DNS resolution time →
Scrying skill — reveals map by resolving domains."*

### 2.4 The `Timing-Allow-Origin` split — why current beacons are weak

Checked TAO on every host the game currently probes and on some candidates:

| Host | `Timing-Allow-Origin` | Consequence |
|---|---|---|
| `speed.cloudflare.com` | **`*`** | Full waterfall + `serverTiming` |
| `cdnjs.cloudflare.com` | **`*`** | Full waterfall |
| `cdn.jsdelivr.net` | **`*`** | Full waterfall |
| `www.microsoft.com/favicon.ico` | *(absent)* | Duration only |
| `www.bbc.co.uk/favicon.ico` | *(absent)* | Duration only |
| `www.baidu.com/favicon.ico` | *(absent)* | Duration only |
| `www.lemonde.fr/favicon.ico` | *(absent)* | Duration only |

So the fourteen favicon beacons can **never** give a DNS/TCP/TLS breakdown, no matter how
we time them — the browser deliberately zeroes those fields without TAO. They remain useful
as coarse geographic reachability probes and as the *discovery* mechanic, and that is fine;
but the precise instrumentation has to route through TAO-enabled hosts.

Practical consequence: **two tiers of beacon.** *Deep* beacons (TAO, full waterfall,
`cfL4` where available) for measurement; *shallow* beacons (the existing favicon pool,
duration only) for geographic flavour and discovery. The Lens should visibly distinguish
them rather than presenting both as equally trustworthy — the whole point of the panel is
that it does not lie.

### 2.5 Identity, consolidated — and `ipapi.co` retired

`cf-meta-ip: 169.0.120.158` came back on the `__down` response. The exposed-header list
also promises `cf-meta-colo`, `-asn`, `-country`, `-city`, `-postalCode`, `-latitude`,
`-longitude`, `-timezone`.

**[verify in browser]** — in my terminal probe only `cf-meta-ip` and `cf-meta-request-time`
carried values; the geo fields were advertised but empty, and `https://speed.cloudflare.com/meta`
returned `{}`. That may be a UA/path artefact of curl. First implementation task is to
confirm from a real browser.

- **If the geo fields populate:** one request replaces *both* `api.ipify.org` **and**
  `ipapi.co/json/`, and does it as a side effect of a measurement we already want. That
  removes the endpoint that has been throwing **429** and failing QA runs, and cuts the
  third-party surface.
- **If they do not:** IP still comes from `cf-meta-ip`, country and colo from
  `cloudflare.com/cdn-cgi/trace` (already in use). Only city/ASN/ISP would need `ipapi.co`,
  and that should then become **explicitly opt-in** rather than firing on first explore.

Either way `api.ipify.org` is redundant and should go.

### 2.6 The UDP path — WebRTC / STUN

Everything above measures TCP over HTTPS. A STUN binding request via `RTCPeerConnection` is
**UDP**, and takes a different path through the same network. That difference is the point:

- **`srflx` ICE candidate** → public IP and the **source port** the NAT allocated. Compare
  that IP to the HTTP-derived one; a mismatch is a strong proxy/split-tunnel tell.
- **NAT behaviour.** Gather candidates against two different STUN servers. Same external
  port for both ⇒ cone NAT; different ports ⇒ **symmetric NAT**. Real, classifiable,
  meaningful.
- **IPv6.** Whether an IPv6 candidate appears at all is the cleanest available answer to
  "does this machine have working v6?"
- **`getStats()`** → `candidate-pair.currentRoundTripTime` = genuine UDP RTT.
- **mDNS caveat (important, do not plan around it):** modern browsers replace local host
  candidates with randomised `*.local` mDNS names unless media permission is granted. We
  will **not** ask for camera/mic. So LAN IPs stay hidden — correct behaviour, and we
  should say so in the panel instead of pretending.

Public STUN: `stun:stun.l.google.com:19302`, `stun:stun.cloudflare.com:3478`. No permission
prompt, no media, no data channel needed — candidate gathering alone is enough.

### 2.7 Local interrogation — no packets required

The "what can we learn inside the browser's own execution space" half of the ask. All of
these are permission-free:

| Probe | API | Yields |
|---|---|---|
| **OS / arch / bitness** | `navigator.userAgentData.getHighEntropyValues(['platform','platformVersion','architecture','bitness','model','fullVersionList'])` | Far more than the UA string we parse today. Chromium only. |
| **GPU, unmasked** | WebGL `WEBGL_debug_renderer_info` → `UNMASKED_RENDERER_WEBGL`; WebGPU `adapter.info` (`vendor`/`architecture`/`device`) | Actual GPU model. We currently read plain `RENDERER`, which is often just "WebKit WebGL". |
| **Storage headroom** | `navigator.storage.estimate()` → `{quota, usage}` | Disk pressure bracket. |
| **Audio hardware** | `AudioContext.sampleRate`, `baseLatency`, `outputLatency` | 44.1 vs 48 kHz, buffer size — an OS/driver fingerprint. We already own an `AudioContext`. |
| **CPU pressure** | `PressureObserver` (`'cpu'` → `nominal`/`fair`/`serious`/`critical`) | A *first-party* thermal/load signal. Far better than inferring load from heap. |
| **Main-thread jank** | `PerformanceObserver('long-animation-frame')` (LoAF) | Real stalls with attribution — directly relevant to the sub-10-fps divergence QA found. |
| **Media devices** | `navigator.mediaDevices.enumerateDevices()` | Without permission: device **kinds and counts** only, labels blank. Counts alone are informative. |
| **Codec / hw decode** | `navigator.mediaCapabilities.decodingInfo()` | `powerEfficient` ⇒ hardware decode ⇒ device class. |
| **Display** | `screen.*`, `devicePixelRatio`, `screen.orientation`, `visualViewport`, `matchMedia('(dynamic-range: high)')` | HDR, refresh class, real vs CSS pixels. |
| **Preferences** | `prefers-reduced-motion`, `prefers-color-scheme`, `prefers-contrast`, `forced-colors` | Accessibility signals — and we should *honour* the first one, not just display it. |
| **Privacy posture** | `navigator.doNotTrack`, `navigator.globalPrivacyControl`, `navigator.cookieEnabled`, `crossOriginIsolated` | What this browser is telling the world it wants. |
| **Locale set** | `Intl.DateTimeFormat().resolvedOptions()` (`timeZone`, `locale`, `calendar`, `numberingSystem`), `navigator.languages` | Full picture, not just `navigator.language`. |

### 2.8 Derived truths — where it gets genuinely interesting

None of these are a single API read. They are **inferences from combining measurements**,
and they are the most compelling material in this whole plan.

**a. Bufferbloat.** `rtt` versus `min_rtt` from `cfL4`, sampled while a download is
saturating the link. If loaded RTT climbs far above idle `min_rtt`, the path has
over-large buffers. This is the classic bufferbloat measurement and we can do it *properly*
— idle baseline, then under load — because we control both the load and the measurement.

**b. Speed-of-light efficiency.** We know the colo (IATA code) and, if `cf-meta-latitude`/
`-longitude` populate, a coordinate. Great-circle distance → the theoretical minimum RTT at
the speed of light **in fibre** (≈ 2/3 c, so ~1 ms per 100 km round trip). Compare to
measured `min_rtt`. A ratio near 1 means near-optimal routing; 3× means the packets are
touring. This is a real network-engineering metric that almost no consumer tool surfaces,
and it is *beautiful* as a game stat.

**c. VPN / proxy detection, honestly hedged.** Cross-check four independent signals:
`Intl` timezone vs. geo-IP country; `navigator.languages` vs. country; Cloudflare
`warp=on`; STUN `srflx` IP vs. HTTP-observed IP; and reverse-DNS/ASN naming
(`…hosting…`, datacenter ASNs vs. residential). Any single one is weak. Three agreeing is
strong. Present it as **evidence with confidence**, never as a verdict.

**d. Clock skew.** Every HTTP response carries a `Date` header, and it is CORS-safelisted
— readable cross-origin without any opt-in. Compare it (RTT-corrected) to `Date.now()`.
Reveals how far the machine's clock has drifted from internet time.

**e. Protocol reality.** `nextHopProtocol` on TAO-enabled entries tells us `h3` (QUIC),
`h2`, or `http/1.1` per host. Whether the connection is QUIC changes everything about how
it behaves under loss.

**f. Connection-limit probing.** Fire N parallel requests at an `h1` host and at an `h2`
host and compare completion patterns. The HTTP/1.1 six-connection limit shows up as visible
head-of-line stair-stepping; h2 multiplexes flat. Costs nothing but a few requests.

### 2.9 What we still cannot do

Stated plainly so nobody plans around a fantasy: **ICMP ping and traceroute** (no raw
sockets — our "trace chain" is a reconstruction from Performance API phases and should keep
saying so), **pcap**, **ARP / LAN device enumeration**, **port scanning**, **WiFi signal
strength in dBm**, **TLS version and cipher suite** (not exposed to JS), **the local
gateway IP**, and **LAN host IPs** (mDNS obfuscation, §2.6). The optional local-agent idea
in the ROADMAP remains the only route to those, and the game must ship complete without it.

---

## 3. The Lens becomes a side cart

Today: a centred modal, `position:fixed; top:50%; left:50%`, ~340–420 px wide, built by
string-concatenated `innerHTML` in a 115-line function in `main.ts`, rebuilt wholesale
every refresh. It covers the game, so you cannot watch the world react to the numbers
you're reading — which is the entire premise.

**Target:** a right-edge drawer.

- Slides in over the right ~380 px (full-width sheet under ~700 px viewport), game continues
  rendering and remains playable beside it. Non-modal: no scrim, no input capture beyond
  its own bounds.
- `O` toggles as now; the drawer animates on `transform` only (compositor-only, no layout
  thrash during a 60 fps sim).
- **Tabbed, not one long scroll.** Current sections regroup into five tabs:
  **PULSE** (live) · **PATHS** (routes, DNS, waterfalls) · **IDENTITY** (who the network
  thinks we are) · **VESSEL** (local machine) · **THREADS** (mappings + Feed).
- **Chronicle strip** pinned under the tab bar, always visible: three live sparklines
  (latency, throughput, loss) over the whole session, not 60 s. `drawSparkline()` already
  exists and has never been called — wire it up.
- Every row keeps its `data-inspect-key` and the SOURCE / ACTION / FLOWS INTO inspect box.
  That mechanic is the best thing in the current panel and must survive the refactor intact.
- **New: honesty affordances.** Each reading is tagged with how it was obtained —
  `measured` (we timed it), `reported` (the browser told us), `derived` (we computed it),
  `unavailable` (and *why* — "Firefox does not implement `navigator.connection`"). Today a
  25 ms-bucketed browser guess and a µs-precision kernel RTT render identically. They must
  not.
- **Export.** One button dumps the entire session — every series, every probe, every
  derived inference — as JSON. This is the same instinct that made the Playwright timeline
  artifacts valuable: the panel is a data-collection instrument, so let the data leave.

**Refactor note:** `updateObservatory()` is ~115 lines of string concatenation in `main.ts`
and will not survive five tabs and a dozen new sections. Extract to
`src/game/ui/lens/` — one module per tab, a shared row/section builder, one shared
`escapeHtml` (all third-party strings stay escaped; that fix is already in and must not
regress). Rebuild only the *visible* tab, and only while the drawer is open.

---

## 4. Tests over time — the Chronicle

The fourth ask, and the one with no existing implementation at all. Three ring buffers of
60 samples is not a measurement history.

**`ChronicleStore`** — a single time-series store, seeded at boot, holding the whole run:

- Named series, each `{t, value, quality}` — where `quality` records whether the sample was
  measured, reported or derived.
- Tiered retention so a 15-minute run stays bounded: full 1 Hz resolution for the last
  120 s, then 10 s aggregates (min/median/p95/max/count) for the rest. Aggregates, not
  decimation — the *outliers are the interesting part* and naive downsampling deletes them.
- **Scheduled probes**, independent of player action, with jittered intervals so they don't
  phase-lock with the day/night cycle: latency every ~10 s, DNS every ~30 s, a small
  throughput sounding every ~3 min, STUN once at boot and on any rift.
- **Change detection**, which is what the ask is really about — *"the stats in regards to
  changes."* Compare a short window against a long baseline; when latency, loss or
  throughput steps outside its established band, emit an event. That event is both a Lens
  Feed line **and** a game event (§5).
- Everything is fed by the same store that the Lens draws and the export button dumps.

---

## 5. Linking it into the game loop

The second half of the user's immediate todo, and the part where this stops being a
diagnostics panel bolted to a game and starts being *the same thing*.

The existing `NET_METRICS` → `NET_GAME_MAP` data-row architecture is the right vehicle and
should not change shape. Most new signals arrive as **new rows**. But rows alone are passive
multipliers, and the interesting new signals deserve more than a multiplier.

### 5.1 New mapping rows (passive, cheap, the easy half)

| Signal | In-world name | Effect |
|---|---|---|
| `retrans` / `lost` from `cfL4` | **Fray** | The clearest "hostile network" signal there is. Drives horde aggression and a visual corruption/tear effect. Packet loss should be *frightening*. |
| `rtt` − `min_rtt` under load (bufferbloat) | **Silt** | The world thickens: movement drag, slower gather. Buffers filling ⇒ the wire silting up. |
| `cwnd` | **Aperture** | How much the path will accept in flight ⇒ carrying capacity / inventory throughput. |
| `delivery_rate` (measured) | **Flow** | *Replaces* `downlink` as the gold-rate driver. The current one is capped at 10 Mbps and absent outside Chromium; this is real and universal. |
| `min_rtt` (µs) | **Pulse** | *Replaces* `connection.rtt` for sim speed where `cfL4` is available. Keeps the 25 ms-bucketed value as the documented fallback. |
| `rtt_var` (µs) | **Flux** | A real kernel-measured jitter, replacing a statistic derived from quantised buckets. |
| Speed-of-light ratio | **Meridian** | Routing efficiency. Near the backbone ⇒ a "civilised" realm; a wandering route ⇒ a remote one. Feeds realm/biome selection, which currently leans on a fetch-timing median. |
| STUN NAT class / IPv6 | **Seal** / **Dual-Souled** | Sampled **once at birth** and fixed for the run — a character trait, not a fluctuating modifier. Symmetric NAT is a sealed vessel. |
| `PressureObserver` CPU state | **Veil Pressure** | Replaces the current JS-heap proxy with a first-party signal. |

### 5.2 The Sounding — a network test as a game verb

The one genuinely new mechanic, and the answer to "linking it into the game loop":

**A throughput test costs the player's data, so it must be something the player chooses.**
That constraint is a gift, because it forces the measurement to become a *verb* instead of
background traffic.

- A structure (a **Sounding Stone**, or a Waystone upgrade) that the player builds and
  activates.
- Activating it runs a **real** measurement burst: a download sounding, an upload sounding,
  a latency-under-load sweep, a DNS resolver race.
- The results *are* the reward. Throughput becomes a resource yield. Low loss and low
  bufferbloat pay a bonus. A fast resolver reveals fog (the **Scrying** idea the ROADMAP
  has carried since N1 — DNS finally earns its keep).
- Cooldown-gated, in-fiction ("the stone must recover"), which is *also* the rate limit and
  the data budget. The game mechanic and the good-citizenship constraint are the same
  mechanism. This is the cleanest design in the plan.

### 5.3 Network events as world events

The Chronicle's change detection (§4) fires into the existing rift/omen machinery:

- A sustained latency step-change ⇒ a **rift** (already implemented, currently triggered by
  a `connection.type` change that desktop browsers never report — so on desktop the rift
  system is close to dead code; this gives it a real trigger).
- A retransmission burst ⇒ a **surge**: hordes agitate, the screen frays.
- Throughput collapse ⇒ **famine**: yields drop until it recovers.
- Going offline ⇒ The Hollow (already implemented, keep).

This makes the moment your WiFi hiccups a moment *in the game*, which is the premise in
GDD §4.2 finally delivered on rather than approximated by a 25 ms-bucketed proxy.

---

## 6. Risks, budgets, and the things that will bite

### 6.1 Data usage — the serious one

Real throughput measurement spends the player's bandwidth, and on a metered mobile
connection that is a genuine harm, not a nuisance. Non-negotiables:

- **Never on boot.** No measurement of consequence before the player asks for one.
- Honour `navigator.connection.saveData` — if set, soundings are **off** by default.
- **Adaptive sizing:** start at 256 KB; only escalate if the transfer completed fast enough
  to imply headroom. Never exceed ~5 MB in a single sounding.
- **A hard session cap** (~20 MB), displayed in the Lens as a spent/remaining budget. When
  it is gone, it is gone.
- A visible always-available off switch.
- The existing boot-time endpoint disclosure (`logEndpointDisclosure()`) is good practice
  and must be extended to cover every new endpoint.

### 6.2 Permission to speak — are these endpoints OK with us?

Checked properly on 2026-08-17 rather than assumed. The answer splits cleanly, and **the
liability is in the code that ships today, not in anything N4 proposes.**

#### Tier 1 — endpoints that exist to be called by strangers

| Endpoint | Standing |
|---|---|
| `speed.cloudflare.com/__down`, `/__up` | **Cloudflare publishes `@cloudflare/speedtest` on npm** (MIT, v1.13.0, authored `vasco@cloudflare.com`, maintained by `@cloudflare.com` / `workers-devprod@cloudflare.com` accounts, keywords *"bandwidth, latency, packet loss"*). It drives these exact endpoints. Shipping a library so third parties can embed your speed test is about as explicit a sanction as exists short of a ToS clause. **We should depend on that package rather than hand-rolling fetches** — same endpoints, but we're then a documented consumer instead of an unknown one. |
| `cloudflare-dns.com/dns-query`, `dns.google/resolve` | Documented public DoH resolvers. Answering unsolicited queries from arbitrary clients *is the service*. |
| `stun.l.google.com:19302`, `stun.cloudflare.com:3478` | Public STUN. Receiving unsolicited binding requests from arbitrary clients is the entire protocol. |
| `cloudflare.com/cdn-cgi/trace` | Cloudflare's own public diagnostic endpoint. |
| `api.ipify.org` | Explicitly a free public API. (Being dropped anyway — `cf-meta-ip` makes it redundant.) |

#### Tier 2 — endpoints that have said no

**`ipapi.co`** — the pricing page states **1,000 lookups/day** and calls the free tier a
*"free trial"*, with commercial use licensed separately. We have already been **429'd** in a
QA run. Drop it (§2.5).

**The fourteen favicon beacons** — these are not APIs. Nobody invited us. Two say so outright:

> **BBC** (`robots.txt`): *"In short: Please use our site like a human, not a robot. That
> means: No scraping, crawling, or systematic extraction of content…"*

> **Le Monde** (`robots.txt`): *"Il est interdit d'utiliser des robots d'indexation Web **ou
> d'autres méthodes automatiques de feuilletage ou de navigation** sur ce site Web… Nous vous
> invitons à nous contacter pour contracter une licence d'utilisation."* — forbidding not
> just crawling but *automated browsing generally*, and citing French database-producer law
> (art. L 342-1 CPI).

Baidu and Microsoft carry ordinary crawler directives with no blanket automation ban. But
"only some of them forbid it" is not a position worth defending.

#### The volume problem — this is the actual finding

`probeAction('attack')` has **no cooldown** (`ACTION_COOLDOWNS.attack = 0`). Every swing
fires an echo, plus a 3-beacon volley from *all* pools every 1.5 s. The swing envelope is
`0.22 + 0.12 + 0.30 = 0.64 s`, compressible to `0.32 s` via `attackSpeedFloor`.

Sustained combat therefore generates **≈3.6 requests/second, up to ~5/s** at high attack
speed. Across a 15-minute run that is **on the order of 1,000+ third-party requests per
player per run**, ~100 per host — and every one uses `cache: 'no-store'`, which
deliberately defeats caching so each is a real origin hit. `probeSingleEndpoint()` also has
**no failure backoff at all**; only the unrelated `pollEndpoint()` path does.

Two consequences, one of which matters much more than the other:

1. **At scale it is unsolicited distributed load** on a dozen major sites from many client
   IPs — structurally indistinguishable from a small DDoS, however innocent the intent.
2. **The sharper risk is to individual players, and it is not hypothetical.** These requests
   originate from *the player's* IP, not ours. A machine on a corporate, school or
   government network emitting steady 3/s beacons to `yandex.ru`, `baidu.com` and
   `naver.com` on a fixed cadence is a textbook **C2 beaconing signature** — it is close to
   exactly what network IDS products are tuned to catch. We can get a *player* flagged,
   rate-limited, or asked hard questions by their IT department. That is a real harm we'd be
   exporting to users, and it is reason enough on its own.

**Calibration, honestly:** at today's scale — a game that had never been pushed until this
afternoon — the practical risk of anyone noticing is near zero. Nothing here is an
emergency. The reasons to fix it now are that it is cheap now and expensive after launch,
that item 2 applies at *n = 1*, and that Le Monde's terms are unambiguous.

#### The fix, which is also a technical upgrade

The good-citizenship fix and the correct engineering happen to be the same change, which is
the strongest possible argument for it: **§2.4 already established that none of the fourteen
favicon hosts set `Timing-Allow-Origin`, so they can never yield a timing breakdown no
matter how we probe them.** They are simultaneously the most legally dubious and the least
informative thing we do.

1. **Retire favicon fetches as a measurement mechanism entirely.**
2. **Keep the discovery mechanic — re-implement it on DoH.** Instead of *fetching*
   `bbc.co.uk/favicon.ico`, *resolve* `bbc.co.uk` through Cloudflare or Google DoH. This is
   strictly better on every axis: it is a sanctioned API; it never touches the BBC's servers
   at all (the resolver answers, usually from cache); it yields a **real** measurement (DNS
   resolution latency) instead of a scheduling-polluted fetch duration; and it returns the
   host's actual IP, which makes the geographic story *true* rather than a hardcoded
   `detail: 'London, GB'` string. **This promotes N4.4 (Scrying) from optional to
   load-bearing.**
3. **Add a same-origin baseline beacon.** GitHub Pages is our own origin: full timing data,
   zero third-party exposure, a clean control against which every other route is compared.
4. **Rate-limit the attack path.** No game action should be able to drive network requests
   at swing frequency. Beacon cadence should be wall-clock-governed and human-scale.
5. **Global failure backoff and `Retry-After` compliance** on every outbound path, not just
   `pollEndpoint()`.
6. **Self-identify.** Custom headers are impossible under `no-cors` and the UA is not ours to
   set, but a query param (`?_nw=probe`) costs nothing and lets anyone reading their logs see
   what this is. Do it on anything third-party that remains.
7. **Stop defeating the cache** where a fresh hit is not the point of the measurement.
8. **`NW_NO_NET` for CI.** The QA suite currently drives the real beacons on every run and
   every playthrough profile — we are our own traffic multiplier. Already planned in §6.4;
   this raises its priority.

Net effect: third-party contact drops from ~1,000 requests/run against a dozen unconsenting
hosts to a small number of DNS queries against two public resolvers plus a metered,
player-initiated conversation with Cloudflare's own speed test — all of it against
endpoints that publish client libraries inviting exactly this.

### 6.3 Failure is the normal case

Ad blockers, enterprise proxies, DoH blocking, CORS-breaking middleboxes, captive portals,
and Firefox/Safari's missing APIs will all break pieces of this. Every probe must fail
silently into a documented fallback, and the Lens must say *which* thing is unavailable and
*why*. **The existing rule holds: every fallback is the neutral value, so no player is ever
locked out of a balanced game.** A blocked probe is content ("this network is filtered"),
not an error.

### 6.4 QA

- The QA harness already attributes third-party console errors separately and treats them
  as non-fatal — that decision pays off immediately here.
- New: a **`NW_NO_NET` mode** that stubs every external probe with fixtures, so the Gauntlet
  and the CI lanes stay hermetic and fast. CI must never run a real bandwidth test.
- New Gauntlet coverage for the parsers — a `cfL4` description string and a DoH JSON
  response are both *untrusted third-party input being parsed into game-driving numbers*.
  Malformed input must not produce `NaN` (WORKFLOW Pitfall 4), and that needs its own tests.
  **Note the B5 lesson: a green Gauntlet is not evidence for code it does not assert on.**
- One Playwright spec that exercises a real (small) sounding against the live endpoints, run
  outside the release gate so a third-party outage never blocks a deploy.

### 6.5 Performance

`PerformanceObserver` and `PressureObserver` are cheap and callback-driven. Parsing and
series-updating are trivial. The one real risk is the Lens itself: five tabs of DOM rebuilt
at frame rate would eat the budget. Rebuild only the visible tab, only while open, and
throttle to ~4 Hz — the numbers don't need 60 Hz and the eye can't read them at that rate.

---

## 7. Phasing

Each phase is independently shippable and independently valuable. **Phase 1 alone would
already be the largest single upgrade to the game's premise since N1.**

| Phase | Contents | Why this order |
|---|---|---|
| **N4.0 — Right of way** ✅ | Retire the favicon-fetch beacons; rate-limit the attack path; global backoff + `Retry-After`; same-origin baseline beacon; `NW_NO_NET`; drop `ipapi.co` + `ipify`. | **Goes first.** Removes the only part of the system that contacts hosts which have not invited us (§6.2), and removes ~1,000 requests/run of traffic that N4's own measurements would otherwise be layered on top of. Deletes code; adds none. |
| **N4.1 — The Deep Wire** ✅ | `cfL4` parsing, TAO waterfalls, `PerformanceObserver` on resources, real `min_rtt`/`rtt_var`/loss. Identity consolidated onto Cloudflare; `ipify` dropped, `ipapi.co` decided per §2.5. | Highest value, lowest risk, **zero new bandwidth cost** — it reads headers on requests we already make. Also retires the 429-flaky endpoint. |
| **N4.2 — The Side Cart** ✅ | Drawer, five tabs, Chronicle strip, honesty tags, export. Extract `updateObservatory()` into `ui/lens/`. | The user asked for the panel first. It also makes everything after it *visible*, which is how we'll know the measurements are right. |
| **N4.3 — The Chronicle** ✅ | `ChronicleStore`, tiered retention, scheduled jittered probes, change detection **+ Omens: detected changes become world events (§5.3)**. | Needs N4.1's signals and N4.2's surface to be worth anything. Store shipped early with N4.2; jitter + Omens shipped 2026-08-20. |
| **N4.4 — Scrying** | DoH: resolver race, PTR on own IP, AAAA/IPv6, TTL, DNSSEC `AD`, per-beacon real IPs. | Self-contained. Tiny bandwidth. Delivers a ROADMAP promise outstanding since N1. |
| **N4.5 — The Sounding** | Download/upload soundings, bufferbloat sweep, data budget + consent UI, the Sounding Stone building and its game rewards. | Deliberately last: it is the only phase that spends the player's data, and it should sit on top of a system that's already proven. |
| **N4.6 — Deep Vessel** | High-entropy UA, unmasked GPU, storage estimate, audio hardware, `PressureObserver`, LoAF, media-device counts, privacy posture. | Pure local reads, no network. Can slot in anywhere; parked here because it's flavour-dense and mechanically light. |
| **N4.7 — Derived truths** | Speed-of-light efficiency, VPN/proxy evidence panel, clock skew, protocol reality, STUN/NAT/IPv6 traits. | Needs most of the above as inputs. The payoff phase. |

---

## 8. Decisions (2026-08-17) — Q1–Q4 + Q6 answered

- **Q1 data budget: OPT-IN, and it doubles as the difficulty selector.** User's direction:
  the budget tier *is* the game scaling — easy → normal → hard → super hard → super super
  hard, expressed as mob damage, mob density/count, and reduced player power/speed. More
  data spent ⇒ more of the real network drives the sim ⇒ harder run (and, by implication,
  a higher Legacy Score multiplier). This resolves the consent problem cleanly: the data
  cost stops being a hidden tax and becomes a chosen, rewarded difficulty. Spec it in N4.5.
- **Q2 `ipapi.co`: dropped.** Done in N4.0. `api.ipify.org` dropped with it.
- **Q3 STUN: approved.** Lands in N4.7.
- **Q4 scope: do the whole arc.** N4.0 first and separately (below).
- **Q6 favicon beacons: approved for retirement.** Done in N4.0.

**N4.1 and N4.2 shipped 2026-08-19** on `dev/night-build`, unmerged. N4.2 additionally
carried the `ChronicleStore`, tiered retention and change detection that §7 assigns to
N4.3 — the Chronicle strip and the export both needed a real backing store.
N4.1 did NOT take up the suggestion to depend on `@cloudflare/speedtest`: that package is
a full throughput engine and N4.1 spends no bandwidth, so it belongs with N4.5.

**N4.3 shipped 2026-08-20**, same branch, closing out both outstanding items:

- **Jittered scheduling.** Three of the four schedulers were on fixed periods. The
  same-origin baseline's 20 s divides the 340 s day/night cycle *exactly 17 times*, so it
  sampled the same seventeen phases of every day forever — a measurement-validity bug, not
  a politeness one. All four now go through one `jitteredGap()`. Measured: 17 → 67 of 68
  phase buckets over 300 probes, with the mean gap unchanged (19.98 s vs 20 s over 2000
  samples), so the request *rate* is untouched. No new outbound requests.
- **Network events as world events (§5.3).** `systems/omens.ts` turns the Chronicle's
  detected steps into six named world states: **Surge** (fray ▲ → horde aggression ×1.25 +
  the screen frays), **Famine** (flow ▼ → yields ×0.65), **Bounty** (flow ▲ → ×1.30),
  **Quickening** (pulse ▼ → move ×1.10), **Miring** (silt ▲ → ×0.88), and **Rift**
  (pulse ▲ → the realm tears). Table-driven; adding one is a row.

Three things §5.3 did not say, decided during implementation:

1. **Omens go both ways.** The plan lists only bad ones. A mapping that can only punish is
   a penalty box. Bounty and Quickening are the counterparts.
2. **A Famine lifts on recovery, not on a timer** — the plan says "until it recovers", and
   that is the better mechanic. Measured against the *pre-step baseline* with a 10%
   hysteresis band; the duration cap is a safety valve for a permanently degraded link.
3. **An omen is a step, not a level.** The `Horde Aggression (Fray)` row already makes a
   lossy link permanently harder; a Surge is the moment it *starts*. They multiply
   separately because a steady hostile network and a shock are different experiences.

**The rift system turned out to be dead code on desktop.** Its only trigger since N2 was a
`connection.type` transition, which desktop browsers do not report at all — the flash, the
particles, the biome swap and the scoreboard counter were all built, tested, and unable to
fire on the platform the game is played on. `riftFromWire()` is its first real trigger, and
it returns false when the biome selector returns the realm we are already in rather than
claiming a `Vale → Vale` rift.

**Separately, the Lens CHANGES panel had never once shown anything.** `main()` drains
`takeEvents()` at 1 Hz and that drained the same array the panel and the export read, so
every exported chronicle carried `"events": []`. The permanent record and the delivery
queue are now separate. See the dated ROADMAP entry for measurements.

**N4.0 shipped 2026-08-17.** Measured: 117 swings in 70 s produced **9 outbound requests**
(5 `cloudflare-dns.com`, 4 `dns.google`, 3 same-origin) — ~7.7/min against a 20/min gate,
and **zero** requests to any of the fourteen beacon hosts. Routes now resolve to real
addresses (`News24 → 104.17.250.6`, `Yandex → 77.88.44.55`, `Yahoo JP → 182.22.16.251`)
alternating across both resolvers. `qa/specs/wire.spec.ts` asserts all three properties.

## 9. Open questions — remaining

1. **Difficulty tiers.** How many, and what does each cost in data vs. give in Legacy Score?
   Needs concrete numbers before N4.5.
2. **City / ASN / ISP.** Dropping `ipapi.co` costs these. Reverse-DNS (PTR) recovers ISP-ish
   naming for free and now ships. Is country + colo + PTR enough, or is a geo-IP vendor
   worth re-adding behind the same opt-in as the data budget?
3. ~~**Sequencing against the existing queue.**~~ **Moot 2026-08-21.** Everything now sits on
   one branch, `dev/night-build` — ten milestones deep, none merged. The sequencing question
   became a merge-order question, and it is tracked in the ROADMAP's "Open and owed" table.

---

## 10. Prior-art corrections — folded in 2026-08-21

All three are now applied at the source rather than listed here, which is the whole point of
a correction: the ROADMAP's availability matrix has the six new rows and the note that the
best N4.1 signals are **universal**; its "What we CANNOT get from a browser" list no longer
implies packet loss needs an agent; and GDD §4.2 reads "two dozen tracked metrics" with the
`connection.downlink` 10 Mbps cap stated inline. This section is kept as a stub because two
ROADMAP entries had *recorded* the first correction without anyone applying it, and the wrong
text outlived both.
