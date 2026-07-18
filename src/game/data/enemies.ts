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
  daytime?: boolean;   // also roams by day around the player (prey, not siege)
  art: { size: number; body: RGB[]; eye: RGB };
}

export const isBoss = (id: string) => ENEMIES.find((e) => e.id === id)?.boss === true;

export const ENEMIES: EnemyDef[] = [
  {
    id: 'gnawer', name: 'Gnawer',
    hp: 20, speed: 62, dmg: 5, atkCooldown: 1.0, telegraphSec: 0.3, xp: 14, gold: [1, 3],
    loot: [{ id: 'berry', min: 1, max: 2, chance: 0.2 }],
    fromNight: 1, weight: 10, daytime: true,
    art: { size: 16, body: ramp('#3a2030', '#5c2e42', '#7c3f52'), eye: ramp('#ffd9b0')[0] },
  },
  {
    id: 'brute', name: 'Brute',
    hp: 70, speed: 42, dmg: 12, atkCooldown: 1.4, telegraphSec: 0.55, xp: 40, gold: [4, 8],
    loot: [{ id: 'stone', min: 1, max: 2, chance: 0.3 }, { id: 'ring_copper', min: 1, max: 1, chance: 0.06 }],
    fromNight: 3, weight: 3,
    art: { size: 24, body: ramp('#2e2a20', '#4a4030', '#665740'), eye: ramp('#d97b7b')[0] },
  },
  {
    id: 'wisp', name: 'Wisp',
    hp: 12, speed: 95, dmg: 3, atkCooldown: 0.7, telegraphSec: 0.28, xp: 22, gold: [2, 5],
    loot: [{ id: 'moonbell', min: 1, max: 1, chance: 0.15 }, { id: 'charm_ember', min: 1, max: 1, chance: 0.05 }],
    fromNight: 5, weight: 4, daytime: true,
    art: { size: 13, body: ramp('#2a3560', '#3b82c4', '#7fb8e6'), eye: ramp('#f4f7fc')[0] },
  },

  // ---- C4: New mobs (bestiary expansion) ------------------------------------
  {
    id: 'spitter', name: 'Spitter',
    hp: 28, speed: 34, dmg: 14, atkCooldown: 1.8, telegraphSec: 0.6, xp: 32, gold: [5, 10],
    loot: [{ id: 'silver_ore', min: 1, max: 2, chance: 0.25 }, { id: 'stone', min: 1, max: 2, chance: 0.3 }],
    fromNight: 4, weight: 3,
    art: { size: 20, body: ramp('#1a2a1a', '#3a5a2a', '#6a8a3a'), eye: ramp('#ff8844')[0] },
  },
  {
    id: 'burrower', name: 'Burrower',
    hp: 45, speed: 55, dmg: 16, atkCooldown: 1.5, telegraphSec: 0.5, xp: 38, gold: [6, 12],
    loot: [{ id: 'stone', min: 2, max: 4, chance: 0.5 }, { id: 'iron_ore', min: 1, max: 2, chance: 0.2 }],
    fromNight: 6, weight: 3,
    art: { size: 22, body: ramp('#3a2a10', '#6a4a20', '#9a6a30'), eye: ramp('#ff4444')[0] },
  },
  {
    id: 'towerhunter', name: 'Tower-Hunter',
    hp: 55, speed: 48, dmg: 22, atkCooldown: 1.3, telegraphSec: 0.45, xp: 48, gold: [8, 16],
    loot: [{ id: 'iron_bar', min: 1, max: 2, chance: 0.3 }, { id: 'silver_ore', min: 1, max: 3, chance: 0.3 }],
    fromNight: 8, weight: 2.5,
    art: { size: 26, body: ramp('#2a1020', '#4a2040', '#7a3060'), eye: ramp('#ff88cc')[0] },
  },

  // ---- world bosses (domain lords) — hp/dmg are baselines; the world-boss
  //      system scales them by domain danger, revives, and your territory ----
  {
    id: 'thornwarden', name: 'The Thornwarden',
    hp: 700, speed: 22, dmg: 20, atkCooldown: 1.5, telegraphSec: 0.85, xp: 400, gold: [80, 140],
    loot: [{ id: 'fine_log', min: 3, max: 6, chance: 1 }, { id: 'moonbell', min: 1, max: 3, chance: 0.8 }, { id: 'sword_iron', min: 1, max: 1, chance: 0.15 }, { id: 'charm_moon', min: 1, max: 1, chance: 0.35 }, { id: 'relic_thorn', min: 1, max: 1, chance: 1 }],
    fromNight: 99, weight: 0, boss: true,
    art: { size: 46, body: ramp('#1e3a1e', '#2f6b2f', '#5aa24a'), eye: ramp('#ffe08a')[0] },
  },
  {
    id: 'cindermaw', name: 'The Cindermaw',
    hp: 900, speed: 26, dmg: 26, atkCooldown: 1.4, telegraphSec: 0.9, xp: 520, gold: [110, 180],
    loot: [{ id: 'iron_ore', min: 3, max: 6, chance: 1 }, { id: 'iron_bar', min: 1, max: 3, chance: 0.7 }, { id: 'armor_iron', min: 1, max: 1, chance: 0.12 }, { id: 'ring_iron', min: 1, max: 1, chance: 0.3 }, { id: 'relic_cinder', min: 1, max: 1, chance: 1 }],
    fromNight: 99, weight: 0, boss: true,
    art: { size: 48, body: ramp('#3a1410', '#7a2c1c', '#c85a2e'), eye: ramp('#ffd27a')[0] },
  },
  {
    id: 'rimewraith', name: 'The Rimewraith',
    hp: 780, speed: 30, dmg: 22, atkCooldown: 1.2, telegraphSec: 0.8, xp: 480, gold: [100, 170],
    loot: [{ id: 'moonbell', min: 2, max: 4, chance: 1 }, { id: 'tonic_major', min: 1, max: 2, chance: 0.6 }, { id: 'charm_moon', min: 1, max: 1, chance: 0.4 }, { id: 'relic_rime', min: 1, max: 1, chance: 1 }],
    fromNight: 99, weight: 0, boss: true,
    art: { size: 44, body: ramp('#2a3a5a', '#4a6ea8', '#a9c8ea'), eye: ramp('#ffffff')[0] },
  },
  {
    id: 'tideculler', name: 'The Tideculler',
    hp: 860, speed: 24, dmg: 24, atkCooldown: 1.4, telegraphSec: 0.85, xp: 500, gold: [110, 175],
    loot: [{ id: 'stone', min: 4, max: 8, chance: 1 }, { id: 'copper_bar', min: 2, max: 4, chance: 0.7 }, { id: 'amulet_iron', min: 1, max: 1, chance: 0.3 }, { id: 'relic_tide', min: 1, max: 1, chance: 1 }],
    fromNight: 99, weight: 0, boss: true,
    art: { size: 46, body: ramp('#0e3a44', '#1b6f80', '#3fb0bd'), eye: ramp('#eaffff')[0] },
  },
  {
    id: 'nullmaw', name: 'The Nullmaw',
    hp: 1200, speed: 21, dmg: 32, atkCooldown: 1.6, telegraphSec: 1.0, xp: 800, gold: [180, 300],
    loot: [{ id: 'iron_bar', min: 2, max: 5, chance: 1 }, { id: 'sword_iron', min: 1, max: 1, chance: 0.25 }, { id: 'armor_iron', min: 1, max: 1, chance: 0.2 }, { id: 'ring_iron', min: 1, max: 1, chance: 0.35 }, { id: 'amulet_iron', min: 1, max: 1, chance: 0.35 }, { id: 'relic_null', min: 1, max: 1, chance: 1 }],
    fromNight: 99, weight: 0, boss: true,
    art: { size: 52, body: ramp('#26123a', '#4a2170', '#8a4fc4'), eye: ramp('#ffb0ff')[0] },
  },
];
