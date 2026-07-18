// Building database. `territory` is each building's contribution to your
// territory score — which drives income AND how hard the night hits back.
import type { Stack } from '../types';

export interface BuildingDef {
  id: string;
  name: string;
  desc: string;
  hp: number;
  cost: Stack[];
  pop: number;        // population added
  territory: number;  // territory score added
  unique: boolean;
  tower?: { rangeTiles: number; dmg: number; cooldown: number };
  // C5: tower special role (affects targeting and projectile behavior)
  towerRole?: 'splash' | 'slow' | 'sniper' | 'aura' | 'chain' | 'poison' | 'stun';
  // C5: aura buff applied to nearby buildings/player when towerRole='aura'
  aura?: { radiusTiles: number; dmgMul?: number; rangeAdd?: number; regenAdd?: number };
  // C5: upgrade path — clicking a placed tower shows A/B choices
  upgradesTo?: [string, string];
  dragPaint?: boolean; // hold + drag paints a line of these (walls)
  // X1: new building roles
  trap?: { damage: number; slowMul?: number; radiusTiles: number; cooldownSec: number };
  workshop?: { craftSpeedMul: number; radiusTiles: number };
  granary?: { foodYieldMul: number };
  shrine?: { radiusTiles: number; dmgAdd?: number; rangeAdd?: number; regenAdd?: number };
  // X1: spiked walls reflect this much damage to melee attackers
  thorns?: number;
  // X1: chain-lightning towers — extra arcs after the first hit
  chain?: { jumps: number; falloff: number };
  // X1: poison towers — DoT as a fraction of the hit, per second
  poisonFx?: { dpsFrac: number; durSec: number; maxStacks: number; spreadOnDeath?: boolean };
  // X1: stun towers — target frozen for this long per hit
  stunSec?: number;
  // X1: buildings that extend the waystone chain (Signal Beacon), with this anchor range
  anchorRange?: number;
  art: 'hall' | 'hut' | 'wall' | 'tower' | 'campfire' | 'trap' | 'shrine';
}

const s = (id: string, n: number): Stack => ({ id, n });

export const BUILDINGS: BuildingDef[] = [
  {
    id: 'hall', name: 'Hearthstone',
    desc: 'The heart of your holdfast. Lose it and the light goes out.',
    hp: 600, cost: [s('log', 10), s('stone', 5)],
    pop: 0, territory: 12, unique: true, art: 'hall',
  },
  {
    id: 'hut', name: 'Hovel',
    desc: '+2 population. More hands for the work.',
    hp: 140, cost: [s('plank', 6), s('stone', 4)],
    pop: 2, territory: 4, unique: false, art: 'hut',
  },
  {
    id: 'wall', name: 'Palisade',
    desc: 'Holds the night back. They will try to breach it.',
    hp: 260, cost: [s('log', 2), s('stone', 1)],
    pop: 0, territory: 0, unique: false, dragPaint: true, art: 'wall',
  },
  {
    id: 'tower', name: 'Watchtower',
    desc: 'Auto-engages threats at range. Your best defense at 3am.',
    hp: 180, cost: [s('plank', 6), s('stone', 6), s('copper_bar', 1)],
    pop: 0, territory: 2, unique: false,
    tower: { rangeTiles: 5.5, dmg: 7, cooldown: 0.8 },
    // C5: upgrade paths — LTD2-style A/B commitment
    upgradesTo: ['tower_ember', 'tower_frost'],
    art: 'tower',
  },
  // C5: Tier 2 towers (upgrade from Watchtower)
  {
    id: 'tower_ember', name: 'Emberkiln',
    desc: 'Unleashes fire in a wide arc. Splash damage to all foes near the target.',
    hp: 260, cost: [s('iron_bar', 3), s('stone', 10), s('copper_bar', 3)],
    pop: 0, territory: 4, unique: false,
    tower: { rangeTiles: 5, dmg: 15, cooldown: 1.2 },
    towerRole: 'splash',
    upgradesTo: ['tower_inferno', 'tower_forge'],
    art: 'tower',
  },
  {
    id: 'tower_frost', name: 'Frostspire',
    desc: 'Chills foes with every bolt. Slowed enemies are easy prey.',
    hp: 240, cost: [s('iron_bar', 3), s('stone', 10), s('moonbell', 4)],
    pop: 0, territory: 4, unique: false,
    tower: { rangeTiles: 6, dmg: 9, cooldown: 0.7 },
    towerRole: 'slow',
    upgradesTo: ['tower_glacier', 'tower_hail'],
    art: 'tower',
  },
  {
    id: 'tower_longeye', name: 'Longeye',
    desc: 'Extreme range, single-target precision. Picks off threats before they reach the walls.',
    hp: 200, cost: [s('iron_bar', 4), s('plank', 8), s('copper_bar', 2)],
    pop: 0, territory: 3, unique: false,
    tower: { rangeTiles: 9, dmg: 22, cooldown: 1.8 },
    towerRole: 'sniper',
    upgradesTo: ['tower_eagle', 'tower_deadeye'],
    art: 'tower',
  },
  {
    id: 'tower_banner', name: 'Warbanner',
    desc: 'Inspires nearby towers and allies. +20% damage and +1 range to towers within 5 tiles.',
    hp: 300, cost: [s('iron_bar', 2), s('fine_log', 6), s('sunleaf', 5)],
    pop: 0, territory: 3, unique: false,
    tower: { rangeTiles: 0, dmg: 0, cooldown: 999 },
    towerRole: 'aura',
    aura: { radiusTiles: 5, dmgMul: 1.20, rangeAdd: 1 },
    art: 'tower',
  },
  // C5: Tier 3 towers (ultimate upgrades)
  {
    id: 'tower_inferno', name: 'Inferno Spire',
    desc: 'The Emberkiln perfected. Massive splash damage in a burning radius.',
    hp: 380, cost: [s('star_bar', 2), s('iron_bar', 6), s('stone', 20)],
    pop: 0, territory: 6, unique: false,
    tower: { rangeTiles: 5.5, dmg: 28, cooldown: 1.0 },
    towerRole: 'splash',
    art: 'tower',
  },
  {
    id: 'tower_forge', name: 'Forge Tower',
    desc: 'Burns so hot it ignites the ground. Killed foes drop bonus charcoal.',
    hp: 350, cost: [s('star_bar', 2), s('iron_bar', 6), s('charcoal', 10)],
    pop: 0, territory: 6, unique: false,
    tower: { rangeTiles: 6, dmg: 20, cooldown: 0.9 },
    towerRole: 'splash',
    art: 'tower',
  },
  {
    id: 'tower_glacier', name: 'Glacier Spire',
    desc: 'Absolute zero. Frozen foes take 50% more damage from all sources.',
    hp: 340, cost: [s('star_bar', 2), s('iron_bar', 6), s('moonbell', 8)],
    pop: 0, territory: 6, unique: false,
    tower: { rangeTiles: 6.5, dmg: 16, cooldown: 0.6 },
    towerRole: 'slow',
    art: 'tower',
  },
  {
    id: 'tower_hail', name: 'Hail Storm',
    desc: 'Rapid-fire frost bolts that chain between slowed foes.',
    hp: 320, cost: [s('star_bar', 2), s('silver_bar', 4), s('moonbell', 6)],
    pop: 0, territory: 6, unique: false,
    tower: { rangeTiles: 7, dmg: 10, cooldown: 0.35 },
    towerRole: 'slow',
    art: 'tower',
  },
  {
    id: 'tower_eagle', name: "Eagle's Nest",
    desc: 'The Longeye ascends. Shots pierce through foes in a line.',
    hp: 280, cost: [s('star_bar', 2), s('silver_bar', 4), s('plank', 12)],
    pop: 0, territory: 5, unique: false,
    tower: { rangeTiles: 12, dmg: 35, cooldown: 1.5 },
    towerRole: 'sniper',
    art: 'tower',
  },
  {
    id: 'tower_deadeye', name: 'Deadeye Spire',
    desc: 'One shot, one kill. Instantly executes foes below 30% HP.',
    hp: 260, cost: [s('star_bar', 2), s('silver_bar', 4), s('iron_bar', 4)],
    pop: 0, territory: 5, unique: false,
    tower: { rangeTiles: 10, dmg: 40, cooldown: 2.2 },
    towerRole: 'sniper',
    art: 'tower',
  },
  {
    id: 'campfire', name: 'Watchfire',
    desc: 'A steady light in the dark. Keeps the gloom at bay.',
    hp: 60, cost: [s('log', 3), s('stone', 2)],
    pop: 0, territory: 0, unique: false, art: 'campfire',
  },
  // C2: Waystone — extends your building radius. Buildings can be placed within
  // maxDistFromHall of the hall OR any waystone. Waystones chain: a waystone
  // must be placed within range of the hall or another waystone first.
  // T4 verdict: destroying a waystone = FULL COLLAPSE — everything chained
  // through it decays until reconnected or dead.
  {
    id: 'waystone', name: 'Waystone',
    desc: 'An anchor in the dark. Buildings may be placed within its reach — chain them to claim the wilds. If destroyed, everything beyond crumbles.',
    hp: 400, cost: [s('iron_bar', 4), s('stone', 8), s('copper_bar', 2)],
    pop: 0, territory: 8, unique: false, art: 'tower',
  },

  // ---- X1: Building expansion ----------------------------------------------

  // Wall upgrades
  {
    id: 'wall_stone', name: 'Stone Rampart',
    desc: 'Thrice the strength of wood. The night breaks against it.',
    hp: 700, cost: [s('stone', 4), s('plank', 1)],
    pop: 0, territory: 0, unique: false, dragPaint: true, art: 'wall',
  },
  {
    id: 'wall_iron', name: 'Iron Bulwark',
    desc: 'Spiked iron plates. Foes that strike it bleed.',
    hp: 1200, cost: [s('iron_bar', 2), s('stone', 3)],
    pop: 0, territory: 1, unique: false, dragPaint: true,
    thorns: 6,
    art: 'wall',
  },

  // Traps
  {
    id: 'trap_spike', name: 'Spike Trap',
    desc: 'Foes that step on it take damage. Re-arms after a short delay.',
    hp: 80, cost: [s('plank', 4), s('stone', 3), s('copper_bar', 1)],
    pop: 0, territory: 0, unique: false,
    trap: { damage: 25, radiusTiles: 0.5, cooldownSec: 3 },
    art: 'trap',
  },
  {
    id: 'trap_tar', name: 'Tar Pit',
    desc: 'Slows enemies that cross it to a crawl. Does no damage by itself.',
    hp: 100, cost: [s('log', 5), s('stone', 2), s('charcoal', 3)],
    pop: 0, territory: 0, unique: false,
    trap: { damage: 0, slowMul: 0.3, radiusTiles: 1.5, cooldownSec: 0.5 },
    art: 'trap',
  },
  {
    id: 'trap_flame', name: 'Flame Vent',
    desc: 'Periodically erupts in fire. Burns all foes in its blast.',
    hp: 120, cost: [s('iron_bar', 3), s('charcoal', 6), s('stone', 4)],
    pop: 0, territory: 1, unique: false,
    trap: { damage: 40, radiusTiles: 2, cooldownSec: 5 },
    art: 'trap',
  },

  // Utility buildings
  {
    id: 'workshop', name: 'Workshop',
    desc: 'Crafting within 6 tiles grants +30% craft XP.',
    hp: 200, cost: [s('plank', 8), s('iron_bar', 2), s('stone', 4)],
    pop: 0, territory: 3, unique: false,
    workshop: { craftSpeedMul: 1.3, radiusTiles: 6 },
    art: 'hut',
  },
  {
    id: 'granary', name: 'Granary',
    desc: 'Foraged food yields +40%. Berries, herbs, and tonics are more potent.',
    hp: 180, cost: [s('plank', 6), s('stone', 4), s('sunleaf', 3)],
    pop: 1, territory: 3, unique: false,
    granary: { foodYieldMul: 1.4 },
    art: 'hut',
  },
  {
    id: 'shrine', name: 'Shrine',
    desc: 'Towers within 7 tiles gain +1 range and +2 damage.',
    hp: 250, cost: [s('stone', 10), s('iron_bar', 3), s('moonbell', 4)],
    pop: 0, territory: 4, unique: false,
    shrine: { radiusTiles: 7, dmgAdd: 2, rangeAdd: 1 },
    art: 'shrine',
  },
  {
    id: 'beacon', name: 'Signal Beacon',
    desc: 'A lesser anchor — buildings may root within 3 tiles of it. Build deeper into the wilds.',
    hp: 160, cost: [s('copper_bar', 4), s('stone', 6), s('fine_log', 2)],
    pop: 0, territory: 5, unique: false, anchorRange: 3, art: 'tower',
  },

  // New towers
  {
    id: 'tower_bolt', name: 'Bolt Spire',
    desc: 'Lightning arcs between nearby foes. Each jump deals 70% of the last.',
    hp: 220, cost: [s('iron_bar', 4), s('copper_bar', 3), s('stone', 8)],
    pop: 0, territory: 3, unique: false,
    tower: { rangeTiles: 6, dmg: 12, cooldown: 1.0 },
    towerRole: 'chain', chain: { jumps: 3, falloff: 0.7 },
    upgradesTo: ['tower_storm', 'tower_arc'],
    art: 'tower',
  },
  {
    id: 'tower_venom', name: 'Venom Spire',
    desc: 'Coats foes in poison — 20% of hit as damage per second for 3s.',
    hp: 200, cost: [s('silver_bar', 2), s('iron_bar', 2), s('moonbell', 4)],
    pop: 0, territory: 2, unique: false,
    tower: { rangeTiles: 5.5, dmg: 8, cooldown: 0.7 },
    towerRole: 'poison', poisonFx: { dpsFrac: 0.2, durSec: 3, maxStacks: 1 },
    upgradesTo: ['tower_blight', 'tower_plague'],
    art: 'tower',
  },
  {
    id: 'tower_quake', name: 'Earthshaker',
    desc: 'Each hit stuns the target for 0.8s. Slower but devastating.',
    hp: 350, cost: [s('star_bar', 2), s('iron_bar', 5), s('stone', 15)],
    pop: 0, territory: 5, unique: false,
    tower: { rangeTiles: 5, dmg: 24, cooldown: 1.8 },
    towerRole: 'stun', stunSec: 0.8,
    art: 'tower',
  },
  // T3 bolt upgrades
  {
    id: 'tower_storm', name: 'Stormcaller Spire',
    desc: 'Lightning jumps up to 5 times. Each jump deals 85% of the last.',
    hp: 320, cost: [s('star_bar', 2), s('iron_bar', 5), s('copper_bar', 4)],
    pop: 0, territory: 5, unique: false,
    tower: { rangeTiles: 7, dmg: 18, cooldown: 0.9 },
    towerRole: 'chain', chain: { jumps: 5, falloff: 0.85 },
    art: 'tower',
  },
  {
    id: 'tower_arc', name: 'Arc Lattice',
    desc: 'Fast lightning that leaps between up to four foes.',
    hp: 300, cost: [s('star_bar', 2), s('silver_bar', 3), s('copper_bar', 5)],
    pop: 0, territory: 5, unique: false,
    tower: { rangeTiles: 6, dmg: 14, cooldown: 0.75 },
    towerRole: 'chain', chain: { jumps: 4, falloff: 0.7 },
    art: 'tower',
  },
  // T3 venom upgrades
  {
    id: 'tower_blight', name: 'Blight Spire',
    desc: 'Poison stacks up to 3 times. Each stack deals 25% of hit per second.',
    hp: 310, cost: [s('star_bar', 2), s('silver_bar', 4), s('moonbell', 6)],
    pop: 0, territory: 5, unique: false,
    tower: { rangeTiles: 6, dmg: 10, cooldown: 0.55 },
    towerRole: 'poison', poisonFx: { dpsFrac: 0.25, durSec: 3, maxStacks: 3 },
    art: 'tower',
  },
  {
    id: 'tower_plague', name: 'Plague Spire',
    desc: 'Poisoned foes spread poison to nearby enemies on death.',
    hp: 300, cost: [s('star_bar', 2), s('silver_bar', 4), s('stone', 12)],
    pop: 0, territory: 5, unique: false,
    tower: { rangeTiles: 6.5, dmg: 8, cooldown: 0.6 },
    towerRole: 'poison', poisonFx: { dpsFrac: 0.2, durSec: 3, maxStacks: 1, spreadOnDeath: true },
    art: 'tower',
  },
];
