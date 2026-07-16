# M2 — Combat Feel & Network Observatory

> **Created:** 2026-07-16 | **Status:** done ✅  
> **Context:** User feedback session — bag navigation fix, combat XP concern,
> network data visibility, scaling alignment.

---

## 1. Bag Tab Navigation Fix ✅ DONE

**Problem:** Tab key got stuck in the bag panel; only arrow keys worked.

**Root cause:** `focusNext()` queried ALL `.nw-slot` elements, including **empty**
equipment slots that have no `tabIndex`. When Tab tried to focus an empty slot,
`.focus()` silently failed, leaving focus on the current element. The next Tab
press found the same `activeElement`, advanced index, hit the same empty slot,
and looped infinitely — Tab felt "stuck."

**Fix (2026-07-16):**
- Filtered action items to only elements with `tabIndex >= 0`
- Added a focus-landing guard: if `.focus()` doesn't actually move focus,
  skip forward to the next element
- Same filter applied to header chrome (`.nw-tab`, `.nw-x`)

---

## 2. Combat XP — It Already Exists

**Reality:** `HordeSystem.hurt()` (hordes.ts:281) awards combat XP on kill:
```ts
addXp(state, 'combat', f.def.xp);
```

Every enemy has an `xp` field (Gnawer=14, Brute=40, etc.) and grants it on death.
The combat skill is `'Protocol Enforcement'` in the Skills panel. Also awards:
- Gold (from enemy's gold range)
- Loot drops (rollLoot)
- Soul XP for worn charm (charmXpPerKill)
- Death particles, sound, log entry

**Why it feels invisible:**
1. XP values are modest (14-40 XP, curve base=400 → ~29 Gnawers for level 2)
2. No floating XP numbers during combat (unlike gather "+15xp" toasts)
3. The combat skill row in the Skills panel is buried below gathering/crafting

**Recommendation (future M2.x):** Add a combat XP floater (`+14 combat xp`) on
kill, same style as gather toasts. Consider a kill-streak multiplier or
night-survival bonus.

---

## 3. Scaling Alignment

### Current state

| Layer | Scales with | Mechanism |
|-------|------------|-----------|
| Player base dmg | — | `CFG.player.baseDmg` (4) |
| Weapon dmg | Soul level | `soulStat(state, 'weapon')` per level |
| Armor def | Soul level | `soulStat(state, 'armor')` per level |
| Ring dmg bonus | Soul level | `soulStat(state, 'ring')` |
| Amulet def bonus | Soul level | `soulStat(state, 'amulet')` |
| Charm regen | Soul level | `soulStat(state, 'charm')` |
| Attack speed | Weapon soul level | `1/(1 + lvl * k)`, floor 0.5× |
| Enemy count | Nights survived + territory score | `baseCount + perNight*(n-1) + perTerritory*score` |
| Enemy hp/dmg | Nights survived | `hp * (1 + perNightGrowth * nights)` (in config) |
| Enemy types | Nights survived | `fromNight` gate + `weight` distribution |

### What's working
- Equipment scaling via soulgear is solid — weapons, armor, trinkets all level
- Enemy variety gates on nights survived (Brute at night 3, etc.)
- Horde size scales with player expansion (territory = risk)

### What needs attention
- **Combat skill level has NO mechanical effect.** It only gates nothing (no
  combat-level-locked recipes currently). A high combat level should do
  *something* — crit chance, bonus damage, faster attack speed?
- **Enemy hp/dmg scaling** exists in config (`perNightGrowth`) but is not tuned
  against soulgear progression. Need a balance pass aligning:
  - Expected soul level at night N
  - Expected weapon/armor tier at night N
  - Enemy stats at night N
- **No visual scaling feedback** — enemies don't look bigger/tougher as nights
  progress (they could tint, grow, or gain particle auras)

---

## 4. Network Data — Current Usage

### Metrics collected (13 total)

| # | Key | Source | Unit | Use |
|---|-----|--------|------|-----|
| 1 | `rtt` | `navigator.connection.rtt` + fetch timing | ms | Drives sim speed |
| 2 | `downlink` | `navigator.connection.downlink` | Mbps | Drives gold rate |
| 3 | `jitter` | Computed from RTT samples | ms | Logged, not mapped yet |
| 4 | `effectiveType` | `navigator.connection.effectiveType` | tier 1-4 | Drives enemy scaling |
| 5 | `connectionType` | `navigator.connection.type` | ethernet/wifi/cellular | Drives biome/realm |
| 6 | `online` | `navigator.onLine` | bool | Affects vignette, stability |
| 7 | `timeOfDay` | `new Date()` | 0-1 frac | Syncs day/night to real clock |
| 8 | `cpuCores` | `navigator.hardwareConcurrency` | cores | Pushed to Rust core |
| 9 | `deviceMemory` | `navigator.deviceMemory` | GB | Pushed to Rust core |
| 10 | `endpointLatency` | `fetch()` to cloudflare.com/cdn-cgi/trace | ms | Pushed to Rust core |
| 11 | `pageDnsTime` | `performance.getEntriesByType('navigation')` | ms | Pushed to Rust core |
| 12 | `pageTlsTime` | (same) | ms | Pushed to Rust core |
| 13 | `pageTtfb` | (same) | ms | Pushed to Rust core |

### Game mappings (5 active)

| Target | Driven by | Effect |
|--------|-----------|--------|
| `simSpeed` | `rtt` | High RTT → slow sim (lag compensation) |
| `goldRate` | `downlink` | More bandwidth → more gold |
| `enemyScale` | `effectiveType` | Worse connection → harder enemies |
| `dayPhase` | `timeOfDay` | Real clock syncs day/night cycle |
| `realm` | `connectionType` | Ethernet=stable, WiFi=wild, Cellular=chaos |

### Where to see it

1. **Network HUD** — Press `F1` in-game. Shows RTT, bandwidth, connection type,
   realm name, stability bar, sim speed multiplier, gold rate, enemy scale.
2. **`window.__nw.ctx.net`** — Live NetworkSystem instance. Access `net.snap`,
   `net.mappings`, `net.get(key)`, `net.getBiome()`, `net.getStability()`.
3. **Game log** — Press `L`. Network transition events and metric probes are
   logged with timestamps. Export as .txt via the 💾 button.
4. **Rust core** — `net.packForCore()` pushes a `Float32Array` of 13 values
   every frame. Rust reads these as `net_params`.

---

## 5. Network Dashboard Concept (Future)

A dedicated "Network Observatory" panel (new tab or F2 toggle) showing:
- **Live sparklines** for RTT, jitter, bandwidth (last 60s)
- **Connection timeline** with biome transitions marked as "rifts"
- **Historic log browser** — filterable by kind (rtt/jitter/transition/endpoint),
  with timestamps, exportable
- **Current realm card** with biome name, stability %, lord name, mood color
- **Active modifiers** — sim speed, gold rate, enemy scale with trend arrows
- **Endpoint probe history** — latency to cloudflare.com over time

---

## 6. Next Steps (Priority Order)

1. **M2.1 — Combat XP floaters** — Show "+X combat xp" toast on kill, same
   style as gather XP toasts. Quick win.
2. **M2.2 — Combat skill mechanical effect** — Give combat level a gameplay
   benefit (e.g., +0.5% crit chance per level, or +1 base damage per 5 levels).
3. **M2.3 — Network Observatory panel** — New panel (key: `O`? `F2`?) with
   live sparklines, realm card, rift history.
4. **M2.4 — Balance pass** — Align soulgear progression curve with enemy
   scaling. Define expected player power at nights 1/5/10/20.
5. **M2.5 — Enemy visual scaling** — Bigger/tinted enemies as nights progress,
   particle auras on bosses.

---

## 7. Out of Scope / Deferred

- Per-hit combat XP (XP on hit, not just on kill) — would require careful
  anti-farming design
- Full player power curve spreadsheet — do this in M2.4
- Push notification / service worker for network changes when tab is backgrounded

---

## 8. M2.1 — Combat XP Floaters ✅ DONE (2026-07-16)

**Implementation:**
- Added `SKILL_NAME` lookup to `hordes.ts` (maps skill IDs → display names)
- Added `toast(`+${f.def.xp} ${SKILL_NAME['combat']} xp`)` on every kill in `hurt()`
- Shows "+14 Protocol Enforcement xp" (for Gnawer), "+40 ..." (for Brute), etc.
- Same toast style as gather XP toasts — makes the existing XP system visible
- Level-up toasts still fire on top (e.g., "Combat reached level 2!")

**File:** `src/game/systems/hordes.ts`

---

## 9. M2.2 — Combat Skill Mechanical Effect ✅ DONE (2026-07-16)

**Implementation:**
- Added `skillLevel` import to `combat.ts`
- Damage formula: `baseDmg + weaponDmg + floor(combatLevel / dmgBonusPerLevel)`
- Config knob: `CFG.combat.dmgBonusPerLevel = 5` → +1 base damage per 5 combat levels
- At combat level 10: +2 base damage; at level 25: +5; at level 50: +10
- Tune live: `window.NW.CFG.combat.dmgBonusPerLevel = 3` for more impact

**Files:**
- `src/game/systems/combat.ts`
- `src/game/data/config.ts`

---

## 10. M2.3 — Network Observatory Panel ✅ DONE (2026-07-16)

**Implementation:**
- New panel toggled with **O** key (works regardless of debug mode)
- **Live sparklines** (canvas-drawn) for RTT (0-300ms), Bandwidth (0-100Mbps), Jitter (0-60ms) — last 60s at 1Hz
- **Realm card** with biome name (colored by biome hex), stability % bar (green→yellow→red)
- **Active modifiers** with trend arrows:
  - Sim Speed (inverse of RTT trend)
  - Gold Rate (follows bandwidth trend)
  - Enemy Scale (follows jitter trend)
  - Uptime & connection type display
- History buffers added to `NetworkSystem` (`historyRtt`, `historyJitter`, `historyBw`)
- `net.recordHistory()` called every 1s in the render loop
- `drawSparkline()` helper renders min/max-labeled sparklines on canvas

**Files:**
- `src/game/systems/network.ts` (history buffers + `recordHistory()`)
- `src/main.ts` (panel DOM, keyboard handler, `updateObservatory()`, `drawSparkline()`)

---

## 11. M2.4 — Balance Alignment Map

### Expected progression at key night milestones

| Night | Combat Lvl | Weapon | Soul Wpn Lvl | Player Dmg | Enemy Types | Foe HP (Gnawer) | Foe Dmg | Horde Size |
|-------|-----------|--------|-------------|------------|-------------|-----------------|---------|------------|
| 1 | 1-2 | Fists (or Copper if looted) | 1 | 4-8 | Gnawer only | 20 | 5 | ~9 |
| 5 | 4-7 | Copper Blade (likely) | 2-4 | 8-13 | Gnawer, Brute, Wisp | 20×1.21^4=~43 | 5×1.15^4=~9 | ~31 |
| 10 | 8-14 | Iron Blade (boss drop) | 5-10 | 15-24 | All non-boss | 20×1.21^9=~110 | 5×1.15^9=~17 | ~59 |
| 20 | 15-25 | Iron Blade, soul 15+ | 12-20 | 24-40 | Heavy mix | 20×1.21^19=~750 | 5×1.15^19=~71 | ~114 |

### Player damage breakdown
- **Fists:** 4 base + combat bonus (level/5)
- **Copper Blade:** 4 base + 4 weapon + combat bonus = 8 + combat/5
- **Iron Blade:** 4 base + 9 weapon + combat bonus = 13 + combat/5
- **Soul weapon:** +0.18 per weapon soul level above 1
- **Soul ring:** +0.06 per ring soul level (on top, if equipped)

### Identified gaps
1. **Night 1-3 is the hardest relative to player power** — Gnawers at 20 HP with fists (4 dmg) = 5 hits each. Good: early survival tension. OK.
2. **Night 5-8 gap:** Brutes (70 HP base × 1.21^4 ≈ 149 HP) arrive when player likely has Copper Blade (~8 dmg). Brute takes ~19 hits solo. Consider reducing Brute HP or increasing Copper Blade damage. **ACTION:** Increase Copper Blade weaponDmg from 4→6.
3. **Night 10+:** Iron Blade (9 weaponDmg) is a boss drop (15% from Thornwarden). If player hasn't killed a boss by night 10, the gap widens dangerously. Consider adding an Iron-tier craftable weapon (requires iron bar + fine_log). **DEFERRED to M3.**
4. **Night 20:** Enemy HP scaling (1.21^n) outpaces player damage growth. By night 20 a Gnawer has ~750 HP. Combat level 25 gives +5 damage, soul weapon 20 gives +3.4, Iron Blade +9, base +4 = ~21.4 dmg → 35 hits per Gnawer. The horde size (~114) makes this impossible. **ACTION:** Consider HP growth cap or per-enemy-type scaling instead of uniform multiplier. **DEFERRED to M3.**

### Recommendations
- **Short-term (M2):** Bump Copper Blade weaponDmg 4→6 (done below)
- **Mid-term (M3):** Add craftable Iron-tier weapon; add per-enemy-type scaling curves
- **Long-term:** Consider diminishing returns on enemy HP growth (logarithmic instead of exponential)

---

## 12. Copper Blade Tuning (M2.4 follow-up)

**Change:** `sword_copper` weaponDmg: 4 → 6
**Rationale:** Closes the Night 5-8 gap. Copper Blade at 6 weaponDmg gives 10 base damage (vs 8 before), reducing Brute kill time from ~19 hits to ~15 hits — still weighty but less grindy.

**File:** `src/game/data/items.ts`

