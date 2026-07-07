// Night horde bestiary. `fromNight` gates when a type starts appearing;
// `weight` sets its share of spawns. Per-night hp/dmg growth is in config.ts.
import { type RGB, ramp } from '../../engine/procgen/palette';
import type { LootTable } from '../types';

export interface EnemyDef {
  id: string;
  name: string;
  hp: number;
  speed: number;       // px/s
  dmg: number;
  atkCooldown: number; // s
  telegraphSec: number; // visible tell before a committed hit lands
  xp: number;          // combat xp on kill
  gold: [number, number];
  loot: LootTable;
  fromNight: number;
  weight: number;
  boss?: boolean;      // world bosses: never spawn in the ordinary horde
  art: { size: number; body: RGB[]; eye: RGB };
}

export const isBoss = (id: string) => ENEMIES.find((e) => e.id === id)?.boss === true;

export const ENEMIES: EnemyDef[] = [
  {
    id: 'gnawer', name: 'Gnawer',
    hp: 20, speed: 62, dmg: 5, atkCooldown: 1.0, telegraphSec: 0.3, xp: 14, gold: [1, 3],
    loot: [{ id: 'berry', min: 1, max: 2, chance: 0.2 }],
    fromNight: 1, weight: 10,
    art: { size: 16, body: ramp('#3a2030', '#5c2e42', '#7c3f52'), eye: ramp('#ffd9b0')[0] },
  },
  {
    id: 'brute', name: 'Brute',
    hp: 70, speed: 42, dmg: 12, atkCooldown: 1.4, telegraphSec: 0.55, xp: 40, gold: [4, 8],
    loot: [{ id: 'stone', min: 1, max: 2, chance: 0.3 }],
    fromNight: 3, weight: 3,
    art: { size: 24, body: ramp('#2e2a20', '#4a4030', '#665740'), eye: ramp('#d97b7b')[0] },
  },
  {
    id: 'wisp', name: 'Hollow Wisp',
    hp: 12, speed: 95, dmg: 3, atkCooldown: 0.7, telegraphSec: 0.28, xp: 22, gold: [2, 5],
    loot: [{ id: 'moonbell', min: 1, max: 1, chance: 0.15 }],
    fromNight: 5, weight: 4,
    art: { size: 13, body: ramp('#2a3560', '#3b82c4', '#7fb8e6'), eye: ramp('#f4f7fc')[0] },
  },

  // ---- world bosses (domain lords) — hp/dmg are baselines; the world-boss
  //      system scales them by domain danger, revives, and your territory ----
  {
    id: 'thornwarden', name: 'The Thornwarden',
    hp: 700, speed: 22, dmg: 20, atkCooldown: 1.5, telegraphSec: 0.85, xp: 400, gold: [80, 140],
    loot: [{ id: 'fine_log', min: 3, max: 6, chance: 1 }, { id: 'moonbell', min: 1, max: 3, chance: 0.8 }, { id: 'sword_iron', min: 1, max: 1, chance: 0.15 }],
    fromNight: 99, weight: 0, boss: true,
    art: { size: 46, body: ramp('#1e3a1e', '#2f6b2f', '#5aa24a'), eye: ramp('#ffe08a')[0] },
  },
  {
    id: 'cindermaw', name: 'The Cindermaw',
    hp: 900, speed: 26, dmg: 26, atkCooldown: 1.4, telegraphSec: 0.9, xp: 520, gold: [110, 180],
    loot: [{ id: 'iron_ore', min: 3, max: 6, chance: 1 }, { id: 'iron_bar', min: 1, max: 3, chance: 0.7 }, { id: 'armor_iron', min: 1, max: 1, chance: 0.12 }],
    fromNight: 99, weight: 0, boss: true,
    art: { size: 48, body: ramp('#3a1410', '#7a2c1c', '#c85a2e'), eye: ramp('#ffd27a')[0] },
  },
  {
    id: 'rimewraith', name: 'The Rimewraith',
    hp: 780, speed: 30, dmg: 22, atkCooldown: 1.2, telegraphSec: 0.8, xp: 480, gold: [100, 170],
    loot: [{ id: 'moonbell', min: 2, max: 4, chance: 1 }, { id: 'tonic_major', min: 1, max: 2, chance: 0.6 }],
    fromNight: 99, weight: 0, boss: true,
    art: { size: 44, body: ramp('#2a3a5a', '#4a6ea8', '#a9c8ea'), eye: ramp('#ffffff')[0] },
  },
  {
    id: 'tideculler', name: 'The Tideculler',
    hp: 860, speed: 24, dmg: 24, atkCooldown: 1.4, telegraphSec: 0.85, xp: 500, gold: [110, 175],
    loot: [{ id: 'stone', min: 4, max: 8, chance: 1 }, { id: 'copper_bar', min: 2, max: 4, chance: 0.7 }],
    fromNight: 99, weight: 0, boss: true,
    art: { size: 46, body: ramp('#0e3a44', '#1b6f80', '#3fb0bd'), eye: ramp('#eaffff')[0] },
  },
  {
    id: 'nullmaw', name: 'The Nullmaw',
    hp: 1200, speed: 21, dmg: 32, atkCooldown: 1.6, telegraphSec: 1.0, xp: 800, gold: [180, 300],
    loot: [{ id: 'iron_bar', min: 2, max: 5, chance: 1 }, { id: 'sword_iron', min: 1, max: 1, chance: 0.25 }, { id: 'armor_iron', min: 1, max: 1, chance: 0.2 }],
    fromNight: 99, weight: 0, boss: true,
    art: { size: 52, body: ramp('#26123a', '#4a2170', '#8a4fc4'), eye: ramp('#ffb0ff')[0] },
  },
];
