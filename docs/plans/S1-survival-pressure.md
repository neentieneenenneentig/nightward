# S1 — Survival Pressure (The Hunger)

**Written 2026-07-17 from the C1 playtest verdict. The user walled in their hall, survived
3 nights with zero threats, and had no reason to fight, hunt, or expand. The game has no teeth.
This brief defines what "teeth" means and how to ship it.**

## The playtest that triggered this

**Build:** Hall at (86,36) surrounded by 7 walls (260 HP each). Player at (57,23) exploring during
daytime. HP 100/100, 402 gold, zero skill XP, zero echoes, zero gear. 3 bosses alive, none hunting.
0 foes on screen.

**Verdict:** "I have no reason to do anything. I just surrounded myself with walls and trees. No
mobs reach us, no monsters spawn, just nothing." The core loop is missing a **driver** — a reason
to leave safety, kill things, build outward, take risks. The answer is NOT just "more monsters"
— it's a combination of **survival stats that decay** (forcing action) + **massively increased
threat** (making walls and nights actually dangerous) + **rewards that matter** (tying survival
to progression).

## The design: "Vitals" — two survival stats

NIGHTWARD already has the death screen: *"THE THREAD IS CUT."* This is the fiction: your life
is a thread being woven. The two vitals are:

| Vital | What it is | Decays at | Restored by | At zero |
|-------|-----------|-----------|-------------|---------|
| **Vigor** | Hunger + thirst (one stat — keep it simple) | ~1 point per 15s (4 min from full→empty, adjustable) | Killing mobs (+per mob), gathering berries/herbs, cooking at campfire | HP drains at 2/sec until you eat |
| **Resolve** | Sanity (the thread frays) | Faster at night (2×), near bosses (3×), when idle >30s (2×) | Killing (+large chunk), building structures, standing near your hall, surviving a night (+big chunk) | Move speed −30%, damage taken +50%, screen-edge vignette pulses red |

**Why two stats, not four:** Hunger/thirst/energy/stamina collapse into Vigor. Sanity stands alone
because it answers a different question: "why fight instead of hide?" Stamina-as-a-resource is
deferred — the combat windup/recovery state machine already gates actions.

**Cap:** 100 each. Start full on fresh run. Death-scatter respawn: reset to 50 each (you come back
weakened — death already scatters you across the map; now it also starves you).

### Vigor — "you must hunt"

- **Decay:** 1 per 15s baseline. Config: `CFG.vitals.vigorDecayPerSec`.
- **Restore on kill:** +8 per regular mob, +25 per boss. Scales with mob level slightly.
- **Restore on gather:** +3 per berry/herb node gathered (nodes already exist; Sunleaf, Moonbell, etc.).
- **Restore on campfire:** standing within 3 tiles of a lit campfire → +2/sec. (Campfires already
  exist via the fire system — this gives them a second purpose beyond charcoal.)
- **At zero:** HP drains 2/sec. Toast: "You're starving." If HP hits 0 from starvation, game over
  with death message: "The Thread withered — you starved in the dark."

### Resolve — "you must fight and build"

- **Decay:** 1 per 30s baseline during day, 1 per 15s at night (2×), 1 per 10s when a boss is
  within 20 tiles and hunting (3×), 1 per 15s when the player hasn't attacked, gathered, built,
  or crafted in the last 30s (2× — "idle hands"). These multipliers stack multiplicatively.
- **Restore on kill:** +12 per regular mob, +40 per boss.
- **Restore on build:** +5 per building placed.
- **Restore on survive night:** +30 when dawn breaks.
- **Restore near hall:** +1 per 5s when within 8 tiles of your Hearthstone.
- **At zero:** The thread frays. Move speed ×0.70, damage taken ×1.50. Screen-edge vignette pulses
  red at 0.5 Hz. Toast: "Your resolve crumbles — the dark closes in." Chronicle: "The Thread frays
  at the edges. You feel the dark pressing in."

## The Wire in your blood — every vital parameter is network-derived

NIGHTWARD's thesis: your internet connection IS the game world. The vitals system follows the
same law — none of the decay or restore rates are static. They're all `CFG` base values ×
`net.get(key)` → transformed multiplier. Same pattern as sim speed, gold rate, enemy scaling.

Two players on the same seed with different connections will feel different survival pressure.
Fast, stable connection = the world sustains you. Slow, jittery connection = the world starves you.
This is not random noise — it's **legible**: the Observatory shows WHY your vigor is draining
faster, and the fix is always the same (hunt, kill, build).

### Vigor — driven by bandwidth & latency

| Parameter | Network source | Intuition | Mapping |
|---|---|---|---|
| `vigorDecayPerSec` | **`downlink`** (bandwidth Mbps) | Low bandwidth = resource scarcity = faster hunger. Your connection is starved, so are you. | ≥10 Mbps → 0.8× (slower decay — plenty). 5–10 → 1.0×. 2–5 → 1.4×. 0.5–2 → 2.0×. <0.5 → 3.0× (rapid starvation). Fallback (no API): 1.0×. |
| `vigorPerKill` | **`rtt`** (round-trip latency ms) | Low latency = clean, satisfying kill = more nourishment. Laggy kills feel hollow. | ≤20ms → 1.3×. 20–50 → 1.0×. 50–150 → 0.8×. 150–400 → 0.6×. >400 → 0.4×. |
| `vigorPerGather` | **beacon-echo latency** (fastest discovered endpoint RTT) | Fast probe = rich gathering node. The nearest data center feeds you. | Same banding as `vigorPerKill`. |
| `vigorPerCampfireSec` | **`deviceMemory`** (RAM GB) | More memory = campfire burns steadier. Your machine tends the flame. | ≥8GB → 1.5×. 4–8 → 1.0×. <4 → 0.6×. |

### Resolve — driven by connection tier & stability

| Parameter | Network source | Intuition | Mapping |
|---|---|---|---|
| `resolveDecayPerSec` | **`effectiveType`** (connection tier) | Worse connection = the dark presses harder. 4g is civilization; 2g is the wild. | `'4g'` → 1.0×. `'3g'` → 1.5×. `'2g'` → 2.5×. `'slow-2g'` → 4.0×. Fallback: 1.0×. |
| `resolvePerKill` | **`echoJitter`** (successive same-beacon echo deltas, ms — finer-grained than `connection.rtt` jitter, which Chrome quantizes to 25 ms buckets) | Stable connection = satisfying kill = mind restored. Jitter = chaotic kill = less peace. | <5ms → 1.4×. 5–15 → 1.0×. 15–30 → 0.7×. 30–60 → 0.5×. ≥60 → 0.3×. |
| `resolvePerBuild` | **`hardwareConcurrency`** (CPU cores) | More cores = stronger anchor. Building with a powerful machine reinforces your thread. | ≥8 cores → 1.5×. 4–7 → 1.0×. <4 → 0.7×. |
| `resolveNearHallPerSec` | **`deviceMemory`** (RAM GB) | More RAM = hall is a stronger sanctuary. Your machine remembers you. | ≥8GB → 1.5×. 4–8 → 1.0×. <4 → 0.6×. |
| `resolvePerSurviveNight` | **night-RTT stability** (% of night where RTT stayed in its median band) | A stable night = a triumphant dawn. A chaotic night = barely held on. | ≥90% stable → 1.5×. 70–90% → 1.0×. 50–70% → 0.7×. <50% → 0.4×. |
| `resolveNightMult` | **real clock hour** (`Date.now()` → local hour) | Late-night play = deeper dark = faster fray. 2–5am is the witching hour. | 6pm–midnight → 1.0×. Midnight–2am → 1.5×. 2am–5am → 2.5×. 5am–6pm → 0.8×. |

### Lens / Observatory

The Observatory's "Vitals" row shows:
```
Vigor 78/100  decay 0.089/s (downlink 3.2Mbps → ×1.4)
Resolve 45/100  decay 0.050/s (3g → ×1.5, night → ×2)
```

Every vital event (kill restore, gather restore, zero-penalty trigger) logs a Lens
`'vitals'` entry with the network context — same pattern as combat/economy/horde log entries.

### CFG stores BASE values; network applies multipliers

The CFG values are the "neutral connection" defaults (10 Mbps downlink, 50ms RTT, 4g tier, 5ms
jitter, 4 cores, 4GB RAM). The network system applies multipliers on top — exactly like sim
speed, gold rate, and enemy scaling already do. `VitalsSystem.update()` calls
`this.ctx.net.get('vigorDecay')` etc. each tick. No new machinery — just new mapping rows.

The user's words: "10 times more monsters." The current config produces ~20 mobs by night 3.
The new config targets ~150 by night 3, with walls that actually break.

| Config key | Old value | New value | Rationale |
|---|---|---|---|
| `horde.baseCount` | 9 | **25** | First hostile night should feel like a siege, not a skirmish |
| `horde.perNight` | 5.5 | **18** | Each night escalates hard — night 5 = ~115 mobs |
| `horde.perTerritory` | 0.22 | **1.2** | Expanding territory actually summons danger now |
| `horde.maxAlive` | 90 | **250** | Headroom for the bigger waves |
| `horde.spawnIntervalSec` | 1.1 | **0.55** | Trickle becomes a flood — they pour in twice as fast |
| `horde.spawnRadiusTiles` | 14 | **10–18** (spread) | Some spawn closer, some farther — no safe ring |
| `horde.foeDmgToBuildings` | (implicit, ~1×) | **3× multiplier** | Walls actually break now — 260 HP vs. 3× damage means ~15 hits to break a wall, not 45 |
| `horde.hpGrowth` | 1.21 | **1.12** | More mobs but each slightly less tanky — kill-feel stays snappy |
| `horde.dmgGrowth` | 1.15 | **1.10** | Same reasoning: quantity over per-unit quality |

### Daytime spawns — also juiced

| Config key | Old | New |
|---|---|---|
| `dayspawn.maxAlive` | 5 | **18** |
| `dayspawn.spawnIntervalSec` | 9 | **3** |
| `dayspawn.minRadiusTiles` | 8 | **5** (closer = can't ignore) |
| `dayspawn.despawnTiles` | 28 | **35** |

## Vitals in the HUD

Top bar, to the right of HP:
```
❤ 100  ◈ 78  ✦ 45
```
- ❤ = HP (existing)
- ◈ = Vigor (new — a grain/sheaf icon)
- ✦ = Resolve (new — a thread/star icon)

Each shows current value. At ≤25, the number pulses red. Tooltip on hover: "Vigor: 78/100 —
restore by hunting or gathering." / "Resolve: 45/100 — restore by fighting, building, or
surviving nights."

Veil-clean names in fiction. The Chronicle calls them "vigor" and "resolve." Never "hunger
bar" or "sanity meter."

## Vitals in the Lens

Lens inspect shows the raw numbers plus decay source:
```
vigor 78/100  decay 0.067/s  last restored: gnawer kill +8 (12s ago)
resolve 45/100  decay 0.033/s (night ×2)  last restored: wall placed +5 (47s ago)
```

## CFG stubs (add to `config.ts`)

```typescript
vitals: {
  vigorMax: 100,
  vigorDecayPerSec: 1 / 15,       // 4 min full→empty
  vigorPerKill: 8,
  vigorPerBossKill: 25,
  vigorPerGather: 3,
  vigorPerCampfireSec: 2,          // standing near campfire
  vigorStarveDmgPerSec: 2,         // damage when vigor=0
  resolveMax: 100,
  resolveDecayPerSec: 1 / 30,      // daytime baseline
  resolveNightMult: 2,             // ×2 at night
  resolveBossNearMult: 3,          // ×3 when hunting boss within 20 tiles
  resolveIdleMult: 2,              // ×2 when no action in 30s
  resolveBossNearTiles: 20,
  resolveIdleSec: 30,
  resolvePerKill: 12,
  resolvePerBossKill: 40,
  resolvePerBuild: 5,
  resolvePerSurviveNight: 30,
  resolveNearHallPerSec: 1 / 5,    // +0.2/sec near hall
  resolveNearHallTiles: 8,
  resolveZeroSpeedMult: 0.70,
  resolveZeroDmgTakenMult: 1.50,
  resolveZeroVignetteHz: 0.5,
  respawnVigor: 50,
  respawnResolve: 50,
},
```

## Files

- **`src/game/data/config.ts`** — `CFG.vitals` block (above) + horde/daypawn rebalance.
- **`src/game/systems/vitals.ts`** (NEW) — `VitalsSystem`:
  - `update(dt)` — decay both vitals; apply zero-penalties; clamp [0, max].
  - `onKill(mobDef, isBoss)` — restore vigor + resolve.
  - `onGather()` — restore vigor.
  - `onBuild()` — restore resolve.
  - `onSurviveNight()` — restore resolve.
  - `onRespawn()` — reset to 50/50.
  - Called from `hordes.ts` (kill, and dawn — the dawn event is `HordesSystem.onDawn()`;
    `daynight.ts` is pure tint math with no hooks), `gather.ts` (gather), `build.ts`
    (place), `combat.ts` (respawn — death & scatter live there, `CFG.player.respawn*`).
- **`src/game/state.ts`** — `player.vigor: number`, `player.resolve: number`, init to 100.
- **`src/game/ui/ui.ts`** — HUD chips for vigor + resolve (◈ and ✦ icons, tooltips).
- **`src/game/ui/floaters.ts`** — "+8 vigor" / "+12 resolve" floaters on restore events
  (smaller, quicker than combat floaters, color-coded: green for vigor, gold for resolve).
- **`src/main.ts`** — construct `VitalsSystem`, tick in `sim()`.

## Gauntlet additions

1. **testVitalsDecay** — step 60s, assert vigor < 100 and resolve < 100; decay rate matches CFG.
2. **testVigorStarve** — set vigor to 1, step past 0, assert HP draining; set vigor to 0, step
   5s, assert HP decreased by ~10.
3. **testResolveZero** — set resolve to 0, assert move speed mult applied, damage taken mult
   applied.
4. **testVitalsRestore** — kill a mob → vigor +8, resolve +12; gather → vigor +3; build → resolve
   +5; survive night → resolve +30.
5. **testVitalsHUD** — assert vigor and resolve chips visible in DOM after boot.
6. **testHordeScale** — on night 3 with 0 territory, assert horde count ≥ ~60 (was ~20).

Suite count goes 38 → 44 (the stub review of 2026-07-17 added a 38th test,
`testNetMapIntegrity`, which pins the vitals mapping rows; S1 adds the six above).

## Explicitly out of scope

- Stamina/energy as an action-gating resource — the combat windup state machine already does this.
- Disease, temperature, weather — future batches.
- Vitals affecting NPCs or buildings — player-only for v1.
- Food items as inventory objects — vigor restores from the ACTION (kill, gather), not from
  consuming an item. Food-as-items is a C4/C5 concern when gear slots and inventory pressure matter.

## Acceptance (live, at `?seed=1234`)

1. Fresh game: vigor 100, resolve 100 visible in HUD.
2. Wait 30s: both decay visibly.
3. Kill a day-spawned mob: "+8 vigor" "+12 resolve" floaters, bars tick up.
4. Let vigor hit 0: HP starts draining, "You're starving" toast.
5. Let resolve hit 0: move slower, red vignette pulses, "Your resolve crumbles" toast.
6. Survive night 1: resolve jumps +30 at dawn.
7. Night 1 horde: ~25+ mobs (was 9), walls take noticeable damage.
8. `?seed=1234&test` → 44/44 green.

## Ordering

**S1 ships BEFORE C2.** Reasoning: C2 (waystones) lets you expand territory forever, but if
there's no pressure to expand, it's a solution to a problem that doesn't exist. S1 creates
the problem. C3 (Loom) gives you tools to solve it. C4 (Armory) gives you gear to survive it.
C5 (Buildings) gives you better defenses.

The C-batch order becomes: **C1 (echoes) → S1 (survival pressure) → C2 (waystones) → C3 (loom)
→ C4 (armory) → G1-P (painterly verdict) → C5 (buildings rework).**
(Amended same day: **U1 lens-UI unification slots between S1 and C2** — see
`U1-lens-ui-unification.md`.)

## Stub review record (2026-07-17 evening, chief-of-staff session)

The CFG.vitals block + NET_GAME_MAP rows landed as stubs in `6059209`. Review findings,
all fixed in-tree the same evening:

1. **Three of the six mapping rows were dead or wrong on arrival:**
   - `Resolve Decay` had an off-by-one across the whole tier ladder — the engine encodes
     `4g=1, 3g=2, 2g=3, slow-2g=4` (see NET_METRICS `effectiveType`), but the transform
     treated 4g as `tier <= 0`. A normal 4g connection got the 3g band (×1.5) and 2g got
     the slow-2g band (×4.0). Fixed; tier encoding now documented at the row.
   - `Resolve Per Kill` used `netKey: 'echoJitter'` — not a metric key, so `get()`
     returned 0 and the row was permanently ×1.4. Fixed by promoting **echoJitter to a
     real NET_METRICS row** (`Echo Flux`), which also let the Move Speed row drop its
     ctx workaround and display truthfully in the Lens.
   - `Resolve Per Build` used `netKey: 'hardwareConcurrency'` — the metric key is
     `cpuCores`. Permanently ×0.7 as committed. Fixed.
2. **Three more rows added** (their drivers already exist as metrics): `vigorPerGather`
   ← `endpointLatency`, `vigorPerCampfire` ← `deviceMemory`, `resolveNightMult` ←
   `timeOfDay` (real-clock witching-hour bands). **`resolvePerSurviveNight` is the one
   mapping with NO row yet** — it needs a night-RTT-stability tracker in NetworkSystem;
   build it at S1 implementation.
3. **Dormant tagging:** all nine vitals rows carry `dormant: true` and the Lens THREADS
   section renders them dimmed with a `dormant` tag. The Lens shows raw truth — a
   mapping whose target nothing consumes must not look live. **S1 implementation must
   remove the flags as it wires each target** (grep `dormant: true`).
4. **Gauntlet:** new `testNetMapIntegrity` (suite test #38) asserts every NET_GAME_MAP
   netKey resolves to a NET_METRICS key, targets are unique, and pins the neutral-
   snapshot values + tier/core/jitter bands of every vitals row. It fails on exactly the
   three bugs above if reintroduced.

## Spec decisions locked at review (taste-flag if you disagree)

- **Which kills feed vitals:** player swings AND echo kills restore vigor/resolve; tower
  kills do NOT. Rationale: echoes only fire with you standing in the fight, but towers
  kill while you hide — if towers fed you, the walled-in-AFK failure S1 exists to kill
  comes straight back as "build towers, never leave". (Tower rule extended: auto-damage
  never trains combat, tower kills never feed vitals.) Boss kills count for whoever
  provoked — a boss kill is never AFK (C1 rule).
- **`foeDmgToBuildings` is a NEW config key** — foe→building damage currently has no
  multiplier (implicit 1× through `hordes.damageBuilding`). Add the key and apply it at
  the damage site, don't bake it into per-foe dmg (bosses share that path).
- **`spawnRadiusTiles` 10–18 spread needs a config shape change** — today it's a single
  number. Ship it as `spawnRadiusMinTiles`/`spawnRadiusMaxTiles` and roll per spawn.
- **Perf gate for the 10× rebalance:** `maxAlive` 250 (was 90) must be proven, not
  assumed — add an acceptance item: night-5 wave at 250 alive holds ≥50 fps on the dev
  machine, and the Gauntlet horde test steps a 200+ wave without frame-budget collapse.
- **Fiction naming:** the campfire building's display name is **Watchfire** (id
  `campfire`). Chronicle lines say Watchfire, never "campfire".
- **Combat click-restart (added at ship):** clicking Attack during windup or active
  phases restarts the swing with immediate damage — spam-clicking = rapid single-target
  DPS at the cost of never reaching recovery (you stay locked in the swing animation).
  Recovery-phase buffering unchanged. This gives skilled players a high-APM damage
  ceiling while keeping the state machine simple.

## ✅ RESOLVED: gather was doubly `simSpeed`-sensitive (surfaced + fixed 2026-07-17)

**Resolution: option (b) — dropped the N1 `speed *= getGameValue('simSpeed')` line in
`gather.ts`.** Gather now slows with the sim uniformly via `effectiveDt` only, scaling
`1/simSpeed` like every other system. Verified live at `simSpeed 0.85`: `need` 2.07 → 1.76
(the removed 0.85 factor), frames-to-complete 74 → 63; Gauntlet stays green (200/38).
Original analysis kept below for the record.

---


Not an S1 item per se, but found while fixing the `testGathering` budget bug during the
S1 review. `simSpeed` (rtt-derived, clamped 0.85–1.15) modulates gather **twice**:
1. In `gather.ts tryStart()` — the N1 line `speed *= getGameValue('simSpeed')`, which
   shrinks `need = gatherSec / speed`.
2. In `main.ts sim()` — `gather.update(effectiveDt, …)` where `effectiveDt = dt·simSpeed`,
   the universal lag-compensation scaling every system receives.

Net effect: real gather time ∝ `1/simSpeed²`. Gather is the **only** gameplay system that
double-applies `simSpeed` (combat/hordes/fire/echoes get `effectiveDt` only). At the 0.85
floor, gather is ~1.38× slower than intended vs. the ~1.18× a single application gives.

**Options (user's call — leaving as-is for now):**
- **(a) Accept it** — "network fate hits gathering hardest" is on-theme; keep both.
- **(b) Drop the N1 gather-specific line** — gather then slows with the sim uniformly
  like everything else via `effectiveDt`. One-line removal, cleanest.
- **(c) Feed `gather.update` raw `dt`** — gather ignores global sim-speed and is governed
  only by `need`. Inconsistent with other systems; not recommended.

Recommendation: **(b)** unless the extra sensitivity is deliberate. Either way it's a
balance change → own commit, not folded into the review.

## ✅ Shipped (2026-07-17)

- `VitalsSystem` (`src/game/systems/vitals.ts`) — vigor & resolve decay, restore hooks,
  zero-penalties (HP drain, speed −30%, dmg taken +50%, red vignette).
- `CFG.vitals` block in `config.ts` with all 19 keys.
- Horde rebalance: `baseCount` 25, `perNight` 18, `maxAlive` 250, `spawnIntervalSec` 0.55,
  `spawnRadiusMinTiles`/`spawnRadiusMaxTiles` (10–18 spread), `foeDmgToBuildings` 3×,
  `hpGrowth` 1.12, `dmgGrowth` 1.10.
- Dayspawn rebalance: `maxAlive` 18, `spawnIntervalSec` 3, `minRadiusTiles` 5,
  `despawnTiles` 35.
- `foeDmgToBuildings` applied in `hordes.ts` `damageBuilding()` (not baked into per-foe dmg).
- Night-RTT stability tracker in `NetworkSystem` (`_nightRttSamples`, `onDawn()` computes
  `_nightRttStability`).
- `resolvePerSurviveNight` NET_GAME_MAP row (non-dormant from the start).
- All 9 vitals NET_GAME_MAP rows non-dormant (wired to real consumers).
- HUD chips for vigor (`◈`) and resolve (`✦`) in top bar.
- Vital floaters: green for vigor, gold for resolve.
- 6 new Gauntlet tests (38→44): `testVitalsDecay`, `testVigorStarve`, `testResolveZero`,
  `testVitalsRestore`, `testVitalsHUD`, `testHordeScale`. All green.
- `attack()` in `combat.ts`: clicking during windup/active now **restarts the swing**
  (deals damage immediately + resets windup). Spam-clicking = rapid single-target DPS at
  the cost of never reaching recovery (locked in swing animation). Recovery-phase buffering
  unchanged. This makes high-APM combat rewarding and gives skilled players a way to
  convert clicks into DPS.
- Branch: `s1-survival` (off `c1-echoes`).
