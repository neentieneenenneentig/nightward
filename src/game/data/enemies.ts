// Night horde bestiary. `fromNight` gates when a type starts appearing;
// `weight` sets its share of spawns. Per-night hp/dmg growth is in config.ts.
import { type RGB, ramp } from '../../engine/procgen/palette';
import type { LootTable } from '../types';

/** X1: Enemy behavior — data-driven AI, no engine changes per enemy. */
export interface EnemyBehavior {
  kind: 'charge' | 'ranged' | 'siege' | 'exploder' | 'buffer' | 'healer' | 'summoner' | 'swarm' | 'flee';
  // ranged / siege
  projectileSpeed?: number;       // px/s (default 180)
  preferredRangeTiles?: number;   // tries to keep this distance (default 4)
  // siege — targets buildings over player
  structureDmgMul?: number;       // × damage vs buildings (default 2)
  // exploder — detonates on death or reaching melee range
  explodeRadiusTiles?: number;
  explodeDmg?: number;            // dealt to all in radius (player + buildings)
  explodeOnDeath?: boolean;       // also explode when killed
  // buffer — aura that buffs nearby allies
  buffRadiusTiles?: number;
  buffDmgMul?: number;            // × ally damage
  buffSpeedMul?: number;          // × ally speed
  // healer — pulses heal to nearby damaged allies
  healRadiusTiles?: number;
  healAmount?: number;
  healCooldownSec?: number;
  // summoner — periodically spawns minor minions
  summonId?: string;              // enemy id to spawn
  summonCount?: number;           // per burst
  summonCooldownSec?: number;
  summonMax?: number;             // max alive at once
  // swarm — tiny, ignores collision with each other, clumps together
  swarmSize?: number;             // extra spawns per wave slot
  // A8 flee — runs from the player and is GONE if it gets clear. The only
  // behavior in the table whose success condition is the player's failure, so
  // every number here is really a difficulty knob on one chase.
  spookTiles?: number;            // starts running when the player is this close
  fleeSpeedMul?: number;          // × speed while running (>1 = faster than you)
  escapeTiles?: number;           // gets this far and it is gone, with its hoard
  staminaSec?: number;            // seconds it can hold fleeSpeedMul before tiring
  tiredFadeSec?: number;          // seconds to decay from fleeSpeedMul to tiredSpeedMul
  tiredSpeedMul?: number;         // × speed once blown (<1 = you close on it)
}

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
  /** A8: never joins a night wave, whatever `fromNight`/`weight` say. A thing
   *  whose whole behaviour is running away has no business in a siege — it
   *  would spawn at the hall, immediately flee the hall, and despawn. */
  dayOnly?: boolean;
  /** A8: LOOT_BANDS key this corpse's drops roll on. Absent = `common`, which
   *  is what hordes.hurt() has always passed and what every other foe wants. */
  lootBand?: string;
  /** X1: Data-driven behavior — if absent, defaults to 'charge'. */
  behavior?: EnemyBehavior;
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

  // ---- X1: Bestiary expansion — tiered families with behaviors ------------

  // Gnawer line (T2/T3)
  {
    id: 'gnawer_packleader', name: 'Gnawer Pack-Leader',
    hp: 45, speed: 68, dmg: 9, atkCooldown: 0.85, telegraphSec: 0.3, xp: 34, gold: [4, 9],
    loot: [{ id: 'berry', min: 2, max: 4, chance: 0.35 }, { id: 'sunleaf', min: 1, max: 2, chance: 0.2 }],
    fromNight: 7, weight: 3, daytime: true,
    behavior: { kind: 'buffer', buffRadiusTiles: 3.5, buffDmgMul: 1.25, buffSpeedMul: 1.15 },
    art: { size: 20, body: ramp('#3a2030', '#6c3e52', '#9c5f72'), eye: ramp('#ffd9b0')[0] },
  },
  {
    id: 'gnawer_broodmother', name: 'Gnawer Broodmother',
    hp: 130, speed: 30, dmg: 7, atkCooldown: 1.6, telegraphSec: 0.5, xp: 85, gold: [14, 26],
    loot: [{ id: 'berry', min: 3, max: 6, chance: 0.6 }, { id: 'charm_ember', min: 1, max: 1, chance: 0.1 }, { id: 'silver_ore', min: 1, max: 2, chance: 0.25 }, { id: 'void_shard', min: 1, max: 1, chance: 0.25 }],
    fromNight: 14, weight: 2,
    behavior: { kind: 'summoner', summonId: 'gnawer', summonCount: 3, summonCooldownSec: 12, summonMax: 9 },
    art: { size: 30, body: ramp('#3a1020', '#7a2e4a', '#b04a6a'), eye: ramp('#ffb0b0')[0] },
  },

  // Brute line (T2: exploder, T3: buffer warlord)
  {
    id: 'brute_mauler', name: 'Brute Mauler',
    hp: 120, speed: 35, dmg: 22, atkCooldown: 1.6, telegraphSec: 0.6, xp: 62, gold: [10, 18],
    loot: [{ id: 'stone', min: 2, max: 4, chance: 0.5 }, { id: 'iron_ore', min: 1, max: 3, chance: 0.3 }],
    fromNight: 9, weight: 2.5,
    behavior: { kind: 'exploder', explodeRadiusTiles: 2, explodeDmg: 35, explodeOnDeath: true },
    art: { size: 26, body: ramp('#3a2010', '#6a3a20', '#aa5a30'), eye: ramp('#ff6644')[0] },
  },
  {
    id: 'brute_warlord', name: 'Brute Warlord',
    hp: 260, speed: 30, dmg: 28, atkCooldown: 1.4, telegraphSec: 0.7, xp: 160, gold: [28, 50],
    loot: [{ id: 'iron_bar', min: 1, max: 3, chance: 0.6 }, { id: 'sword_copper', min: 1, max: 1, chance: 0.12 }, { id: 'star_ore', min: 1, max: 2, chance: 0.2 }, { id: 'void_shard', min: 1, max: 1, chance: 0.3 }],
    fromNight: 18, weight: 1.5,
    behavior: { kind: 'buffer', buffRadiusTiles: 5, buffDmgMul: 1.4, buffSpeedMul: 1.2 },
    art: { size: 34, body: ramp('#4a1a0a', '#8a3a1a', '#ca5a2a'), eye: ramp('#ff8844')[0] },
  },

  // Wisp line (T2: ranged lasher, T3: healer)
  {
    id: 'wisp_lasher', name: 'Wisp Lasher',
    hp: 28, speed: 55, dmg: 9, atkCooldown: 1.5, telegraphSec: 0.4, xp: 44, gold: [6, 12],
    loot: [{ id: 'moonbell', min: 1, max: 3, chance: 0.3 }, { id: 'charm_moon', min: 1, max: 1, chance: 0.08 }],
    fromNight: 10, weight: 3,
    behavior: { kind: 'ranged', projectileSpeed: 200, preferredRangeTiles: 5 },
    art: { size: 16, body: ramp('#3a3560', '#5b72c4', '#9bb8f6'), eye: ramp('#ffffff')[0] },
  },
  {
    id: 'wisp_veilweaver', name: 'Wisp Veil-Weaver',
    hp: 80, speed: 40, dmg: 5, atkCooldown: 1.0, telegraphSec: 0.35, xp: 70, gold: [14, 24],
    loot: [{ id: 'moonbell', min: 2, max: 4, chance: 0.5 }, { id: 'tonic_major', min: 1, max: 1, chance: 0.3 }],
    fromNight: 13, weight: 2,
    behavior: { kind: 'healer', healRadiusTiles: 5, healAmount: 12, healCooldownSec: 4 },
    art: { size: 20, body: ramp('#4a5590', '#7b9aee', '#bbccff'), eye: ramp('#ffffff')[0] },
  },

  // Shade line — stealthy fast flankers
  {
    id: 'shade', name: 'Shade',
    hp: 18, speed: 88, dmg: 8, atkCooldown: 0.9, telegraphSec: 0.25, xp: 28, gold: [3, 7],
    loot: [{ id: 'sunleaf', min: 1, max: 2, chance: 0.2 }, { id: 'moonbell', min: 1, max: 1, chance: 0.12 }],
    fromNight: 5, weight: 4,
    art: { size: 14, body: ramp('#1a1a2a', '#2a2a4a', '#3a3a6a'), eye: ramp('#ff44ff')[0] },
  },
  {
    id: 'shade_reaper', name: 'Shade Reaper',
    hp: 55, speed: 72, dmg: 18, atkCooldown: 0.7, telegraphSec: 0.3, xp: 70, gold: [12, 22],
    loot: [{ id: 'silver_ore', min: 1, max: 3, chance: 0.35 }, { id: 'charm_ember', min: 1, max: 1, chance: 0.1 }],
    fromNight: 12, weight: 2.5,
    behavior: { kind: 'swarm', swarmSize: 2 },
    art: { size: 18, body: ramp('#2a1a3a', '#4a2a7a', '#7a4aaa'), eye: ramp('#ff66ff')[0] },
  },
  {
    id: 'shade_king', name: 'Shade King',
    hp: 180, speed: 55, dmg: 24, atkCooldown: 1.0, telegraphSec: 0.4, xp: 180, gold: [30, 55],
    loot: [{ id: 'star_ore', min: 1, max: 3, chance: 0.4 }, { id: 'void_shard', min: 1, max: 2, chance: 0.5 }, { id: 'ring_silver', min: 1, max: 1, chance: 0.08 }, { id: 'relic_rime', min: 1, max: 1, chance: 0.03 }],
    fromNight: 20, weight: 1.2,
    behavior: { kind: 'ranged', projectileSpeed: 250, preferredRangeTiles: 6 },
    art: { size: 28, body: ramp('#3a1a5a', '#7a3aaa', '#aa6aea'), eye: ramp('#ff88ff')[0] },
  },

  // Craggin line — tanky siege breakers
  {
    id: 'craggin', name: 'Craggin',
    hp: 90, speed: 28, dmg: 10, atkCooldown: 1.8, telegraphSec: 0.7, xp: 44, gold: [6, 10],
    loot: [{ id: 'stone', min: 2, max: 5, chance: 0.6 }, { id: 'copper_ore', min: 1, max: 2, chance: 0.2 }],
    fromNight: 6, weight: 2.5,
    art: { size: 28, body: ramp('#4a4a4a', '#6a6a6a', '#9a9a9a'), eye: ramp('#ff4444')[0] },
  },
  {
    id: 'craggin_bulwark', name: 'Craggin Bulwark',
    hp: 240, speed: 20, dmg: 18, atkCooldown: 2.0, telegraphSec: 0.9, xp: 110, gold: [16, 28],
    loot: [{ id: 'stone', min: 3, max: 6, chance: 0.7 }, { id: 'iron_ore', min: 2, max: 4, chance: 0.4 }, { id: 'vest_bark', min: 1, max: 1, chance: 0.15 }],
    fromNight: 15, weight: 2,
    behavior: { kind: 'siege', structureDmgMul: 3, projectileSpeed: 120, preferredRangeTiles: 3 },
    art: { size: 34, body: ramp('#3a3a3a', '#5a5a5a', '#8a8a8a'), eye: ramp('#ff6644')[0] },
  },
  {
    id: 'craggin_titan', name: 'Craggin Titan',
    hp: 500, speed: 16, dmg: 32, atkCooldown: 2.2, telegraphSec: 1.1, xp: 280, gold: [40, 70],
    loot: [{ id: 'stone', min: 5, max: 10, chance: 0.8 }, { id: 'iron_bar', min: 2, max: 4, chance: 0.5 }, { id: 'armor_copper', min: 1, max: 1, chance: 0.2 }, { id: 'star_bar', min: 1, max: 2, chance: 0.15 }, { id: 'void_shard', min: 1, max: 2, chance: 0.4 }],
    fromNight: 25, weight: 1,
    behavior: { kind: 'siege', structureDmgMul: 5, projectileSpeed: 80, preferredRangeTiles: 2 },
    art: { size: 42, body: ramp('#2a2a2a', '#4a4a4a', '#7a7a7a'), eye: ramp('#ff8844')[0] },
  },

  // Mite swarm — tiny, fast, weak, spawns in packs
  {
    id: 'mite', name: 'Mite',
    hp: 8, speed: 78, dmg: 3, atkCooldown: 0.5, telegraphSec: 0.15, xp: 6, gold: [0, 2],
    loot: [{ id: 'berry', min: 1, max: 1, chance: 0.1 }],
    fromNight: 3, weight: 6,
    behavior: { kind: 'swarm', swarmSize: 4 },
    art: { size: 10, body: ramp('#3a2a10', '#5a3a1a', '#8a5a2a'), eye: ramp('#ffaa44')[0] },
  },

  // Vile Spore — floating AoE exploder
  {
    id: 'vile_spore', name: 'Vile Spore',
    hp: 16, speed: 50, dmg: 1, atkCooldown: 99, telegraphSec: 0, xp: 18, gold: [2, 5],
    loot: [{ id: 'sunleaf', min: 1, max: 2, chance: 0.25 }, { id: 'moonbell', min: 1, max: 1, chance: 0.15 }],
    fromNight: 8, weight: 3,
    behavior: { kind: 'exploder', explodeRadiusTiles: 2.5, explodeDmg: 28, explodeOnDeath: true },
    art: { size: 18, body: ramp('#3a4a1a', '#6a8a2a', '#aaca3a'), eye: ramp('#ffff44')[0] },
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

  // ---- A8: the Hoarder ------------------------------------------------------
  //
  // The loot goblin. It is the only enemy in the bestiary you can LOSE to
  // without taking a point of damage, and that is the entire mechanic: a fight
  // whose failure state is watching something walk off with your Sovereign.
  //
  // The chase is tuned to be barely losable. The player runs at 160 px/s
  // (CFG.player.speed); the Hoarder runs at 108 × 1.5 = 162. On open ground it
  // pulls away at 2 px/s — about half a tile every eight seconds — so a
  // straight sprint from full spook range loses, narrowly, and the counterplay
  // is everything that is NOT running faster: a chill (×0.65) or a tower slow
  // (×0.6) drops it under you, an echo or a bow hits it without closing, and
  // trees, water and cliffs corner it because it has no pathfinding either.
  //
  // **Stamina, added 2026-08-22.** That 2 px/s margin turned out to describe a
  // chase nobody could win OR lose on speed: a gap growing 2 px a second needs
  // over four minutes to cross the 21 tiles to `escapeTiles`, which is longer
  // than a third of the whole run. In practice the Hoarder never outran anyone
  // — it waited for a tree. The chase was therefore decided by whether the
  // terrain happened to help, and a player who lost one learned nothing they
  // could do differently next time, which is the definition of a bad loss.
  //
  // So it sprints for `staminaSec` and then blows up, decaying over
  // `tiredFadeSec` to `tiredSpeedMul` — 108 × 0.95 ≈ 103 px/s against a bare
  // 160. Committing to a chase now ends it, in roughly eleven seconds. The
  // counterplay above all still matters, because it decides whether you catch
  // it in eleven seconds or three; what changed is that "just run at it" is now
  // a strategy with a cost (eleven seconds of not doing anything else, at
  // whatever time of day you chose to spend them) rather than a mistake.
  // Stamina recovers at half rate while unspooked, so breaking off and
  // re-approaching is a decision and not a free kill.
  //
  // `dmg: 1` is a formality — the flee branch never enters the attack path, so
  // it is a number the Hoarder cannot spend. It is 1 rather than 0 because
  // testDataIntegrity requires every enemy to be able to hurt something, and
  // exempting a row from a data rule is how rows start lying.
  {
    id: 'hoarder', name: 'The Hoarder',
    hp: 90, speed: 108, dmg: 1, atkCooldown: 99, telegraphSec: 0.2, xp: 120, gold: [40, 90],
    // A pick-one group, for the same reason the Cairn has one: a Hoarder you
    // actually caught must never drop nothing. Losing the chase is the failure
    // state — winning it and getting an empty corpse would make the whole
    // mechanic read as broken rather than as unlucky.
    loot: [
      { id: 'sword_silver',  min: 1, max: 1, chance: 22, group: 'hoard' },
      { id: 'armor_silver',  min: 1, max: 1, chance: 20, group: 'hoard' },
      { id: 'ring_silver',   min: 1, max: 1, chance: 20, group: 'hoard' },
      { id: 'amulet_silver', min: 1, max: 1, chance: 20, group: 'hoard' },
      { id: 'charm_silver',  min: 1, max: 1, chance: 18, group: 'hoard' },
      { id: 'silver_ore',    min: 1, max: 3, chance: 0.8 },
      { id: 'echo_dust',     min: 1, max: 2, chance: 0.6 },
    ],
    lootBand: 'hoard',
    // weight 0.16 against gnawer 10 + wisp 4 is ~1.1% of day spawns. At one day
    // spawn every 3 s that is roughly one or two Hoarders in a full run — rare
    // enough to be an event, common enough that a run can actually contain one.
    fromNight: 1, weight: 0.16, daytime: true, dayOnly: true,
    behavior: {
      kind: 'flee', spookTiles: 11, fleeSpeedMul: 1.5, escapeTiles: 21,
      staminaSec: 8, tiredFadeSec: 2, tiredSpeedMul: 0.95,
    },
    art: { size: 18, body: ramp('#4a3a10', '#8a6a1a', '#e8c34a'), eye: ramp('#ffffff')[0] },
  },
];
