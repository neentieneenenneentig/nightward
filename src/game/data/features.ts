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
  art: { kind: 'tree' | 'rock' | 'herb' | 'bush'; ramp: RGB[]; accent?: RGB };
  depleted: 'stump' | 'none';              // what remains after gathering
  /** Mega feature: this feature can roll a BIG square version (size×size
   *  tiles, one chunky upscaled sprite, blocks every tile, loot per tile).
   *  `chance` is the per-rolled-feature root lottery. */
  mega?: { enabled: boolean; maxSize: number; chance: number };
}

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
    art: { kind: 'rock', ramp: ramp('#4a4f5a', '#5a5f6b', '#737887') },
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
    art: { kind: 'rock', ramp: ramp('#4a4f5a', '#5a5f6b', '#737887'), accent: ramp('#c47b3b')[0] },
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
    art: { kind: 'rock', ramp: ramp('#4a4f5a', '#5a5f6b', '#737887'), accent: ramp('#9aa7b8')[0] },
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
];
