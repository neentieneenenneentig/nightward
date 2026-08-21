// ============================================================================
// THE BALANCE FILE. Every gameplay number lives here — tweak freely, reload,
// play. Systems read these live; nothing is hardcoded elsewhere.
// (In the browser console: window.NW.CFG is this object, editable at runtime.)
// ============================================================================

export const CFG = {
  player: {
    speed: 160,              // world px/s (32 px = 1 tile)
    maxHp: 100,
    regenPerSec: 1.5,        // hp/s during the DAY only
    meleeRange: 40,          // px
    baseDmg: 4,              // fists; weapons add weaponDmg on top
    deathGoldLossPct: 0.25,  // fraction of gold dropped on death
    // roguelike death: you don't respawn at the Node Core — the network scatters
    // you far out into the massive world and you must find your way home.
    respawnMinTiles: 40,
    respawnMaxTiles: 110,
    startingItems: [
      { id: 'axe_flint', n: 1 },
      { id: 'pick_flint', n: 1 },
    ],
  },

  // RS-style curve: xp to go from level L to L+1 = base * growth^(L-1)
  // B1: retuned for the 15-min run window — copper immediately, iron mid-run,
  // silver as a good run's reward, star as aspirational.
  xp: {
    base: 60,
    growth: 1.12,
    maxLevel: 40,
  },

  // Weighty combat: attacks commit through windup → active (damage resolves
  // here once) → recovery, instead of an instant flat-cooldown hit.
  combat: {
    windupSec: 0.22,
    activeSec: 0.12,
    recoverySec: 0.30,
    arcDeg: 110,             // narrower than the old 150° — weighty means aimed
    moveSlowMult: 0.35,      // movement speed mult while mid-swing (windup/active)
    attackSpeedPerSoulLevel: 0.01, // envelope × 1/(1 + weaponSoulLevel × k)
    attackSpeedFloor: 0.5,   // ...but never faster than this fraction of base
    telegraphSlackPx: 8,     // grace distance when an enemy's telegraphed hit resolves
    dmgBonusPerLevel: 5,     // +1 base dmg per N combat levels (M2.2: combat skill now matters)
    restartMinIntervalSec: 0.12, // min time between click-restarts (caps autoclickers, preserves high-APM skill)
  },

  // Soul Gear: every equip slot is a soul-bound tool that levels on its own
  // (much steeper/higher-ceiling) curve — hundreds of hours to reach maxLevel,
  // RuneScape-style. Tune live via window.NW.CFG to taste.
  soulgear: {
    // L1: retuned for the hard 15-minute run — xpBase 900 needed 300 landed
    // swings just to reach soul level 2 (most of a whole run spent only
    // swinging). 250/5 keeps the curve's long-tail shape (still hundreds of
    // actions to maxLevel) but makes the FIRST few levels reachable within a
    // single run's combat budget, so gear growth is something you can feel.
    xpBase: 250,
    xpGrowth: 1.085,
    maxLevel: 100,
    weaponXpPerSwing: 5,  // per swing that lands at least one hit (was 3)
    armorXpPerHit: 3,     // per hit taken while armor is worn (was 2)
    toolXpPerUse: 6,      // per successful gather with that tool class (was 4)
    ringXpPerSwing: 3,    // per landed swing while a ring is worn (was 2)
    amuletXpPerHit: 3,    // per hit taken while an amulet is worn (was 2)
    charmXpPerKill: 8,    // per kill while a charm is worn (×10 from bosses) (was 5)
  },

  // L1: The Lifespan — a hard, run-length clock the player cannot out-turtle.
  // Ages via REAL wall-clock time (see systems/lifespan.ts), not sim time, so
  // the cap holds regardless of network jank and never fires during a
  // synchronous __nw.step() test. "10 years per real minute" is the flavor
  // pace the user asked for; baseRunMinutes is the actual target session
  // length. Aging only ever speeds up (never slows below 1×) as vigor/resolve
  // run low — neglect can cut a run short, but nothing extends it past the cap.
  lifespan: {
    startAge: 16,                  // a green recruit, dreamed into being
    yearsPerRealMinute: 10,
    baseRunMinutes: 15,            // the hard target
    varianceMinutes: 1.5,          // seeded ± jitter → a 14–16.5 min window
    vitalsSwingPct: 12,            // max % faster aging from neglected vitals
    warnMinutesRemaining: 1.5,     // "the years weigh heavy" banner begins
    criticalMinutesRemaining: 0.4, // heartbeat vignette begins
  },

  // L1: Legacy score — a single, transparent number for "which run was best."
  // Weights are data so they can be tuned live without touching engine code.
  legacy: {
    weights: {
      nightSurvived: 500,
      kill: 8,
      bossKill: 300,
      building: 40,
      loomPoint: 150,
      gold: 0.5,
      yearLived: 4,      // per year past startAge when the run ended
      oldAgeBonus: 1000, // finishing the dream beats being cut short
    },
  },

  time: {
    daySec: 240,             // length of daytime
    nightSec: 100,           // length of night
    // day/night overlay tints (css colors, multiply-blended over the world)
    tintDay: [255, 255, 255] as [number, number, number],
    tintDusk: [255, 150, 110] as [number, number, number],
    tintNight: [58, 70, 140] as [number, number, number],   // deeper, colder dark
    tintDawn: [255, 200, 150] as [number, number, number],
    transitionSec: 18,       // how long dusk/dawn blends take
  },

  // the network world: each region is shaped by a Network Lord (see data/domains.ts)
  domain: {
    moodStrength: 0.18,      // how strongly a domain's tint colors the ambient light
    announce: true,          // toast + chime when you cross into a new domain
  },

  // limited sight — the unknown stays literally dark until you're upon it
  fog: {
    dayIntensity: 0.32,      // vignette strength by day
    nightIntensity: 0.66,    // ...and at night (less sight = more dread)
    bossExtra: 0.12,         // pulse darker while a world boss looms
  },

  // world bosses: domain lords that roam the map and converge on your territory
  worldBoss: {
    count: 3,                // how many stalk the world at once
    spawnRing: 1,            // which domain ring they start in (distance from home)
    roamSpeed: 14,           // px/s while wandering their domain
    huntSpeed: 30,           // px/s once they've caught your scent
    wakeTerritory: 8,        // territory score that triggers them toward you
    convergePerTerritory: 0.6, // + hunt speed per territory point (greed pulls them in)
    provokedSec: 25,         // landing a hit forces hunting=true for at least this long
    warnTiles: 22,           // proximity that triggers the danger warning
    attackReachPx: 30,       // how close before it can strike you / the hall
    hpBase: 700, hpPerLevel: 1.5, hpPerTerritory: 12,
    dmgBase: 20, dmgPerLevel: 1.35,
    goldOnKill: [120, 240] as [number, number],
    reviveSec: 220,          // slain lords re-form deeper in the network, stronger
    levelPerRevive: 1,
    // M3: gold triggers boss aggression — the network senses your wealth
    wakeGold: 350,           // gold threshold that rouses bosses regardless of territory
  },

  // C1: Echoes of the Slain — global knobs; per-echo numbers are rows in data/echoes.ts
  echoes: {
    maxLevel: 8,             // re-kills past this deepen nothing
    minCooldownSec: 0.6,     // per-level cooldown reduction floors here
    // T5 verdict: Cinder Trail attempts REAL fire-CA ignition on every patch.
    // This is a kill-switch (flip false live via NW.CFG), not a someday-toggle.
    cinderIgnitesCA: true,
    orbitRadPerSec: 1.6,     // Null Orb angular speed
    orbContactImmunitySec: 0.8, // per-foe grace between orb contact hits
  },

  // C4/A1: the seven item-effect hooks that shipped with a registered handler
  // and NO consumer anywhere in the game.
  //
  // `registerEffect()` builds a registry and `applyEffect()` dispatches from it --
  // but nothing in the game has ever called `applyEffect()`. The eight LIVE hooks
  // are all consumed a different way: `activeEffects(state).has('key')` at the
  // site that cares, with the behaviour written inline there. The other seven had
  // a handler in the registry, a row in the affix table, a plain-language label in
  // the tooltip, and no path to the screen.
  //
  // The bill for that: four of the five domain-lord relics did nothing at all, and
  // 350 of the 750 suffix weight in A1's affix table -- very nearly half of every
  // rolled suffix -- was placebo. It also quietly falsified A1's own premise, that
  // "the fifteen effect hooks already work, so the suffix half is a data table".
  //
  // These are the numbers for the seven consumers that now exist. Tunable live
  // through NW.CFG like every other block here.
  itemEffects: {
    thornsPct: 0.30,        // share of a melee hit sent back to the attacker
    fireAuraSec: 2.0,       // seconds between aura ticks
    fireAuraDmg: 4,         // damage per tick, before the D5 roll
    fireAuraTiles: 2.2,
    chillAuraTiles: 3.0,    // foes this close to you move at chillAuraMult
    chillAuraMult: 0.80,
    regenBoostPct: 0.50,    // +50% daytime regen (the handler's own old comment)
    moveBurstSec: 2.0,      // how long a kill's burst of speed lasts
    moveBurstMul: 1.25,
    resonancePct: 0.25,     // +25% damage on everything the Echoes do
  },

  // A3: The ability bar. Every echo you hold keeps auto-firing exactly as it did
  // in C1 — this adds a SECOND, empowered form you press for, paid in Resolve.
  //
  // Resolve is the resource because the game has no mana and should not invent
  // one. Resolve is already a morale meter: it decays at night, near a lord, and
  // while idle, it is repaid by kills and by surviving to dawn, and it already
  // punishes you at zero (CFG.vitals.resolveZero*). Spending it on heroics is
  // what a morale meter is FOR, and it turns the one passive number on the HUD
  // into the most active one.
  //
  // The economy that makes the costs read: +12 resolve per kill, +40 per lord,
  // +30 at dawn, against costs of 14-22. So an active is roughly "one and a half
  // kills", and a night fight pays for its own heroics while a quiet run cannot
  // afford them. That asymmetry is the point.
  abilities: {
    enabled: true,           // escape hatch, same terms as CFG.loot.enabled — off = pure C1 autofire
    slots: 4,                // you can hold 5 echoes; the last lord forces a choice
    // A cast that would leave you in debt is refused. A cast that leaves you at
    // ZERO is allowed — walking yourself into the resolve-zero penalty to land
    // one more nova is a decision, and the game should let you make it.
    globalLockSec: 0.25,     // stops one keypress-repeat burst emptying the meter
    fizzleToastCooldownSec: 2.0, // don't spam "not enough resolve" on a held key
  },

  // A5: Sockets & Weaves. Gear rolls 0–3 sockets by rarity; threads socket in
  // order; a recognised sequence completes a weave. The socket RANGES are data
  // (data/weaves.ts, alongside the rarity tables they decorate); the bonus
  // NUMBERS live here with every other balance knob.
  weaves: {
    enabled: true,           // escape hatch, same terms as CFG.loot.enabled
    // Threads drop from domain lords (the elite of this build until A2). Two
    // per kill, matching the lord's element. A full clear of five lords is ten
    // threads — enough for Long Night AND Ironwake, or Hollow Song plus two.
    threadsPerLordKill: 2,
    // The Long Night — Rime · Rime · Ember. Flat damage multiplier, night only.
    longNightDmgMul: 1.25,
    // Hollow Song — Null · Tide. Extra Resolve per kill, on top of the S1 base.
    hollowSongResolve: 4,
    // Ironwake — Thorn · Thorn. Melee attackers take this share of the damage
    // they deal back, and are stunned for this long.
    ironwakeReflectPct: 0.30,
    ironwakeStunSec: 0.8,
  },

  // C3: The Loom — per-run passive tree point income and keystone magnitudes.
  //
  // B3.a: the keystone numbers used to be literals scattered across loom.ts,
  // economy.ts and combat.ts — where they were literals at all. Five of the eight
  // clauses below were not implemented anywhere; the tree advertised them and the
  // game ignored them. They live here now for the same reason every other balance
  // number does: one file, live-editable through window.NW.CFG.
  loom: {
    pointsPerBossKill: 2,   // L1: a second income source — 1/night alone is too
                             // thin for a 15-minute run to meaningfully spend

    // Glass Echo — rolls from the top of the band, but you are made of glass.
    glassEchoHpMul: 0.5,          // "Max HP halved"

    // Deep Roots — your holdings stand; you do not move well.
    deepRootsBuildingHpMul: 1.5,  // "Buildings +50% HP"
    deepRootsTowerRangeAdd: 1,    // "...and towers +1 range" (tiles)
    deepRootsMoveMul: 0.88,       // "You move 12% slower"

    // Night Market — gold talks, and it wakes things up.
    nightMarketGoldMul: 1.4,      // "Gold rate +40%"
    nightMarketWakeDiv: 2,        // "Gold rouses bosses at HALF the threshold"

    // The Long Thread — breadth of skill, converted to weave.
    // B3.b: was 10. On B1's curve a full run reaches ~71 total skill levels, so /10
    // paid 7 points for a 4-point keystone — a faucet that made the opening forced.
    // /12 pays ~5: a sidegrade that trades a rule-warp for flexible points arriving
    // early enough to spend. This is the number most likely to want a feel verdict.
    longThreadLevelsPerPoint: 12, // "+1 Loom point per 12 total skill levels"
  },

  audio: {
    enabled: true,
  },

  gather: {
    reachTiles: 1.6,         // how far the player can reach a node
    toolSpeedBonus: 0.4,     // gather speed +40% per tool power point
    toolsRequired: true,     // need an axe to chop, a pick to mine
  },

  economy: {
    tickSec: 5,              // how often the racket collects
    goldPerPop: 1,           // tribute per population per tick
    dayOnly: true,           // nobody pays protection money at night
    basePop: 2,              // your cronies before any huts
  },

  build: {
    maxDistFromHall: 18,     // tiles; how far from the hall you may build
  },

  horde: {
    firstNight: 1,           // nights before this one are quiet
    baseCount: 25,           // S1: 9→25 — first hostile night = a siege
    perNight: 18,            // S1: 5.5→18 — each night escalates hard
    perTerritory: 1.2,       // S1: 0.22→1.2 — expanding territory summons danger
    maxAlive: 250,           // S1: 90→250 — headroom for bigger waves
    spawnRadiusMinTiles: 10, // S1: was spawnRadiusTiles 14, now 10–18 spread
    spawnRadiusMaxTiles: 18,
    spawnIntervalSec: 0.55,  // S1: 1.1→0.55 — trickle becomes a flood
    hpGrowth: 1.12,          // S1: 1.21→1.12 — more mobs, each less tanky
    dmgGrowth: 1.10,         // S1: 1.15→1.10 — quantity over per-unit quality
    foeDmgToBuildings: 3.0,  // S1: NEW — walls actually break now (~15 hits vs 45)
    aggroRangePx: 170,       // enemies switch to the player inside this
    dawnFlee: true,          // survivors melt away at sunrise
    // M3: gold = greed = danger. The network detects your cache and sends heavier waves.
    goldThreshold: 200,      // gold at which horde size starts scaling up
    goldMultPerThreshold: 0.35, // extra horde multiplier per goldThreshold gold above threshold
    bossAtGold: 600,         // gold threshold where world-boss types can appear in night waves
    bossGoldWeight: 0.06,    // chance weight for boss types in horde when gold >= bossAtGold
  },

  // daytime prey: sparse roamers that pop up around the PLAYER (never the hall)
  // — loot on legs to hunt between nights, not a siege. Only EnemyDef rows
  // flagged `daytime` spawn here, at their base (night-1) stats.
  dayspawn: {
    maxAlive: 18,            // S1: 5→18 — day prey is now a real hunt
    spawnIntervalSec: 3,     // S1: 9→3 — they pour in faster
    minRadiusTiles: 5,       // S1: 8→5 — closer = can't ignore
    maxRadiusTiles: 16,
    despawnTiles: 35,        // S1: 28→35 — they stick around further
  },

  // S1: survival pressure — vitals that decay and must be restored by action.
  // All values wired by S1 and consumed by L1 aging; live-editable via NW.CFG.
  // ALL VALUES BELOW ARE BASE (neutral connection: 10Mbps, 50ms RTT, 4g, 5ms jitter,
  // 4 cores, 4GB RAM). At runtime, NetworkSystem applies multipliers on top via
  // NET_GAME_MAP rows (vigorDecay, vigorPerKill, vigorPerGather, vigorPerCampfire,
  // resolveDecay, resolvePerKill, resolvePerBuild, resolveNearHall, resolveNightMult —
  // all flagged `dormant` until the VitalsSystem consumes them; resolvePerSurviveNight
  // still needs a night-RTT-stability tracker). Same pattern as simSpeed/goldRate.
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

  ui: {
    toastSec: 3.2,
    // B6: the level-up flourish. A toast in the corner is information; the
    // point of the ask was that it should happen ON the character.
    levelFlourish: true,
  },

  debug: {
    enabled: true,           // master switch for the hotkeys below
    // hotkeys: [.] +30s clock | [n] jump to dusk | [g] +50 gold
    //          [m] +10 basic mats | [h] full heal
  },

  // R2: fire. The first six fields cross into the wasm core (packFireParams, below); everything
  // after is TS-only gameplay tuning that never leaves this process — same split R1.5 used for
  // pixel constants that stayed in art.ts instead of here.
  fire: {
    // ---- uploaded to the core via set_fire_params ----
    tickHz: 10,                  // CA tick rate; the core paces itself, independent of render fps
    spreadBase: 0.35,            // base per-tick ignition probability onto a dry flammable neighbor
    windStrength: 0.5,           // 0 = no directional bias, 1 = fully wind-driven
    wetExtinguish: 0.55,         // burn[] is doused once wet[] climbs past this
    wetDiffuseRate: 0.15,        // per-tick blend of a tile's wet[] toward its diffusion target
    wetSpreadDecay: 0.85,        // neighbor wet's influence falloff crossing one tile hop
    // ---- TS-only gameplay, never crosses the boundary ----
    reachTiles: 1.6,             // how far the player can ignite (mirrors CFG.gather.reachTiles)
    ignitionXp: 8,               // Firemaking xp per successful ignite
    burnDmgPerSec: 6,            // entity damage/s while standing in a burning tile
    burnTickSec: 0.5,            // burn-damage timer granularity (throttles hit spam)
    glowHz: 20,                  // fire glow overlay redraw cap
    campfireFearTiles: 6,        // hordes avoid spawning / hesitate within this radius of a campfire
    campfireFearSpeedMult: 0.5,  // speed multiplier applied to foes inside the fear radius
    charcoalChance: 0.7,         // chance a player-ignited controlled burn leaves charcoal on burnout
    charcoalXp: 12,              // bonus Firemaking xp when a controlled burn actually yields charcoal
  },
  // B5: Ground Drops — loot lands on the floor and is walked over to collect.
  // `enabled: false` restores the pre-B5 instant-pickup path exactly, which is
  // the escape hatch if the playtest verdict goes against the feature.
  drops: {
    enabled: true,
    tossSpeed: [40, 90],     // px/s outward, random per stack
    tossSec: 0.45,           // arc duration
    hopHeight: 14,           // px at the apex — visual only, never in the sim maths
    bobPx: 1.5,              // idle bob amplitude once settled
    bobHz: 1.1,              // idle bob rate
    armDelaySec: 0.25,       // no magnet before this — you always see it land
    magnetTiles: 1.6,        // attract radius; a pure walk-over turns a night wave into pixel-hunting
    magnetAccel: 420,        // px/s²
    magnetMaxSpeed: 260,     // px/s
    pickupPx: 10,            // collected inside this
    despawnSec: 90,          // game seconds before a material rots away
    blinkLastSec: 8,         // flashes for this long before it goes
    gearNeverDespawns: true, // weapons/armour/trinkets/relics/tools wait forever
    maxDrops: 200,           // hard cap; oldest non-gear evicted first
    mergePx: 8,              // same-id stacks landing this close merge instead of piling
    mergeMaxN: 999,          // never merge past this stack size
    sfxMinGapSec: 0.12,      // pickup blip rate limit — the deathWhistle lesson (2026-08-14)
    toastWindowSec: 0.4,     // pickups inside this window collapse into one toast line
    // B5 Q2, still open — and deliberately the one key in this file that NOTHING
    // reads. It is a parked decision, not a feature: flipping it changes nothing
    // until someone builds the coin pseudo-item (gold is not an ITEMS row). Kept
    // so the question survives, and noted here so the next dormant-row sweep
    // reads it as a placeholder rather than a placebo. Gold stays a direct
    // credit to state.player.gold until the playtest verdict lands.
    goldDrops: false,
  },

  // A1 — the rarity roll. `enabled: false` is a real escape hatch, not a
  // decoration: with it off, rollItem() returns the id it was handed, so the
  // game is byte-for-byte its pre-A1 self and a negative playtest verdict is a
  // config edit rather than a revert. Same discipline as CFG.drops.enabled.
  loot: {
    enabled: true,
    /** Crafted gear rolls too, in the narrow `forge` band — mostly Plain, and
     *  occasionally Touched. Crafting must stay worth doing once loot exists,
     *  and a forge that can never produce anything interesting is a forge the
     *  player abandons the moment the first blue drops. */
    craftRolls: true,
    /** Ground drops at or above this tier get a light shaft and a floating
     *  name (A4). Below it the world would be a disco. */
    beamFrom: 'woven',
    /** Seconds after a rift during which ordinary drops roll the `rift` band —
     *  the only route to a Riftborn item. A rift should be worth chasing. */
    riftWindowSec: 60,
    /** A4: the corner radar. Hidden on narrow screens regardless (see styles). */
    minimap: true,
    /** Tooltip delta colouring thresholds — a change smaller than this reads as
     *  noise and is drawn neutral rather than green. */
    deltaEpsilon: 0.05,
  },

  // N4.3: Omens — a detected step change on the wire becomes a temporary world
  // state. See systems/omens.ts; the per-kind numbers live in OMEN_DEFS, which
  // is a table, so balance is a row edit rather than a code change.
  omens: {
    enabled: true,
    // The safety valve on the whole feature: no more than this many omens may be
    // active at once, so a network having a genuinely terrible minute cannot
    // stack five multipliers onto a run at the same time.
    maxActive: 3,
    // Screen-space corruption when a Surge is up (0 = off). The wire fraying is
    // the one omen the plan explicitly asks to be *frightening*.
    surgeFxStrength: 0.5,
  },
};

export type Config = typeof CFG;

/** floats uploaded to the core's set_fire_params — order matches Rust's fire_params array. */
export const FIRE_PARAM_COUNT = 6;
export function packFireParams(): Float32Array {
  const f = CFG.fire;
  return new Float32Array([
    1 / f.tickHz, f.spreadBase, f.windStrength, f.wetExtinguish, f.wetDiffuseRate, f.wetSpreadDecay,
  ]);
}
