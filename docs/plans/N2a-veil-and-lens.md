# N2a — The Veil & the Lens

**Status: ACTIVE — the next milestone.** Written 2026-07-16 from the user's playtest verdict
on `v0.16.1-n15-ground-truth`. **Supersedes the N2a scope in `N2-wire-realm.md`** (whose goal —
"replace every trace of the dream world with network terminology" — is inverted by this verdict).
N2b (material effect hooks) is untouched and still future work.

## The verdict (user, 2026-07-16)

> "zone names and boss names, feels like theres some left over networking related terminology
> used in naming stuff somewhere. even in the death screen, its just networking jokes and
> jargon :/ we need to scrub it all away! though I want the actual latency to the different
> urls, the bandwidth, the location information, the ip, the router info, every everything we
> can grab via javascript must be in the observation panel. we primarily use these vars in our
> naming conventions, in our abilities, damage, speed, movement speed, harvesting speed,
> experience, difficulty of mobs spawned, mobs spawned from specific operation with numbers we
> can use for stats of monster, like defense, hp, damage, additional special skills maybe?"

## The law: two layers, one bridge

1. **The Veil (fiction layer).** Everything the world *says* — names, descriptions, toasts,
   the main event log, the death screen — speaks pure fantasy. Zero networking vocabulary.
   A player who never opens the observatory should believe this is a haunted frontier, full stop.
2. **The Lens (truth layer).** The observatory panel (**O** key, already exists as
   `#nw-observatory` in `main.ts`) shows every raw number JavaScript can actually grab —
   per-URL latencies, bandwidth, IP, geo, device — honestly labeled, technical voice,
   including honest footnotes about what the browser caps or hides.
3. **The bridge.** The network variables *drive* the fiction — procedural names, mob stats,
   modifiers — but are never *named* in it. The Lens's "Threads" section is the decoder ring:
   it shows exactly which real number produced which game effect. Legibility lives in the
   Lens, not in puns.

The old N2 brief put jargon in the fiction and mysticism in the readouts. This is exactly
backwards. Invert both.

## Reality constraints (carry over from N1.5 — do not relitigate)

- `connection.rtt` quantized to 25 ms buckets, `downlink` capped at 10 Mbps, `effectiveType`
  ≈ always '4g' on broadband, `connection.type` Android/ChromeOS-only. The Lens **displays
  these caps as footnotes** — the truth layer is honest even about the browser's own lies.
- **"Router info" is not obtainable from JavaScript.** No gateway IP, no hop list, no local
  IP (WebRTC ICE is mDNS-obfuscated in modern browsers). The Lens shows an honest line:
  `local gateway — not observable from a browser`. What we *can* show: public IP / ISP / ASN /
  city (via the F8-gated identity probes), Cloudflare colo + warp + trace, and per-route
  fetch timings.
- **Cross-origin resource timing without `Timing-Allow-Origin` exposes duration only** —
  per-beacon DNS/TCP/TLS breakdowns are mostly zeros. Show per-route *duration* (last / best /
  median), and show the full DNS/TCP/TLS/TTFB breakdown only for our own origin's page load
  (already captured as `pageDnsTime`/`pageTlsTime`/`pageTtfb`).
- All derived stats stay **clamped** (N1.5 discipline). Every clamp range appears in the Lens.
- F8 privacy gating stands: identity probes fire only after the first `explore` action.
- D1–D4 stand. D3 is *refined*, not reversed: mystical flavor wins **and** the raw data gets
  a real home (the Lens) instead of leaking into fiction as jargon.

Allowed fiction vocabulary (pre-network English, reads mystical): beacon (fire-on-a-hill
sense), echo, resonance, pulse, flow, flux, current, thread, weave, rift, realm.
**Banned in fiction strings** (case-insensitive): packet, ping, proxy, firewall, ethernet,
wifi, cellular, loopback, network, signal, spectrum, protocol, bandwidth, router, gateway,
node, relay, cache, sector, grid, upload, download, downlink, Mbps, RTT, DNS, TCP, TLS,
connection, online, offline, latency/latent, endpoint, server.
(`id:` fields and API string values like `connectionType: 'ethernet'` are **exempt** — they
mirror browser APIs and are not player-facing. Truth-layer files are exempt by definition.)

---

## Part A — The Veil (the scrub)

Complete audited inventory, 2026-07-16. Names below are **defaults** — good enough to ship,
expect the user to retune at playtest.

### A1. Rename tables (pure data edits)

`src/game/data/biomes.ts` — display names + descriptions (keep `id`/`connectionType` values):

| id | now | becomes | new description |
|----|-----|---------|-----------------|
| ethernet | Ethernet Plains | **The Steadfast Vale** | 'Calm and rooted. The world holds its shape here.' |
| wifi | WiFi Wilds | **The Shifting Wilds** | 'Rich and restless. Nothing stays where you left it.' |
| cellular | Cellular Chaos | **The Stormlands** | 'Hostile and howling. High risk, high reward.' |
| loopback | Loopback | **The Hollow** | 'Severed and still. The world holds its breath.' |

`src/game/data/domains.ts` — lord titles (review the WHOLE `DOMAIN_LORDS` array against the
banned list, not just these):
- 'the Ethernet Plains' → **'the Verdant Reach'**
- 'the Pale Firewall' → **'the Pale Rampart'**
- 'the Drowned Gateway' → **'the Drowned Deep'**
- origin lord 'the Loopback' → **'the Hollow'**

`src/game/world/domains.ts` (procedural region namer, lines 20–23, 48):
- NOUN: 'Sector' → 'Downs', 'Gateway' → 'Crossing', 'Grid' → 'Weald'
- PREFIX: 'The Latent' → 'The Thorned' (latency pun — exactly the leak we're scrubbing)
- origin region name 'The Loopback' → **'The Hearthlands'**

`src/game/data/enemies.ts` — the ids were never jargon; restore names from them:
- 'Packet Rat' → **'Gnawer'** · 'Proxy Brute' → **'Brute'** · 'Signal Wisp' → **'Wisp'**

`src/game/data/skills.ts` — restore the plain craft names:
- Packet Harvesting → **Woodcutting** · Spectrum Mining → **Mining** · Signal Foraging →
  **Foraging** · Signal Processing → **Crafting** · Protocol Forging → **Smithing** ·
  Packet Alchemy → **Alchemy** · Protocol Enforcement → **Combat** · Signal Amplification →
  **Firemaking**

`src/game/data/buildings.ts` — names + descs:
- hall 'Node Core' → **'Hearthstone'** — 'The heart of your holdfast. Lose it and the light goes out.'
- hut 'Signal Relay' → **'Hovel'** — '+2 population. More hands for the work.'
- wall 'Firewall' → **'Palisade'** — 'Holds the night back. They will try to breach it.'
- campfire 'Beacon' → **'Watchfire'** — 'A steady light in the dark. Keeps the gloom at bay.'
  (frees the word "beacon" for the far-shore probe targets, whose discoveryHints already use
  it in the fire-on-a-hill sense — those stay)
- tower 'Watchtower' — already clean, keep.

### A2. Screens, toasts, log lines

- `src/game/ui/ui.ts:574-576` death screen: 'CONNECTION LOST' → **'THE THREAD IS CUT'**;
  body → 'Your Hearthstone lies in ruin and the dark takes the rest. You survived N nights.'
- `src/game/systems/combat.ts:256-258` player death: toast → 'The thread snaps — you're
  scattered, X gold gone. Find your way home.' / 'The thread snaps — you are cast into
  distant lands…'; log → 'You fell (−X gold) — cast into distant lands'.
- `src/game/systems/combat.ts:165` — **strip the raw `[RTT …ms · BW …Mbps]` suffix** (rule
  A3 below).
- `src/game/systems/worldbosses.ts:97` → '${b.name} re-forms in the deep dark, stronger.';
  `:238` → 'You have slain ${b.name}! The land trembles.'
- `src/game/systems/hordes.ts` scatterCache (`:302-317`): fiction becomes 'scatter your
  hoard' — toast 'Hoard scattered! −X gold, N fewer enemies incoming' (no `[RTT]`), log kind
  `economy` not `network`. (Renaming the method `scatterHoard` is optional; strings are the gate.)
- `src/game/systems/hordes.ts:140` wave-spawn log: drop the `[RTT · BW · JIT]` suffix (Part C
  replaces it with the epithet name); `:343` kill log likewise.
- `src/game/systems/economy.ts:46` — delete the raw `'downlink' … 'Mbps'` floater. Raw
  number moves to the Lens feed; if a floater is wanted, it speaks fiction ('the current
  favors you').
- `src/game/ui/ui.ts:100` badge title → 'the realm you stand in'.
- `src/game/systems/network.ts` toast/realm-shift messages that players see (e.g.
  'Connection lost — entering Loopback' at `:517`): fiction voice → 'The world grows still —
  you have crossed into the Hollow.' Its **netLog lines go the other way** — more technical,
  not less: 'Pinging beacon...' → 'probe uol.com.br → 182 ms' (they render in the Lens feed).

### A3. Log channel separation (the rule that keeps it scrubbed)

One `GameLog` ring buffer, two render targets:
- **Chronicle** (main log panel, key L): fiction kinds only — gather, craft, build, combat,
  boss, level, death, region, economy, spawn, world, system. **No raw units, no bracketed
  metric suffixes, ever.**
- **Feed** (inside the Lens): truth kinds — `network` and all `net-*`. Technical voice.
  `styleNetworkMsg()` + `NET_LOG_LABELS` (ui.ts:595-630) move to/are reused by the Lens feed
  renderer.

---

## Part B — The Lens (rebuild `#nw-observatory` as the truth panel)

Keep the O-key toggle, the fixed-center layout, and the existing `drawSparkline` helper
(`main.ts:653`). Replace the '✨ Soul Resonance' header + mystical labels with the honest
instrument. Sections top to bottom:

1. **Connection** — the existing big-number row, relabeled truth: `RTT` (footnote: 'quantized
   to 25 ms by the browser'), `downlink` (footnote: 'capped at 10 Mbps'), `echo jitter`
   (from the beacon buffer, F1). Below: effectiveType, connection.type (or '— (desktop
   browsers hide this)'), saveData, navigator.onLine. Sparkline of recent echo samples.
2. **Realm profile** — the D1 derivation, shown with its inputs: 'echo median 46 ms ·
   variance 3.4k → **The Shifting Wilds**'. Stability bar stays.
3. **Routes** — the per-URL table the user asked for. One row per beacon ever probed this
   session: label, place (city/region), last ms, best ms, median ms, samples, warmed?.
   Plus one 'this origin' row with the full DNS / TCP / TLS / TTFB page-load breakdown
   (`pageDnsTime` etc.). Live-updates while open.
4. **Identity** — public IP, ISP/org, ASN, city/country, CF colo, warp, trace chain. Rows
   show '— unrevealed (explore to reveal)' until the F8 gate opens. Fixed honest line:
   'local gateway — not observable from a browser'.
5. **Vessel** — everything else JS can grab (observation-only in N2a, no mechanics):
   platform/UA brand, hardwareConcurrency, deviceMemory, screen w×h @ devicePixelRatio, GPU
   adapter (WebGPU `adapter.info` / `WEBGL_debug_renderer_info` fallback), language,
   timezone, `navigator.storage.estimate()`, battery level+charging if `getBattery` exists.
   Add one line to README's privacy section: the panel reads (never transmits) device info.
6. **Threads** — the decoder ring. A table generated FROM `NET_GAME_MAP` rows (add a
   `sourceLabel: string` or `explain(snap): string` field per row — stays data-driven): every
   active modifier with live value, source expression with current inputs, and clamp range.
   E.g. 'damage ×1.15 ← best echo 42 ms (clamp 0.9–1.3)'. After Part C this lists: sim speed,
   gold rate, damage, enemy scale, move speed, gather speed, xp rate + the realm row.
7. **Feed** — last ~50 truth-kind log entries (see A3).
8. **Inspect mode (the teaching layer — user idea, 2026-07-16).** Every Lens row (metric,
   route, identity, vessel, thread) and feed entry is highlightable — mouse hover on desktop,
   tap-to-pin on mobile (M1 rules). A detail box shows three lines:
   - **SOURCE** — the browser API and how it's implemented: 'PerformanceResourceTiming on a
     fetch() to abc.net.au — cross-origin, duration only' / 'navigator.connection.rtt —
     quantized to 25 ms buckets by Chrome'.
   - **ACTION** — the game action that drives it: 'fired by attacking — one echo per swing,
     volley throttled to 1 per 1.5 s' / 'revealed by your first explore action'.
   - **FLOWS INTO** — which game values consume it: 'damage mul · realm profile median'.
   Data-driven: add `inspect: { api: string; action: string; flowsInto: string }` to
   `NET_METRICS` rows and `BeaconTarget`s, plus one static table for identity/vessel rows.
   This is where the game teaches real network monitoring — the "monitoring automation"
   identity of the mash lives HERE, in the instrument, never in the fiction.

---

## Part C — The Threads (vars → names & stats)

### C1. Naming conventions from live vars (deterministic, jargon-free)

New file `src/game/data/lexicon.ts` — pure data + pure functions:
- `epithetForRegion(region: string): string` — 'Americas' → 'of the Western Water',
  'Europe' → 'of the Old Roads', 'Asia-Pacific' → 'of the Dawn Lands', fallback →
  'of the Far Shore'.
- Prefix by birth conditions: cold route (paid DNS+TLS) → **'Pale'**; echo jitter at birth
  > 40 ms → **'Flickering'**; echo < 60 ms → **'Swift'**. At most one prefix (priority:
  Pale > Flickering > Swift).
- Region-crossing toast gains a mood clause by realm band (uses the vars without naming
  them): calm → '— the air is still', shifting → '— the air is restless', storm → '— the
  air crackles'.

### C2. Mobs born from operations (the flagship)

`NetworkSystem` gains a public `lastEcho` record, set on every completed probe:
`{ ms, cold (paid DNS+TLS vs reused), jitterAtBirth, route: {label, region, countryCode},
tsMs }`.

When hordes spawns a **night-wave or rift foe** and `lastEcho` is fresh (≤ 30 s), the foe is
"born of that road" (day mobs keep base stats — keeps daytime readable; flag for playtest):

| stat | formula | clamp |
|------|---------|-------|
| hp | base × (0.9 + ms/400) | 0.9–1.6× |
| damage | base × (0.9 + jitterAtBirth/80) | 0.9–1.5× |
| defense (flat soak) | cold ? 2 : 0 | — |
| move speed | base × (1.25 − ms/300) | 0.85–1.2× |

**Special skills** (max one per foe): profile variance ≥ 8000 → **Blinker** (teleports 2
tiles away the first time it's hit, once); else cold route → **Shelled** (+2 extra soak
until it has been hit 3 times). Foes carry their birth record (for the Lens feed + kill log).

Voice split: Chronicle says 'A Pale Gnawer of the Dawn Lands joins the night wave.' The Lens
feed says 'wave spawn ← probe abc.net.au 212 ms cold=yes → hp×1.43 dmg×1.05 soak+2 Shelled'.

### C3. New modifiers (NET_GAME_MAP rows — data, live-tweakable, all in Threads)

| key | formula | clamp | wire point (single choke point each) |
|-----|---------|-------|--------------------------------------|
| moveSpeed | 1.06 − echoJitter × 0.002 | 0.92–1.06 | player speed calc (`world/player.ts` / main.ts speed application) |
| gatherSpeed | 0.85 + downlink × 0.04 | 0.85–1.25 | gather timer in `systems/gather.ts` |
| xpRate | 1 + distinctRegionsProbed × 0.06 | 1.0–1.30 | the xp-award choke point (wherever `addXp`/xp curve applies — find the single entry) |

`distinctRegionsProbed` = size of the set of route regions probed this session (NetworkSystem
tracks it). Fictional reading: 'the more of the world's roads you have walked, the faster you
learn.' Existing rows (simSpeed 0.85–1.15, goldRate 0.5–1.25, damage, enemyScale) unchanged.

---

## Implementation order & workflow

Per WORKFLOW.md: **one worktree, branch `n2a-veil-lens`**, static checks in the worktree,
merge to main, live-verify on main, tag. Commit sequence (conventional messages):
1. `feat(n2a): the Veil — scrub network jargon from all fiction strings` (A1+A2)
2. `feat(n2a): split log channels — Chronicle (fiction) vs Lens feed (truth)` (A3)
3. `feat(n2a): the Lens — full raw observatory (routes, identity, vessel, threads, feed)` (B)
4. `feat(n2a): lexicon — epithets and mood clauses derived from live vars` (C1)
5. `feat(n2a): mobs born from operations — echo-derived stats + specials` (C2)
6. `feat(n2a): move/gather/xp modifiers from live vars` (C3)

Estimated effort: 2–3 sessions (A ≈ 0.5, B ≈ 1, C ≈ 1–1.5).
Harness gotchas apply (WORKFLOW.md): verify via `window.__nw` in single-eval blocks;
`document.hidden`/rAF issues mean no screenshots — the user looks at localhost themselves.

## Acceptance checklist (run verbatim on main at `?seed=1234`)

1. **Lexicon grep gate:** case-insensitive grep of the banned list over
   `src/game/data/{enemies,skills,buildings,biomes,domains}.ts`, `src/game/world/domains.ts`,
   and all toast/log-message strings in `src/game/{systems,ui}` — every remaining match is an
   `id:` field, an API string value, or inside the truth layer (`systems/network.ts`
   netLog/labels, `data/network.ts` metric rows, the Lens renderer). Zero matches in `name:`,
   `desc:`, `title:`, toast, or Chronicle-bound strings.
2. `npm run typecheck` clean · `npm run build` green · `cargo test` green · regression suite
   passes at `?seed=1234&test`.
3. Force game over via `__nw` — death screen reads 'THE THREAD IS CUT' + new body, no banned words.
4. O opens the Lens: relabeled big numbers with browser-cap footnotes; Routes table has ≥ 1
   beacon row after one attack, plus the own-origin DNS/TCP/TLS/TTFB row.
5. Identity rows read 'unrevealed' pre-explore; populate after the first explore action;
   'local gateway — not observable from a browser' line present.
6. Vessel section populates (cores, memory, screen@DPR, GPU, language, timezone; storage/
   battery when available).
7. Threads lists all 7 modifiers + realm, each with live value, source, and clamp range;
   editing a `NW.NET` mapping in console changes the game value within one tick.
8. Hover/tap any Lens row → the three-line inspect box (SOURCE / ACTION / FLOWS INTO)
   appears; every `NET_METRICS` row and every `BeaconTarget` has non-empty inspect fields.
9. Trigger a night wave with a fresh echo: spawned foe has an epithet name and derived
   stats within the C2 clamps (`__nw.hordes.foes` dump vs `net.lastEcho`); Blinker/Shelled
   trigger correctly when hit.
10. Chronicle (L) shows zero raw units/suffixes across a full day-night cycle; the same
    events' technical lines appear in the Lens feed.
11. DevTools offline: realm becomes The Hollow, all modifiers sit at fallback values, no
    console errors, game playable.
12. Tag **`v0.17-n2a-veil-lens`**, push, and **STOP — playtest gate** (look/feel milestone:
    run the playtest agent, then await the user's verdict before N2b/G1-remainder).
