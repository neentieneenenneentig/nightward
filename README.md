# NIGHTWARD

**Your internet connection is the game world.**

Live browser network metrics — RTT, jitter, bandwidth, connection type, real clock —
drive every mechanic: terrain generation, resource flows, day/night cycle, enemy spawns,
difficulty scaling. Two people on the same world seed get totally different experiences
because their connections differ. Same tab, same seed, different world depending on where
and how you're connected.

Built on a Rust→WebAssembly simulation core with a 100% procedurally generated pixel-art
renderer. Zero hosted assets, zero backend, zero persistence — the world lives exactly as
long as your tab does.

## Core loop

Gather resources → craft gear → build territory → survive the night hordes.
But every number — spawn rates, regen speed, enemy difficulty, even the day/night
cycle — is driven by your live network conditions. Fast internet = your territory
thrives. Jittery WiFi = chaotic combat. Switch from Ethernet to cellular = the world
reshuffles. Toggle airplane mode = hard reset.

## Stack

- **PixiJS v8** — WebGPU renderer with WebGL fallback (`?gl` forces WebGL)
- **TypeScript + Vite** — data-driven architecture, live-tweakable at runtime
- **Rust → WebAssembly** (`nightward-core`) — simulation engine: writable world,
  per-chunk cellular automata (fire, wetness), sparse override store
- Fixed-timestep sim (30 Hz) decoupled from rendering; DOM overlay UI (RPGUI skin)

## Run

```
npm install
npm run wasm        # build the Rust/wasm core (once, and after Rust edits)
npm run dev         # http://localhost:5173
npm run typecheck
npm run build       # static site in dist/ — host anywhere (GitHub Pages)
```

World seed: `?seed=12345` in the URL. Share a URL, share a world seed — different
connections make different worlds from the same seed.

## What's shipped

- ✅ Walkable infinite procgen world with noise biomes + domain-warped coasts
- ✅ Gatherable resources, inventory, equipment slots, RS-style skill leveling
- ✅ Crafting: weapons, armor, tools, consumables, buildings
- ✅ Territory system: hall, huts, walls, watchtowers, population, tribute
- ✅ Night horde waves scaling with night # + territory value
- ✅ Weighty combat: windup→active→recovery state machine, telegraph tells
- ✅ Soul Gear: soul-bound gear with per-slot XP leveling
- ✅ Day hunts: daytime prey mobs, wander/despawn
- ✅ Rust/wasm world engine: 16 materials, writable overrides, chunk streaming
- ✅ Dual-grid autotile rendering with pseudo-3D cliff ledges
- ✅ Fire cellular automaton: wind-driven spread, burnout, glow overlay, firemaking skill
- ✅ Pixel UI skin (RPGUI), event log, SFX system, god mode

## What's next (Batch 5 — "The Wire")

- 🚧 **N1 — Network Seed**: live browser network metrics → game parameters
- 🚧 **N2 — Wire Realm**: network-themed biomes, connection events as game events
- 🚧 **G1 — Visual upgrade**: SUBPIX rendering, post-processing, particles
- 🚧 **W6 — Scoreboards**: connection-uptime leaderboards
- 🚧 **G2 — Juice pass**: screen shake, hit-stop, knockback, attack trails
- 🚧 **N3 — Living Network**: network metrics drive the fire/wetness sim
- 🚧 **A1 — Local agent** (stretch): optional native binary for deeper metrics

Full roadmap: [`docs/plans/ROADMAP.md`](docs/plans/ROADMAP.md)

## Privacy & external endpoints

This game uses your browser's Network Information API to drive gameplay. To measure
real-world latency ("echoes"), it may fire no-cors `fetch()` requests to public
websites (CDN edges, news favicons, search engines) when you perform in-game actions —
attack, gather, build, craft, explore, or survive the night. These requests carry
your browser's implicit IP address just like visiting any website would. No data
leaves the browser except the implicit IP in requests to the listed public endpoints;
nothing is stored server-side.

Your IP, city, ISP, and ASN are fetched from ipify.org, ipapi.co, and Cloudflare
only after your first `explore` action — "scrying reveals who you are." Until then,
identity fields show `...`.

A full list of contacted endpoints is logged to the browser console at boot.

## Live tuning

In the browser console:
- `window.NW.CFG` — live game config (editable at runtime)
- `window.NW.MATS` — material table
- `window.NW.NET` — live network metrics (coming in N1)
- `window.__nw` — sim state, systems, step(), craft(), paint()

Debug hotkeys: `.` +30s · `n` skip to night · `j` force wave · `g` +gold ·
`m` +materials · `h` heal · `u` god mode · `p` paint brush · `f` ignite
