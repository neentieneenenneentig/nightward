// Gatherable world features (RuneScape-style nodes). Placement is data-driven:
// `density` maps biome name → chance per tile. The world generator rolls one
// hash per tile against these; art is a procgen recipe like everything else.
import { type RGB, ramp } from '../../engine/procgen/palette';
import type { LootTable } from '../types';

export interface FeatureDef {
  id: string;
  name: string;
  skill: string;          // which skill gathers it (id from skills.ts)
  levelReq: number;
  xp: number;
  gatherSec: number;      // base time; tools speed this up
  toolClass?: 'axe' | 'pick';
  loot: LootTable;
  respawnSec: number;
  blocking: boolean;      // blocks walking?
  density: Record<string, number>;         // biome name → chance/tile
  art: { kind: 'tree' | 'rock' | 'herb' | 'bush' | 'cairn' | 'wardstone'; ramp: RGB[]; accent?: RGB };
  depleted: 'stump' | 'none';              // what remains after gathering
  /** Mega feature: this feature can roll a BIG square version (size×size
   *  tiles, one chunky upscaled sprite, blocks every tile, loot per tile).
   *  `chance` is the per-rolled-feature root lottery. */
  mega?: { enabled: boolean; maxSize: number; chance: number };

  // ---- A8: the two features that are not resource nodes ------------------
  //
  // Everything above describes a thing you harvest. The three columns below
  // describe a thing you OPEN, and they are what let a Cairn and a Wardstone
  // ride the gather interaction instead of needing an interaction of their
  // own — the walk-up, the hold, the progress bar and the cancel-on-move are
  // already exactly right for prying open a barrow.

  /** LOOT_BANDS key the harvest rolls on. Absent = `common`, which is what
   *  every resource node wants and what drops.spawn() already defaults to. */
  band?: string;
  /** Opening this grants one rolled Boon (data/boons.ts). */
  boon?: boolean;
  /** Opening this wakes a pack. `count` foes inside `radiusTiles`, at the
   *  CURRENT night's stat scaling — so a Cairn cracked on night 6 is a night-6
   *  fight, and the danger keeps pace with the payout without a second table.
   *  See systems/hordes.ts wake(). */
  wake?: { count: number; radiusTiles: number };
  /** Overrides the skill's verb on the interact prompt. "Mine Cairn" is a lie
   *  about what the player is doing; "Open Cairn" is not. */
  verb?: string;
}

/** A8's two non-node features, named here so CFG.a8.enabled can drop them out
 *  of worldgen entirely rather than merely muting their payouts. Both rows are
 *  APPENDED LAST in FEATURES, and WorldGen builds its per-biome table as a
 *  running cumulative sum — so excluding them restores a density table that is
 *  identical to its pre-A8 self, tile for tile, rather than one that is merely
 *  close. That is the difference between an escape hatch and an apology. */
export const A8_FEATURES = new Set(['cairn', 'wardstone']);

export const FEATURES: FeatureDef[] = [
  {
    id: 'tree', name: 'Tree', skill: 'woodcutting', levelReq: 1, xp: 25,
    gatherSec: 2.6, toolClass: 'axe',
    loot: [
      { id: 'log', min: 1, max: 2, chance: 1 },
      { id: 'fine_log', min: 1, max: 1, chance: 0.15 },
    ],
    respawnSec: 70, blocking: true,
    density: { forest: 0.42, grass: 0.04, meadow: 0.02 },
    art: { kind: 'tree', ramp: ramp('#1d4531', '#2a5e3d', '#3d7a4a', '#55924f') },
    depleted: 'stump',
    mega: { enabled: true, maxSize: 4, chance: 0.03 },
  },
  {
    id: 'rock_stone', name: 'Stone Outcrop', skill: 'mining', levelReq: 1, xp: 20,
    gatherSec: 2.8, toolClass: 'pick',
    loot: [{ id: 'stone', min: 1, max: 2, chance: 1 }],
    respawnSec: 60, blocking: true,
    density: { hill: 0.11, grass: 0.01, sand: 0.02 },
    art: { kind: 'rock', ramp: ramp('#3f4550', '#4f5663', '#6b7382') },
    depleted: 'none',
    mega: { enabled: true, maxSize: 3, chance: 0.05 },
  },
  {
    id: 'rock_copper', name: 'Copper Vein', skill: 'mining', levelReq: 1, xp: 30,
    gatherSec: 3.2, toolClass: 'pick',
    loot: [
      { id: 'copper_ore', min: 1, max: 2, chance: 1 },
      { id: 'stone', min: 1, max: 1, chance: 0.4 },
    ],
    respawnSec: 90, blocking: true,
    density: { hill: 0.05, grass: 0.006 },
    art: { kind: 'rock', ramp: ramp('#3f4550', '#4f5663', '#6b7382'), accent: ramp('#c47b3b')[0] },
    depleted: 'none',
    mega: { enabled: true, maxSize: 3, chance: 0.03 },
  },
  {
    id: 'rock_iron', name: 'Iron Vein', skill: 'mining', levelReq: 10, xp: 55,
    gatherSec: 3.8, toolClass: 'pick',
    loot: [
      { id: 'iron_ore', min: 1, max: 2, chance: 1 },
      { id: 'stone', min: 1, max: 1, chance: 0.4 },
    ],
    respawnSec: 120, blocking: true,
    density: { hill: 0.035 },
    art: { kind: 'rock', ramp: ramp('#3f4550', '#4f5663', '#6b7382'), accent: ramp('#9aa7b8')[0] },
    depleted: 'none',
  },
  {
    id: 'herb_sunleaf', name: 'Sunleaf', skill: 'foraging', levelReq: 1, xp: 15,
    gatherSec: 1.6,
    loot: [{ id: 'sunleaf', min: 1, max: 2, chance: 1 }],
    respawnSec: 45, blocking: false,
    density: { meadow: 0.05, grass: 0.015 },
    art: { kind: 'herb', ramp: ramp('#3f8148', '#569a53', '#74b25e'), accent: ramp('#e6c86e')[0] },
    depleted: 'none',
  },
  {
    id: 'herb_moonbell', name: 'Moonbell', skill: 'foraging', levelReq: 8, xp: 34,
    gatherSec: 2.0,
    loot: [{ id: 'moonbell', min: 1, max: 1, chance: 1 }],
    respawnSec: 80, blocking: false,
    density: { forest: 0.025 },
    art: { kind: 'herb', ramp: ramp('#2a5e3d', '#3f8148', '#569a53'), accent: ramp('#c9a0dc')[0] },
    depleted: 'none',
  },
  {
    id: 'berry_bush', name: 'Berry Bush', skill: 'foraging', levelReq: 1, xp: 12,
    gatherSec: 1.8,
    loot: [{ id: 'berry', min: 2, max: 4, chance: 1 }],
    respawnSec: 50, blocking: false,
    density: { grass: 0.02, forest: 0.025, meadow: 0.02 },
    art: { kind: 'bush', ramp: ramp('#24523a', '#2f6b3f', '#3f8148'), accent: ramp('#b3402e')[0] },
    depleted: 'none',
    mega: { enabled: true, maxSize: 3, chance: 0.06 },
  },

  // ---- X1: Biome-exclusive gatherables -------------------------------------
  // Steadfast Vale
  {
    id: 'ancient_oak', name: 'Ancient Oak', skill: 'woodcutting', levelReq: 12, xp: 65,
    gatherSec: 5.0, toolClass: 'axe',
    loot: [
      { id: 'fine_log', min: 2, max: 4, chance: 1 },
      { id: 'ancient_oak', min: 1, max: 1, chance: 0.4 },
    ],
    respawnSec: 200, blocking: true,
    density: { forest: 0.008 },
    art: { kind: 'tree', ramp: ramp('#1a2a10', '#3a5a2a', '#5a8a3a', '#88aa44') },
    depleted: 'stump',
    mega: { enabled: true, maxSize: 5, chance: 0.025 },
  },
  {
    id: 'sunbloom', name: 'Sunbloom', skill: 'foraging', levelReq: 5, xp: 28,
    gatherSec: 2.2,
    loot: [{ id: 'sunleaf', min: 2, max: 4, chance: 1 }],
    respawnSec: 70, blocking: false,
    density: { meadow: 0.02 },
    art: { kind: 'herb', ramp: ramp('#4a8a3a', '#6aaa4a', '#8aca5a'), accent: ramp('#ffd700')[0] },
    depleted: 'none',
  },

  // Shifting Wilds
  {
    id: 'shifting_stone', name: 'Shifting Stone', skill: 'mining', levelReq: 10, xp: 45,
    gatherSec: 3.5, toolClass: 'pick',
    loot: [
      { id: 'stone', min: 2, max: 3, chance: 1 },
      { id: 'copper_ore', min: 1, max: 2, chance: 0.4 },
      { id: 'iron_ore', min: 1, max: 1, chance: 0.2 },
      { id: 'silver_ore', min: 1, max: 1, chance: 0.1 },
    ],
    respawnSec: 150, blocking: true,
    density: { hill: 0.02, grass: 0.005 },
    art: { kind: 'rock', ramp: ramp('#4a4f7a', '#6a6faa', '#9a9fcc'), accent: ramp('#508cff')[0] },
    depleted: 'none',
  },
  {
    id: 'wispflower_plant', name: 'Wispflower', skill: 'foraging', levelReq: 8, xp: 38,
    gatherSec: 2.0,
    loot: [
      { id: 'moonbell', min: 1, max: 2, chance: 1 },
      { id: 'wispflower', min: 1, max: 1, chance: 0.35 },
    ],
    respawnSec: 120, blocking: false,
    density: { forest: 0.015, meadow: 0.008 },
    art: { kind: 'herb', ramp: ramp('#4a3a8a', '#6a5aba', '#8a7ada'), accent: ramp('#aaddff')[0] },
    depleted: 'none',
  },

  // Stormlands
  {
    id: 'storm_crystal_node', name: 'Storm Crystal', skill: 'mining', levelReq: 15, xp: 70,
    gatherSec: 4.5, toolClass: 'pick',
    loot: [
      { id: 'storm_crystal', min: 1, max: 2, chance: 1 },
      { id: 'stone', min: 2, max: 4, chance: 0.5 },
    ],
    respawnSec: 180, blocking: true,
    density: { hill: 0.012 },
    art: { kind: 'rock', ramp: ramp('#3a3a10', '#6a6a20', '#aaaa30'), accent: ramp('#ffcc00')[0] },
    depleted: 'none',
  },
  {
    id: 'scorchberry_bush', name: 'Scorchberry Bush', skill: 'foraging', levelReq: 6, xp: 32,
    gatherSec: 2.4,
    loot: [
      { id: 'berry', min: 1, max: 2, chance: 1 },
      { id: 'scorchberry', min: 1, max: 1, chance: 0.5 },
    ],
    respawnSec: 90, blocking: false,
    density: { grass: 0.01, hill: 0.008 },
    art: { kind: 'bush', ramp: ramp('#5a2a1a', '#8a3a2a', '#aa4a2a'), accent: ramp('#ff4422')[0] },
    depleted: 'none',
  },

  // Hollow

  {
    id: 'echo_dust_node', name: 'Echo Dust Deposit', skill: 'mining', levelReq: 8, xp: 40,
    gatherSec: 3.0, toolClass: 'pick',
    loot: [
      { id: 'echo_dust', min: 1, max: 2, chance: 0.6 },
      { id: 'stone', min: 1, max: 2, chance: 0.4 },
    ],
    respawnSec: 160, blocking: false,
    density: { grass: 0.01, hill: 0.008 },
    art: { kind: 'rock', ramp: ramp('#6a6a7a', '#8a8a9a', '#aaaacc'), accent: ramp('#ffffff')[0] },
    depleted: 'none',
  },
  // ---- A8: Cairns and Wardstones -------------------------------------------
  //
  // Densities are per-tile and deliberately tiny — and the arithmetic you would
  // do on them by hand is WRONG, which is why testA8Density measures instead.
  //
  // The first pass here reasoned "a run covers ~3,500 tiles, so a density sum of
  // 0.0004 gives ~1.4 Cairns" and shipped numbers that measured 0.38. The error
  // is that a density is per-tile OF ITS BIOME, and most of a NIGHTWARD map is
  // deep water, mountain and snow — none of which carry features at all. Roughly
  // three quarters of the tiles a naive sum counts cannot hold anything.
  //
  // The numbers below are therefore calibrated against the generator, not
  // derived from it: ~1 Cairn and ~2.5 Wardstones per run, which is "often one,
  // sometimes none, occasionally two" for the event and "a handful" for the
  // blessing. Retune against those two sentences.
  {
    id: 'cairn', name: 'Cairn', skill: 'mining', levelReq: 1, xp: 90,
    // No toolClass: you shift the stones by hand. A pick requirement would gate
    // the most exciting thing in the world behind an inventory check, and the
    // one player who most needs a Hallowed drop is the one who lost their gear.
    gatherSec: 5.0, verb: 'Open',
    // The stones are the wrapper; the roll is the gift.
    //
    // The five gear rows are ONE GROUP, so exactly one of them lands and which
    // slot it fills is the surprise. Rolled independently they came out empty
    // 22% of the time, and an empty Cairn is the design contradicting itself:
    // "guaranteed Hallowed+" cannot survive a one-in-five chance of nothing
    // after crossing the map and fighting what woke. Spread across all five
    // slots so the band can never dead-end into gear you already have.
    //
    // Silver is guaranteed on top, because a barrow that pays in exactly one
    // item reads like a vending machine rather than a hoard.
    loot: [
      { id: 'sword_iron',    min: 1, max: 1, chance: 30, group: 'grave-goods' },
      { id: 'armor_iron',    min: 1, max: 1, chance: 26, group: 'grave-goods' },
      { id: 'ring_silver',   min: 1, max: 1, chance: 16, group: 'grave-goods' },
      { id: 'amulet_silver', min: 1, max: 1, chance: 16, group: 'grave-goods' },
      { id: 'charm_silver',  min: 1, max: 1, chance: 12, group: 'grave-goods' },
      { id: 'silver_ore',    min: 2, max: 4, chance: 1 },
      { id: 'echo_dust',     min: 1, max: 3, chance: 0.55 },
      { id: 'star_ore',      min: 1, max: 2, chance: 0.25 },
    ],
    band: 'cairn',
    wake: { count: 5, radiusTiles: 3 },
    // 99999 s against a ~900 s run: a Cairn is opened once, by whoever gets
    // there first. `respawnSec` is the only lever the world has for "gone", and
    // spelling it as a big number keeps deplete()'s one code path honest.
    respawnSec: 99999, blocking: true,
    density: { hill: 0.00058, forest: 0.00021, grass: 0.00013, meadow: 0.00013, sand: 0.00026 },
    // Pale weathered stone, not the grey of an ordinary outcrop. The first pass
    // used the rock ramp and the result was a dark blob on grass — invisible at
    // exactly the range the design needs it to be seen from. A cairn is bone and
    // lichen-bleached limestone; the bright capstone is what carries.
    art: { kind: 'cairn', ramp: ramp('#6f6759', '#918878', '#bdb19a'), accent: ramp('#f2e8cf')[0] },
    depleted: 'none',
  },
  {
    id: 'wardstone', name: 'Wardstone', skill: 'foraging', levelReq: 1, xp: 45,
    gatherSec: 2.2, verb: 'Touch',
    // Deliberately empty. A Wardstone pays in a Boon, and adding a token
    // material on top would teach the player to read it as a node with a
    // bonus rather than as a blessing. rollLoot([]) returns [], drops.spawn()
    // filters to nothing, and no ground drop is created.
    loot: [],
    boon: true,
    respawnSec: 99999, blocking: false,
    density: { meadow: 0.00230, forest: 0.00125, grass: 0.00103, hill: 0.00103, sand: 0.00068 },
    art: { kind: 'wardstone', ramp: ramp('#3c3a52', '#4e4b6a', '#6b6790'), accent: ramp('#9fe6d8')[0] },
    depleted: 'none',
  },
];
