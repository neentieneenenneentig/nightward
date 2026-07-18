# X1 — Content Blitz: "The Deep Wilds"

> **Goal:** Triple the content density. Every system that exists gets 2-3× more rows.
> Content is data — new rows, not new engine code. Where new behaviors are needed,
> add a data-driven `behavior` field consumed by existing systems.

## X1.1 — Bestiary Expansion (15 new enemies)

### New Enemy Behaviors (data-driven, implemented once in combat.ts)
| Behavior | Description |
|----------|-------------|
| `charge` (default) | Walks to target, melee attacks |
| `ranged` | Keeps distance, fires projectiles |
| `siege` | Targets buildings, bonus structure damage |
| `exploder` | Runs in, explodes on death dealing AoE |
| `buffer` | Stays back, buffs nearby allies (+dmg/+speed aura) |
| `healer` | Stays back, heals nearby damaged allies |
| `summoner` | Periodically spawns minor minions |

### New Enemy Families
1. **Gnawer line**: Gnawer → Gnawer Pack-Leader → Gnawer Broodmother (summoner)
2. **Brute line**: Brute → Brute Mauler (exploder) → Brute Warlord (buffer)
3. **Wisp line**: Wisp → Wisp Lasher (ranged) → Wisp Veil-Weaver (healer)
4. **New — Shade line**: Shade (stealthy, fast) → Shade Reaper → Shade King
5. **New — Shell line**: Craggin (tanky, slow) → Craggin Bulwark (siege) → Craggin Titan (siege+)
6. **New — Swarm**: Mite (tiny, fast, weak, spawns in packs)

## X1.2 — Building Expansion (12+ new buildings)

### Wall Upgrades
- Stone Rampart (T2 wall, higher HP)
- Iron Bulwark (T3 wall, thorns reflect)

### Traps
- Spike Trap: damages enemies that step on it
- Tar Pit: slows enemies in a radius
- Flame Vent: periodic fire burst (synergy with fire system)

### Utility Buildings
- Workshop: +crafting speed aura
- Granary: increases berry/healing yield
- Shrine: buffs nearby towers (+range)
- Beacon: extends waystone chain radius

### More Towers
- Bolt Spire (T2, chain lightning between targets)
- Venom Spire (T2, poison DoT)
- Earthshaker (T3, stuns on hit)

## X1.3 — Item Explosion (20+ new items)

### Elemental Weapons (sidegrades, not linear upgrades)
- Fire Brand (fire damage, ignites ground)
- Frost Edge (chill on hit)
- Void Blade (lifesteal, less base damage)
- Storm Caller (chain lightning on kill)

### New Trinket Effects
- `lifesteal` — heal % of damage dealt
- `dodge` — % chance to avoid hits
- `thorns` — flat damage reflect (non-relic version)
- `gold_find` — bonus gold from kills
- `xp_boost` — bonus XP
- `night_vision` — less fog penalty at night

### Consumables
- Fire Bomb (AoE damage consumable)
- Frost Bomb (AoE slow)
- Repair Kit (heals a targeted building)
- War Horn (temporary +damage to all towers)

### New Material Tiers
- Void Shard (drops from high-tier enemies)
- Blessed Steel (crafted from silver + void)

## X1.4 — Biome Distinction

### Biome-Specific Features (new gatherables)
- Ethernet/Vale: Ancient Oak (rare fine_log), Sunbloom (rare herb)
- WiFi/Wilds: Shifting Stone (random ore), Wispflower (night-only herb)
- Cellular/Stormlands: Storm Crystal (crafting mat), Scorchberry (fire resist)
- Hollow: Echo Dust (resonance mat)

### Biome-Specific Enemies
- Each biome has 1-2 exclusive enemy types in its spawn table
- Biome enemies have higher weight in their home biome

### Biome Hazards
- Stormlands: lightning strikes during storms (cellular jitter triggers)
- Wilds: shifting terrain (tiles randomly change type at night)
- Vale: none (safe)
- Hollow: degradation (buildings slowly lose HP)

## X1.5 — Lens Deepening

### New Browser APIs to Harvest
| API | Lens Stat | Game Effect |
|-----|-----------|-------------|
| Geolocation API | lat/lng | Biome flavor, day length |
| Battery API | level, charging | Resource yield, regen rate |
| `navigator.deviceMemory` | device RAM | World size, entity cap |
| `navigator.hardwareConcurrency` | CPU cores | Tick rate, AI update freq |
| `Intl.DateTimeFormat` | timezone | Day/night offset, season |
| Performance.memory | usedJSHeapSize | "Veil Pressure" difficulty scalar |
| `navigator.language` | locale | UI flavor text |
| Screen Wake Lock | wake lock state | "Vigil" bonus (can't sleep = stronger) |

### New Lens Tabs
- **Veil**: Network metrics (existing)
- **Pulse**: Device/performance metrics (new)
- **Sky**: Geolocation/weather/time (new)
- **Echoes**: Boss echoes + soul gear levels (existing)
- **Codex**: Bestiary + building index (new)
