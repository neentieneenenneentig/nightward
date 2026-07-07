// ============================================================================
// THE BALANCE FILE. Every gameplay number lives here — tweak freely, reload,
// play. Systems read these live; nothing is hardcoded elsewhere.
// (In the browser console: window.NW.CFG is this object, editable at runtime.)
// ============================================================================

export const CFG = {
  player: {
    speed: 160,              // world px/s (32 px = 1 tile)
    turnSpeed: Math.PI * 3.2, // rad/s the rig turns toward its target facing — lower = more visible slow-turn
    maxHp: 100,
    regenPerSec: 1.5,        // hp/s during the DAY only
    meleeRange: 40,          // px
    meleeArc: 150,           // degrees, centered on facing
    meleeCooldown: 0.45,     // s between swings
    baseDmg: 4,              // fists; weapons add weaponDmg on top
    deathGoldLossPct: 0.25,  // fraction of gold dropped on death
    // roguelike death: you don't wake at the hall — the dream scatters you far
    // out into the massive world and you must find your way home.
    respawnMinTiles: 40,
    respawnMaxTiles: 110,
    startingItems: [
      { id: 'axe_flint', n: 1 },
      { id: 'pick_flint', n: 1 },
    ],
  },

  // RS-style curve: xp to go from level L to L+1 = base * growth^(L-1)
  xp: {
    base: 40,
    growth: 1.32,
    maxLevel: 50,
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

  // the dream-world: each region is a lord's imagined landscape (see data/domains.ts)
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
    wakeTerritory: 8,        // territory score that rouses them toward you
    convergePerTerritory: 0.6, // + hunt speed per territory point (greed pulls them in)
    warnTiles: 22,           // proximity that triggers the danger warning
    attackReachPx: 30,       // how close before it can strike you / the hall
    hpBase: 700, hpPerLevel: 1.5, hpPerTerritory: 12,
    dmgBase: 20, dmgPerLevel: 1.35,
    goldOnKill: [120, 240] as [number, number],
    reviveSec: 220,          // slain lords re-form deeper in the dream, stronger
    levelPerRevive: 1,
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
    baseCount: 6,            // enemies on the first hostile night
    perNight: 3.5,           // + per night survived
    perTerritory: 0.22,      // + per point of territory score (greed = risk)
    maxAlive: 90,            // hard cap for perf & sanity
    spawnRadiusTiles: 14,    // distance from hall (or player) they emerge at
    spawnIntervalSec: 1.5,   // trickle rate (faster = scarier)
    hpGrowth: 1.14,          // per-night multiplier on enemy hp
    dmgGrowth: 1.09,         // per-night multiplier on enemy damage
    aggroRangePx: 170,       // enemies switch to the player inside this
    dawnFlee: true,          // survivors melt away at sunrise
  },

  ui: {
    toastSec: 3.2,
  },

  debug: {
    enabled: true,           // master switch for the hotkeys below
    // hotkeys: [.] +30s clock | [n] jump to dusk | [g] +50 gold
    //          [m] +10 basic mats | [h] full heal
  },
};

export type Config = typeof CFG;
