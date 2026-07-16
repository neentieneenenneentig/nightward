# N2 — The Wire Realm (content + theming pass)

**Updated 2026-07-16 per N1.5 design decisions D1 + D3. Split into N2a (theming + rifts +
realm HUD, cheap) and N2b (material effect hooks — real engine work, own playtest gate).**

Goal: replace every trace of the "dream world" with network terminology. The game's systems
stay identical — this is a re-theme, not a genre change. After N2, the player gathers
resources in the "WiFi Wilds," builds territory to defend against hordes, and watches the
realm shift when their beacon-echo profile changes.

Prereq: N1 merged (`v0.16-n1-network-seed`) — `NW.NET` + network event log entries + HUD
readout must be functional. This brief builds on the N1 data plumbing to add CONTENT that
uses it.

## Design principles

1. **The metaphor must be legible.** A player who knows nothing about networking should still
   understand the flavor — "Ethernet Plains = safe, Cellular Chaos = dangerous." The technical
   terms are thematic dressing; the gameplay implications (stability, resource density, danger
   level) are what players actually feel.
2. **The existing game loop is sacred.** Gather → craft → build → survive nights. Nothing in N2
   changes the mechanics — it changes what things are CALLED and what they LOOK like.
3. **Network events are moments, not interruptions.** A rift doesn't pause gameplay — it's a
   2-second visual flourish that the player plays THROUGH. Online/offline is a deliberate
   mechanic, not a crash.
4. **Every string must be replaced.** Zero references to "dream," "nightmare," "sleep," "wake,"
   "dreamer," "dreaming," "slumber," "awaken," "night terror," "oneiric" in any user-facing
   text. The grep is the acceptance test.

## D1 update — Realm selection is profile-based (2026-07-16)

**Rift trigger = realm-profile band crossing, not connection.type.** The realm is derived from
the beacon echo latency profile (rolling median + variance over recently-probed beacons):
- median < 80ms & low variance → civilized realm (Ethernet Plains)
- median < 80ms & high variance → wild realm (WiFi Wilds)
- median ≥ 80ms or very unstable → chaos realm (Cellular Chaos)
- Loopback = actually-offline (snap.online === false)

Real connection.type switches (Android only) may still trigger bonus rifts. A realm-profile
change (sustained band crossing, debounced ≥30s) becomes the rift trigger for N2a.

## D3 update — Flavor is mystical resonance; physical world stays physical (2026-07-16)

**The item/skill/building rename tables below (Wood → "Copper Packet", etc.) are DROPPED.**
Wood is wood, trees are trees. The network theme lives in the overlay systems: Pulse/Flow/Flux,
beacons, echoes, rifts, realms, resonance crits — i.e., what the code already does. The N2
brief's original rename tables are preserved below as a design artifact but marked DROPPED.

## Flavor text replacement — the complete map

### World & setting

| Old term | New term | Context |
|----------|----------|---------|
| The Dream | The Wire | World name, title screen, log messages |
| Dreamer | Node | Player character |
| Nightmare | Data Storm / Packet Storm | Threat events, boss names |
| Awakening | Connection / Link-Up | Game start |
| Slumber | Offline / Disconnected | Death / game-over state |
| Dream Realm | Network Realm | Biome descriptor |
| Oneiric | Digital / Networked | Adjective for magical/special items |
| Night Terror | DDoS Wraith / Latency Wraith | Elite enemies |
| Dream Shard | Bandwidth Crystal | Premium currency / rare resource |
| Sleeper | Loopback Entity | Neutral NPCs (if any) |
| Dreamforge | Signal Foundry | Crafting station |
| Dreamweaver | Protocol Weaver | Advanced crafter class |
| Lucid | High-Bandwidth | Quality tier prefix |
| Fading | Degrading / Throttling | Decay mechanic |

### Biomes (replacing old dream-themed biome names)

| Old biome | New biome | Connection type | Palette | Character |
|-----------|-----------|----------------|---------|-----------|
| — (new) | **Ethernet Plains** | ethernet | Green/gold, stable earth tones | Safe, civilized. Regular resource density. Predictable enemy patterns. The "home" realm. |
| — (new) | **WiFi Wilds** | wifi | Blue/purple, vibrant but erratic | Wild, unpredictable. Variable resource density (richer but riskier). Enemies have jittery movement. Rift events possible. |
| — (new) | **Cellular Chaos** | cellular | Red/orange, harsh contrast | Hostile, shifting. Scarce resources. Tougher enemies. Frequent rifts. High-risk, high-reward. |
| — (new) | **Loopback** | unknown/offline | Gray/white, muted | Static, neutral. Fixed resource density. No rifts. The "offline mode" realm — playable, but not live-driven. |

### Materials (NOTE — onEnter/onStay/onExit hooks DO NOT EXIST in R1)

**⚠️ FALSE CLAIM in original brief:** R1 materials have static props like `speedMult` — there
are NO `onEnter`/`onStay`/`onExit` hooks. Adding active per-tile callbacks requires real
engine work in both TS and Rust. This is deferred to **N2b** (own playtest gate).

The material effect concepts below are preserved as a design sketch for N2b but are NOT
implementable without engine changes:

| Material key | Name | Color | Effect | Rarity |
|-------------|------|-------|--------|--------|
| `packet_loss` | Packet-Loss Zone | Magenta (#FF00FF) | `onStay`: movement speed ×0.5. 1 damage per 2s. | Common in Cellular, rare in WiFi |
| `latency_spike` | Latency Spike | Cyan (#00FFFF) | `onEnter`: stun for 500ms. `onExit`: speed boost ×1.5 for 2s (rebound). | Uncommon in WiFi/Cellular |
| `bandwidth_bloom` | Bandwidth Bloom | Gold (#FFD700) | `onStay`: resource regen ×2.0. Gather yield ×1.5. | Rare, any realm |
| `dead_zone` | Dead Zone | Dark gray (#333333) | `onStay`: no building, no gathering. Sim skips this tile 50% of ticks. | Common in Cellular during high jitter |
| `firewall` | Firewall Barrier | Orange-red (#FF4400) | Blocks projectiles. Entities cannot cross. Destructible (500 HP). | Uncommon in Ethernet |
| `dns_cache` | DNS Cache | Light blue (#88CCFF) | `onEnter`: reveals minimap in radius 5 tiles for 10s. | Rare, any realm |
| `routing_loop` | Routing Loop | Purple (#8800FF) | `onStay`: every 3s, teleport entity to random tile within 3-tile radius. | Rare in Cellular |
| `signal_booster` | Signal Booster | Bright green (#00FF44) | `onStay`: soul gear XP gain ×2.0. Building construction speed ×1.5. | Very rare, any realm |

### Enemies (re-theming + new) — DROPPED per N1.5 D3

Enemy rename tables are dropped. The network theme lives in overlay systems. Preserved as
design artifact:

| Old enemy | New enemy | Realm | Behavior change |
|-----------|-----------|-------|----------------|
| Night Stalker | Packet-Loss Wraith | Cellular | Glitchy movement (jitter-based position offset). Phases through firewall barriers. |
| Dream Eater | Bandwidth Leech | WiFi | Drains gold tribute while alive. Spawns near high-bandwidth-bloom zones. |
| Shadow Hound | Latency Hound | Any (night) | Speed scales with current jitter. High jitter = very fast. |
| Nightmare Lord | DDoS Wyrm | Cellular (boss) | Spawns "packet flood" minions (swarm of 10 small fast enemies). Storm visual. |
| (new) | Signal Wisp | Ethernet (day) | Passive. Follows player. If protected for 60s, drops bandwidth crystal. |
| (new) | Proxy Brute | WiFi | Slow but high HP. Reflects 20% of melee damage back. |

### Buildings (re-theming) — DROPPED per N1.5 D3

| Old building | New building | Description |
|-------------|-------------|-------------|
| Hall | Node Core | "The heart of your connection. If this falls, you go offline." |
| Hut | Signal Relay | "Extends your network reach. Houses connected Nodes." |
| Wall | Firewall | "Blocks unwanted traffic. Enemies must break through or route around." |
| Tower | Watchtower (unchanged, but flavor updated) | "Monitors for incoming threats. Auto-engages at range." |
| Campfire | Beacon | "A stable signal in the dark. Keeps the local realm from degrading." |

### Skills (re-theming) — DROPPED per N1.5 D3

| Old skill | New skill | Description |
|-----------|-----------|-------------|
| Gathering | Packet Harvesting | "Extract useful data from the terrain." |
| Crafting | Signal Processing | "Transform raw packets into useful constructs." |
| Building | Network Architecture | "Design and deploy network infrastructure." |
| Combat | Protocol Enforcement | "Defend the network from hostile traffic." |
| Firemaking | Signal Amplification | "Boost local signal strength. Creates beacons." |
| (new, if added) | DNS Scrying | "Reveal the map by resolving distant domains." |

### Items (re-theming) — DROPPED per N1.5 D3

Wood is wood, trees are trees. The network theme lives in the overlay systems. These renames
are preserved as a design artifact only — do NOT implement.

## Rift events — detailed spec

A "rift" occurs when the realm profile band crosses a threshold (N1.5 D1 — beacon-echo
median+variance, not connection.type). This is the core "wow moment" of the network theming —
the world visibly reshapes around the player.

### Trigger conditions
- Realm-profile band crossing (median <80ms→≥80ms, or variance crosses 2000/8000 thresholds)
  with ≥30s debounce (see N1 transition debouncing spec)
- Connection.type switches (Android only) as a BONUS path — profile is primary
- Online→offline and offline→online also count as rifts
- Manual trigger: `NW.NET.triggerRift('cellular')` for testing

### Rift sequence (total duration: ~2 seconds)

```
Frame 0 (t=0ms):
  - Freeze sim for 200ms (sim pause — everything stops)
  - Screen flash: full-screen colored overlay at 40% opacity
    - ethernet → wifi: blue flash
    - wifi → cellular: red flash
    - cellular → ethernet: green flash
    - online → offline: gray flash
    - offline → online: white flash
  - Log event: "Realm Rift: Ethernet Plains → WiFi Wilds"
  - Toast: "The realm shifts..."

Frame 1 (t=200ms):
  - Particle burst: 100 particles at random positions across the screen
    - Color: biome accent color (blue for WiFi, red for Cellular, green for Ethernet, white for Loopback)
    - Behavior: explode outward from player position, fade over 1.5s
  - World regeneration begins (terrain tiles recomputed from new biome table)
  - Chunks within viewport radius rebaked

Frame 2 (t=500ms):
  - Sim resumes
  - Overlay fades out over 500ms
  - Particles continue fading
  - New biome's ambient tint applied

Frame 3 (t=2000ms):
  - All particles expired
  - Rift complete
```

### Rift cooldown
- Minimum 30 seconds between rifts. If a second type change occurs during cooldown:
  - Queue it. Apply when cooldown expires.
  - If a THIRD change occurs while one is queued, replace the queued change (only the
    most recent transition matters).
- Rationale: prevents WiFi flapping from spamming rifts. A 30s cooldown means at most
  2 rifts per minute — enough to be noticeable, not enough to be annoying.

### What changes during a rift
- Terrain palette and material weights switch to the new biome's table
- Enemy spawn tables switch (existing enemies stay — they're "scarred" by their origin realm)
- Day/night tint may shift (each biome has its own tint curve)
- Wind strength/direction changes (for R2 fire CA + N3 wind integration)
- HUD biome name updates immediately

### What does NOT change during a rift
- Player position (player stays where they are)
- Buildings (they persist — your network infrastructure survives realm shifts)
- Inventory, soul gear, skill levels (character state is permanent)
- Existing enemies on screen (they persist, marked with their origin realm's visual flair)
- Depleted resource nodes (they stay depleted — the new biome's resources spawn around them)

## Online/offline as a deliberate mechanic

### Going offline
- Trigger: `navigator.onLine` → `false`, or manual toggle (airplane mode)
- Effect: sim pauses immediately. "CONNECTION LOST" overlay at 60% opacity. HUD shows
  "OFFLINE" in red. World is still rendered (frozen) behind the overlay.
- Player can still: view inventory, read log, check stats. Cannot: move, gather, craft,
  build, fight.
- Toast: "Connection lost. The realm holds its breath."
- This is the "pause menu" — but themed. The player INTENTIONALLY goes offline to pause.

### Coming back online
- Trigger: `navigator.onLine` → `true`
- Effect: rift event (offline→online transition). New realm based on current connection type.
  World regenerated around player. ALL enemies despawned and respawned (offline→online is a
  hard reset). Buildings persist.
- Toast: "Reconnected. The realm reshapes around you."
- The offline period is recorded in the "connection age" stat — offline time doesn't count
  toward uptime (W6 feature).

### Design intent
Online/offline is not a failure state — it's a deliberate game mechanic. Going offline:
- Pauses the game (useful for taking a break without dying)
- Resets enemy spawns (useful if overwhelmed)
- Costs uptime (affects scoreboard standing)
- Is on-theme ("I'm going offline for a bit" = "I'm entering the Loopback")

## Network event → visual effect mappings

These are the cosmetic effects triggered by network conditions. All use the G1 particle
system and post-processing pipeline (when available). For N2, implement with simple sprite
overlays and tint changes — G1 will upgrade them to proper particles and shaders.

| Event | Trigger | Visual (N2 — basic) | Visual (post-G1 — upgraded) |
|-------|---------|---------------------|----------------------------|
| Rift | Connection type change | Full-screen color flash + 100-particle burst | Shader transition (pixel-sort glitch effect) + particle storm |
| Jitter spike | Jitter > 50ms | Player sprite wobbles (random ±2px offset for 2s) | Entity wobble shader + glitch particles |
| Bandwidth dip | Downlink drops >50% in one poll | Screen desaturates 20% for 5s | Color grading LUT shift + vignette intensifies |
| Packet loss | Dead zone appears | Tile flickers (alternates between normal and dark every 500ms) | Glitch shader on affected tiles + spark particles |
| High latency | RTT > 200ms | Sim speed visibly slows + HUD RTT value pulses red | Slow-motion post-process (frame blending) |
| Stable connection | Jitter < 10ms for >60s | HUD shows "Stable Link" in green + subtle gold sparkle at player | Golden particle aura + bloom on player |
| Data storm (N3) | Jitter > 80ms sustained | (N2: no-op — N3 feature) | Full-screen particle storm + damage ticks |

## HUD expansion (N2)

The N1 3-line HUD expands to 5 lines:

```
╔══════════════════════════════════════════════════╗
║ RTT  45 ms  │  ↓10.2 Mbps  │  🛜 wifi  4g       ║
║ Realm: WiFi Wilds  ████████░░  82% stable        ║
║ Sim  0.91×  │  Gold 1.01×   │  Enemies 1.00×     ║
║ Uptime: 03h 42m  │  Rifts survived: 2            ║
║ AGENT ● connected  (optional, from A1)            ║
╚══════════════════════════════════════════════════╝
```

- Line 1: Raw network stats (from N1)
- Line 2: Biome name (colored by realm) + rift stability bar (0–100%, decays over 5 min,
  resets on rift; >80% = bonus stats)
- Line 3: Game multipliers (from N1)
- Line 4: Uptime + rift count (N2 adds rift count; uptime is W6)
- Line 5: Agent status (A1 — shown only when agent is available)

Toggle: `I` key (same as N1). Default: OFF (press `I` to show). Setting persisted in
`localStorage` as UI preference.

## Flavor text sweep — implementation approach

### Step 1: Find all occurrences
```bash
# In the worktree:
grep -rn "dream\|nightmare\|sleep\|wake\|dreamer\|dreaming\|slumber\|awaken\|oneiric" src/game/ --include="*.ts"
```

### Step 2: Categorize each occurrence
- **User-facing string** → replace with network equivalent from the map above
- **Variable/function name** → rename (e.g., `dreamPhase` → `realmPhase`)
- **Comment** → update for accuracy
- **Type/interface name** → rename if exported; leave if internal and not user-facing
- **Log message template** → update to network terminology

### Step 3: Replace systematically
Work through each file, replacing strings. Keep the same string length/format where possible
to avoid layout changes. If a string becomes significantly longer/shorter, adjust the UI
element that displays it.

### Files to update (non-exhaustive — the grep is authoritative)
- `src/game/data/items.ts` — item names, descriptions
- `src/game/data/buildings.ts` — building names, descriptions
- `src/game/data/skills.ts` — skill names, descriptions
- `src/game/data/soulgear.ts` — gear flavor text
- `src/game/data/enemies.ts` — enemy names, descriptions
- `src/game/data/materials.ts` — material names, descriptions
- `src/game/data/features.ts` — feature names (trees, rocks, etc.)
- `src/game/systems/log.ts` — log message templates
- `src/game/ui/toast.ts` — toast message templates
- `src/game/ui/ui.ts` — HUD labels, title screen text
- `src/game/ui/styles.ts` — any color/theme references
- `src/game/world/worldgen.ts` — biome names, zone names
- `src/game/world/art.ts` — any hardcoded flavor strings in render code
- `src/game/rules.ts` — any flavor strings in game-over / win conditions
- `src/game/state.ts` — type/interface names
- `src/main.ts` — title/header strings

## Acceptance checklist (post-merge verification)

Static, in the worktree:
1. `npm run typecheck` + `npm run build` green. (No wasm changes in N2 — `npm run wasm` only
   needed if Rust changed, which it shouldn't for N2.)
2. `cargo test` — all existing tests pass (no Rust changes expected).
3. **Zero "dream" references:** `grep -rni "dream\|nightmare\|sleep\|wake\|dreamer\|dreaming\|slumber\|awaken\|oneiric" src/game/` returns NO matches. (Comments and internal variable names are exempt but should be updated where practical.)

Live on main, at `?seed=1234`:
4. **Biome visible:** HUD shows biome name on line 2. Biome matches connection type:
   ethernet → "Ethernet Plains", wifi → "WiFi Wilds", cellular → "Cellular Chaos".
5. **Rift on type change:** manually set `NW.NET.snap.connectionType = 'wifi'` → within 5s
   debounce, rift triggers: screen flash (blue) + particle burst + log entry + toast.
6. **Rift cooldown works:** trigger a rift, immediately trigger another → second rift is
   queued, not immediate. Observe 30s gap between rifts.
7. **Offline pauses sim:** set `NW.NET.snap.online = false` → sim freezes, "CONNECTION LOST"
   overlay appears. Player cannot move. Inventory still accessible.
8. **Online reshapes world:** set `NW.NET.snap.online = true` → rift triggers (white flash),
   world regenerates, enemies despawned and respawned.
9. **Material effects work:** find a packet-loss zone (spawn one manually via console if needed:
   `__nw.worldCore.set_material(x, y, MATERIALS.packet_loss)`) → player moves at half speed
   when standing on it.
10. **Flavor text coherence:** play through gather→craft→build→night cycle. Read log entries,
    toast messages, item descriptions. All use network terminology. Nothing references dreams.
11. **Enemy re-theme:** spawn a Packet-Loss Wraith → name visible in combat log. Bandwidth
    Leech drains gold while alive.
12. **Rift stability meter:** observe the stability bar (line 2 of HUD). It decays over ~5
    minutes. Trigger a rift → resets to 100%. When >80%, observe small bonus to stats
    (verify via `NW.CFG` values being multiplied).

## Explicitly OUT of scope
- G1 visual upgrades (particle system, post-processing, SUBPIX) — all visual effects use
  simple sprite overlays until G1 upgrades them
- N3 sim integration (network-driven CA) — material effects are TS-side only, Rust doesn't
  read network params yet
- W6 scoreboards — uptime tracking exists but the death screen and leaderboard are W6
- A1 local agent — agent indicator is placeholder only
- New gameplay systems — this is a re-theme, not new mechanics. Material effects use
  existing hook infrastructure (from R1's material system)
