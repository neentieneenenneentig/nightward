# NIGHTWARD

**Your internet connection is the world you're dreaming, and you only get one dream.**

A ~15-minute browser survival-RPG: gather, craft, build a fortified hold, and fight off
night hordes and roaming boss lords — all shaped by your live network connection, and all
inside one finite character lifespan that ages in real time and ends in death of natural
causes whether or not anything kills you first. Reload for a new connection-driven world
and a shot at a better Legacy Score.

Live browser network metrics — RTT, jitter, bandwidth, connection type, real clock —
drive every mechanic: terrain, resource flows, day/night pacing, enemy spawns, difficulty.
Two people on the same world seed get different experiences because their connections
differ.

Built on a Rust→WebAssembly simulation core with a 100% procedurally generated pixel-art
renderer. Zero hosted assets, zero backend, zero persistence — the world lives exactly as
long as your tab does, and even a run that ends peacefully doesn't survive a reload. The
one thing that persists: a local leaderboard of past runs' scorecards.

**Full design doc: [`docs/GDD.md`](docs/GDD.md)** — the source of truth for what the game
is. This README is a pitch; that file is the reference.

## Core loop

Gather resources → craft gear → build territory → survive the night hordes, inside a
~15-minute lifespan that ages in real time regardless of how the fight goes. Every
number — spawn rates, regen speed, enemy difficulty, even the day/night cycle — is driven
by your live network conditions. Fast internet = your territory thrives. Jittery WiFi =
chaotic combat. The run ends when your hall falls, or when the years catch up — either
way, you get a Legacy Score and a shot at a better run.

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

- ✅ Walkable infinite procgen world, 24 writable materials, Rust/wasm world engine with
  dual-grid autotile rendering, cliff ledges, and a real fire cellular automaton
- ✅ Gathering, crafting (67 items / 45 recipes across 3 crafting skills), 8 RS-style skills
- ✅ Territory: hall/walls/huts/traps/utility buildings + 15 towers in tiered upgrade paths,
  anchor-chained placement via waystones with disconnect decay
- ✅ Weighty combat (windup→active→recovery, telegraphed enemies, per-swing damage rolls)
  vs. 25 enemy types incl. 5 world-boss domain lords
- ✅ Progression: Soul Gear (per-slot leveling gear), 5 boss Echoes, a 40-node Loom passive
  tree, 5 unique boss relics
- ✅ The Wire: live network metrics (19 tracked, 22 game mappings) drive sim speed, gold
  rate, enemy scale, damage rolls, vitals, and more — with full graceful degradation
- ✅ The Veil (pure-fantasy fiction) & the Lens (`O` key — every raw network number, with
  inspect-mode source/action/consumer breakdowns)
- ✅ Survival vitals (Vigor/Resolve decay-and-restore pressure)
- ✅ **The Lifespan**: a hard ~15-minute run — your character ages in real time and the run
  ends in death of natural causes if nothing kills you first — plus a Legacy Score
  leaderboard replacing the old "how long was the tab open" metric
- ✅ Grimdark Chrome UI skin (100% CSS, no image assets), procgen particles/post-processing,
  procedural WebAudio SFX + mood music

Full design reference: [`docs/GDD.md`](docs/GDD.md). Build history / what's next:
[`docs/plans/ROADMAP.md`](docs/plans/ROADMAP.md).

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

In the browser console (available in every build, dev or production):
- `window.NW.CFG` — live game config (editable at runtime)
- `window.NW.MATS` — material table
- `window.NW.NET` — live network metrics + mappings (editable at runtime)
- `window.__nw` — sim state, systems, `step()`, `craft()`, `paint()`, and the regression
  suite (`__nw.regression.run()`, or load with `?test`)

Debug hotkeys (`.` +30s clock, `n` skip to night, `j` force wave, `g` +gold, `m`
+materials, `h` heal, `u` god mode, `p`/`Shift+P` paint brush) only register in `npm run
dev` — they're stripped from production builds (`npm run build`), so a live game never
ships with a free-resources hotkey reachable by a real player.
