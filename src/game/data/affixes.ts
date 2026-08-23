// A1 — rolled affixes.
//
// The reason this milestone is cheap is worth stating at the top of the file it
// exploits: `grep registerEffect` returns **fifteen live, already-consumed
// effect hooks** — fire_aura, lifesteal, chain_on_kill, dodge, gold_find,
// thorns_reflect and the rest. They were built in C4 to serve **five relics**,
// and fourteen of them are reachable from exactly one item each in the whole
// game. So the entire SUFFIX half of an affix system is a data table over hooks
// that already work, already have consumers, and are already Gauntlet-covered.
//
// The prefix half writes to the four stat columns `ItemDef` already has
// (`weaponDmg`, `armor`, `regen`, `toolPower`), plus a small set of named
// MULTIPLIERS that systems read through `gearMod()`. Every modifier is a
// multiplier and they compose by multiplication, so there is exactly one
// composition rule to remember and no additive/multiplicative ordering bug to
// discover later.
//
// Direction convention, because getting it backwards is silent: **a multiplier
// above 1 always means "more of the thing named"**. `moveSpeed: 1.06` is
// faster. `vigorDecay: 0.80` is slower decay, which is good. `vigorDecay: 1.45`
// is faster decay, which is a curse.
import type { RarityId } from './rarity';

/** Which kind of item an affix can land on. Derived from the item's own stat
 *  columns at roll time — there is no new field on ItemDef. */
export type AffixSlot = 'weapon' | 'armor' | 'ring' | 'amulet' | 'charm' | 'tool';

/** Named multipliers that systems read via `gearMod(state, key)`. Every one has
 *  a live consumer — see the table in A-arsenal §5.1. A modifier with no
 *  consumer is a dormant row, and this project has learned what those cost. */
export type GearMod =
  | 'moveSpeed'      // player walk speed
  | 'swingSpeed'     // attack envelope speed (>1 = shorter windup/recovery)
  | 'vigorDecay'     // Vigor drain rate (<1 = good)
  | 'resolveDecay'   // Resolve drain rate (<1 = good)
  | 'buildHp'        // max HP of everything you build while this is worn
  | 'soulXp';        // soul xp granted to the slot that earned it

export interface AffixDef {
  id: string;
  /** Rendered verbatim. Prefixes go before the base name, suffixes after. */
  name: string;
  kind: 'prefix' | 'suffix';
  /** Item classes this can land on. */
  on: AffixSlot[];
  /** Flat addition to one of ItemDef's four stat columns. */
  stat?: 'weaponDmg' | 'armor' | 'regen' | 'toolPower';
  add?: [number, number];
  /** Multiplier on that same stat column, applied after `add`. */
  mul?: [number, number];
  /** One of the fifteen registered effect hooks. */
  effect?: string;
  /** A named multiplier, read through gearMod(). */
  mod?: GearMod;
  modRange?: [number, number];
  /** Cursed affixes only roll onto Riftborn, and Riftborn always gets one. */
  cursed?: boolean;
  /** Relative weight within its pool. */
  weight: number;
  /** Never roll below this tier (keeps the loudest effects off white items). */
  minTier?: RarityId;
}

// ------------------------------------------------------------- prefixes ----
// These write to the stat columns and the named multipliers. Ranges are the
// roll band; the actual value is uniform inside it and stored on the item, so
// two Keen blades are genuinely different blades.

export const PREFIXES: AffixDef[] = [
  { id: 'keen',      name: 'Keen',      kind: 'prefix', on: ['weapon', 'ring'],
    stat: 'weaponDmg', mul: [1.08, 1.22], weight: 100 },
  { id: 'heavy',     name: 'Heavy',     kind: 'prefix', on: ['weapon'],
    stat: 'weaponDmg', add: [2, 6], mod: 'swingSpeed', modRange: [0.94, 0.94], weight: 70 },
  { id: 'warded',    name: 'Warded',    kind: 'prefix', on: ['armor', 'amulet'],
    stat: 'armor', add: [1, 4], weight: 100 },
  // charm only: baseStatFor() reads `regen` for the charm slot and nothing
  // else, so a regen roll on a chestplate would be a stat no reader ever asks
  // for — a dormant affix, which is the same sin as a dormant row.
  { id: 'deep',      name: 'Deep',      kind: 'prefix', on: ['charm'],
    stat: 'regen', add: [0.4, 1.2], weight: 80 },
  { id: 'biting',    name: 'Biting',    kind: 'prefix', on: ['tool'],
    stat: 'toolPower', mul: [1.12, 1.30], weight: 100 },
  { id: 'swift',     name: 'Swift',     kind: 'prefix', on: ['armor', 'charm'],
    mod: 'moveSpeed', modRange: [1.03, 1.08], weight: 70 },
  { id: 'tireless',  name: 'Tireless',  kind: 'prefix', on: ['charm', 'amulet'],
    mod: 'vigorDecay', modRange: [0.75, 0.90], weight: 60 },
  { id: 'steady',    name: 'Steady',    kind: 'prefix', on: ['amulet', 'charm'],
    mod: 'resolveDecay', modRange: [0.75, 0.90], weight: 60 },
  { id: 'rooted',    name: 'Rooted',    kind: 'prefix', on: ['weapon', 'armor', 'ring', 'amulet', 'charm', 'tool'],
    mod: 'buildHp', modRange: [1.10, 1.30], weight: 45 },
  { id: 'hungering', name: 'Hungering', kind: 'prefix', on: ['weapon', 'armor', 'ring', 'amulet', 'charm', 'tool'],
    mod: 'soulXp', modRange: [1.12, 1.30], weight: 45 },

  // ---- SR2: elemental damage, as an affix any weapon or ring can roll -----
  // X1 shipped four swords that each HARD-CODE one element's effect hook —
  // sword_fire IS fire_on_hit, permanently, on that one blade. These four rows
  // are the same four hooks (fire/frost/storm/void, i.e. the PoE-shape
  // fire/cold/lightning/chaos) offered as an ordinary roll on ANY eligible
  // weapon or ring, the way `keen`/`heavy` already are. `stat`+`effect` on one
  // row is not a new mechanism — `heavy` above already pairs `stat` with a
  // second field (`mod`) — so a blade can roll "Molten" and get both a damage
  // line AND the ignite chance, same as the four X1 swords always have.
  // Physical is already covered: `keen` and `heavy` above ARE the physical
  // family, so it gets no fifth row here rather than a duplicate of them.
  { id: 'molten',   name: 'Molten',    kind: 'prefix', on: ['weapon', 'ring'],
    stat: 'weaponDmg', add: [2, 5], effect: 'fire_on_hit',   weight: 55 },
  { id: 'rimed',    name: 'Rimed',     kind: 'prefix', on: ['weapon', 'ring'],
    stat: 'weaponDmg', add: [2, 5], effect: 'chill_on_hit',  weight: 55 },
  // Gated at the same minTier as their suffix equivalents (of_the_chain,
  // of_the_leech) — same hook, same power level, so the same floor applies.
  { id: 'charged',  name: 'Charged',   kind: 'prefix', on: ['weapon', 'ring'],
    stat: 'weaponDmg', add: [2, 6], effect: 'chain_on_kill', weight: 40, minTier: 'woven' },
  { id: 'warped',   name: 'Warped',    kind: 'prefix', on: ['weapon', 'ring'],
    stat: 'weaponDmg', add: [2, 6], effect: 'lifesteal',     weight: 40, minTier: 'woven' },
];

// -------------------------------------------------------------- suffixes ----
// Fifteen rows over fifteen hooks that already work. `minTier` keeps the loud
// ones (an aura that sets the world on fire) off the bottom of the ladder.

export const SUFFIXES: AffixDef[] = [
  { id: 'of_the_ember',      name: 'of the Ember',      kind: 'suffix',
    on: ['weapon', 'armor', 'ring', 'amulet', 'charm'], effect: 'fire_aura',   weight: 40, minTier: 'woven' },
  { id: 'of_the_rime',       name: 'of the Rime',       kind: 'suffix',
    on: ['weapon', 'armor', 'ring', 'amulet', 'charm'], effect: 'chill_aura',  weight: 40, minTier: 'woven' },
  { id: 'of_the_thorn',      name: 'of the Thorn',      kind: 'suffix',
    on: ['armor', 'amulet'],                            effect: 'thorns_reflect', weight: 55 },
  { id: 'of_the_tide',       name: 'of the Tide',       kind: 'suffix',
    on: ['charm', 'amulet', 'armor'],                   effect: 'regen_boost', weight: 65 },
  { id: 'of_the_hollow',     name: 'of the Hollow',     kind: 'suffix',
    on: ['ring', 'amulet', 'charm'],                    effect: 'see_foe_hp',  weight: 55 },
  { id: 'of_the_nightseer',  name: 'of the Nightseer',  kind: 'suffix',
    on: ['charm', 'amulet'],                            effect: 'night_vision', weight: 50 },
  { id: 'of_kindling',       name: 'of Kindling',       kind: 'suffix',
    on: ['weapon', 'ring'],                             effect: 'fire_on_hit', weight: 60 },
  { id: 'of_hoarfrost',      name: 'of Hoarfrost',      kind: 'suffix',
    on: ['weapon', 'ring'],                             effect: 'chill_on_hit', weight: 60 },
  { id: 'of_the_leech',      name: 'of the Leech',      kind: 'suffix',
    on: ['weapon', 'ring', 'amulet'],                   effect: 'lifesteal',   weight: 35, minTier: 'woven' },
  { id: 'of_the_chain',      name: 'of the Chain',      kind: 'suffix',
    on: ['weapon', 'ring'],                             effect: 'chain_on_kill', weight: 40, minTier: 'woven' },
  { id: 'of_the_wisp',       name: 'of the Wisp',       kind: 'suffix',
    on: ['armor', 'charm', 'amulet'],                   effect: 'dodge',       weight: 35, minTier: 'woven' },
  { id: 'of_the_quickening', name: 'of the Quickening', kind: 'suffix',
    on: ['armor', 'charm', 'ring'],                     effect: 'move_burst_on_kill', weight: 50 },
  { id: 'of_plenty',         name: 'of Plenty',         kind: 'suffix',
    on: ['ring', 'amulet', 'charm', 'tool'],            effect: 'gold_find',   weight: 60 },
  { id: 'of_the_scholar',    name: 'of the Scholar',    kind: 'suffix',
    on: ['ring', 'amulet', 'charm', 'tool'],            effect: 'xp_boost',    weight: 60 },
  { id: 'of_resonance',      name: 'of Resonance',      kind: 'suffix',
    on: ['weapon', 'ring', 'amulet'],                   effect: 'resonance_boost', weight: 45, minTier: 'woven' },
];

// ---------------------------------------------------------------- curses ----
// Riftborn's price. Rolled from this pool INSTEAD of one ordinary affix, never
// in addition to the full complement — the item is still the best thing in the
// game, it simply cannot be worn thoughtlessly.

export const CURSES: AffixDef[] = [
  { id: 'of_hunger',      name: 'of Hunger',      kind: 'suffix', on: ['weapon', 'armor', 'ring', 'amulet', 'charm', 'tool'],
    mod: 'vigorDecay',   modRange: [1.35, 1.60], cursed: true, weight: 100 },
  { id: 'of_dread',       name: 'of Dread',       kind: 'suffix', on: ['weapon', 'armor', 'ring', 'amulet', 'charm', 'tool'],
    mod: 'resolveDecay', modRange: [1.35, 1.60], cursed: true, weight: 100 },
  { id: 'of_weight',      name: 'of Weight',      kind: 'suffix', on: ['weapon', 'armor', 'ring', 'amulet', 'charm', 'tool'],
    mod: 'moveSpeed',    modRange: [0.84, 0.92], cursed: true, weight: 100 },
  { id: 'of_frailty',     name: 'of Frailty',     kind: 'suffix', on: ['weapon', 'ring'],
    mod: 'swingSpeed',   modRange: [0.85, 0.92], cursed: true, weight: 80 },
  { id: 'of_brittleness', name: 'of Brittleness', kind: 'suffix', on: ['armor', 'amulet'],
    stat: 'armor', add: [-3, -1], cursed: true, weight: 80 },
];

export const ALL_AFFIXES: AffixDef[] = [...PREFIXES, ...SUFFIXES, ...CURSES];

export function affixDef(id: string): AffixDef | undefined {
  return ALL_AFFIXES.find((a) => a.id === id);
}
