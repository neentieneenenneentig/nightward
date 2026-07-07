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
];
