// Shared plain types used by data tables and systems.

export type ItemId = string;
export type SkillId = string;

export interface Stack {
  id: ItemId;
  n: number;
}

/** One weighted drop line: rolls `chance`, then a quantity in [min, max]. */
export interface LootRoll {
  id: ItemId;
  min: number;
  max: number;
  chance: number; // 0..1
}
export type LootTable = LootRoll[];
