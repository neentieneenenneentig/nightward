// Crafting recipes. `station` is reserved for gating on buildings later
// (e.g. 'furnace') — null means craftable anywhere.
import type { Stack } from '../types';

export interface Recipe {
  id: string;
  out: Stack;
  in: Stack[];
  skill: string;
  levelReq: number;
  xp: number;
  station: string | null;
}

const R = (
  id: string, skill: string, levelReq: number, xp: number,
  out: Stack, ...inputs: Stack[]
): Recipe => ({ id, skill, levelReq, xp, out, in: inputs, station: null });

const s = (id: string, n = 1): Stack => ({ id, n });

export const RECIPES: Recipe[] = [
  // crafting
  R('plank',       'crafting', 1, 18, s('plank', 3), s('log', 2)),
  R('axe_flint',   'crafting', 1, 15, s('axe_flint'), s('stone', 1), s('log', 1)),
  R('pick_flint',  'crafting', 1, 15, s('pick_flint'), s('stone', 1), s('log', 1)),
  R('vest_bark',   'crafting', 2, 32, s('vest_bark'), s('log', 3), s('sunleaf', 1)),
  // smithing
  R('copper_bar',  'smithing', 1, 28, s('copper_bar'), s('copper_ore', 2)),
  R('axe_copper',  'smithing', 3, 40, s('axe_copper'), s('copper_bar', 1), s('log', 1)),
  R('pick_copper', 'smithing', 3, 40, s('pick_copper'), s('copper_bar', 1), s('log', 1)),
  R('sword_copper','smithing', 5, 60, s('sword_copper'), s('copper_bar', 2), s('plank', 1)),
  R('armor_copper','smithing', 6, 75, s('armor_copper'), s('copper_bar', 3), s('plank', 1)),
  R('iron_bar',    'smithing', 10, 55, s('iron_bar'), s('iron_ore', 2)),
  R('axe_iron',    'smithing', 12, 80, s('axe_iron'), s('iron_bar', 1), s('fine_log', 1)),
  R('pick_iron',   'smithing', 12, 80, s('pick_iron'), s('iron_bar', 1), s('fine_log', 1)),
  R('sword_iron',  'smithing', 15, 120, s('sword_iron'), s('iron_bar', 2), s('plank', 1)),
  R('armor_iron',  'smithing', 16, 150, s('armor_iron'), s('iron_bar', 3), s('plank', 2)),
  // alchemy
  R('tonic_minor', 'alchemy', 1, 22, s('tonic_minor'), s('sunleaf', 1), s('berry', 2)),
  R('tonic_major', 'alchemy', 8, 60, s('tonic_major'), s('moonbell', 1), s('berry', 3)),
  // trinkets (rings sharpen, amulets ward, charms mend — each its own soul slot)
  R('amulet_stone', 'crafting', 3, 40, s('amulet_stone'), s('stone', 2), s('sunleaf', 1)),
  R('charm_ember',  'crafting', 5, 55, s('charm_ember'), s('log', 2), s('berry', 3)),
  R('ring_copper',  'smithing', 4, 50, s('ring_copper'), s('copper_bar', 1)),
  R('ring_iron',    'smithing', 13, 110, s('ring_iron'), s('iron_bar', 1)),
  R('amulet_iron',  'smithing', 14, 120, s('amulet_iron'), s('iron_bar', 1), s('moonbell', 1)),
  R('charm_moon',   'alchemy', 10, 90, s('charm_moon'), s('moonbell', 2), s('fine_log', 1)),
  // firemaking
  R('torch',        'crafting', 1, 15, s('torch'), s('log', 1), s('stone', 1)),

  // ---- C4: Silver & Star-Metal tiers ----------------------------------------
  R('silver_bar',  'smithing', 20, 100, s('silver_bar'), s('silver_ore', 2)),
  R('sword_silver','smithing', 22, 160, s('sword_silver'), s('silver_bar', 2), s('plank', 1)),
  R('armor_silver','smithing', 24, 200, s('armor_silver'), s('silver_bar', 3), s('plank', 2)),
  R('ring_silver',  'smithing', 21, 140, s('ring_silver'), s('silver_bar', 1)),
  R('amulet_silver','smithing', 23, 150, s('amulet_silver'), s('silver_bar', 1), s('moonbell', 1)),
  R('charm_silver', 'alchemy', 20, 180, s('charm_silver'), s('silver_bar', 1), s('sunleaf', 3)),
  R('star_bar',    'smithing', 30, 150, s('star_bar'), s('star_ore', 2)),
  R('sword_star',  'smithing', 33, 250, s('sword_star'), s('star_bar', 2), s('plank', 2)),
  R('armor_star',  'smithing', 35, 300, s('armor_star'), s('star_bar', 3), s('plank', 3)),
  R('ring_star',   'smithing', 32, 220, s('ring_star'), s('star_bar', 1)),
  R('amulet_star', 'smithing', 34, 240, s('amulet_star'), s('star_bar', 1), s('moonbell', 2)),
  R('charm_star',  'alchemy', 30, 280, s('charm_star'), s('star_bar', 1), s('berry', 5)),
];
