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
  /** Ungrouped: probability in 0..1. Grouped: relative WEIGHT within the
   *  group, on any scale you like. */
  chance: number;
  /** A8: rows sharing a group are a PICK-ONE. The group yields exactly one of
   *  its rows, drawn by weight — never zero, never two.
   *
   *  Independent per-row chances cannot express "guaranteed something, and the
   *  surprise is what". A Cairn's five gear rows at 0.34/0.30/0.22/0.22/0.22
   *  come out EMPTY 22% of the time, which is a table quietly contradicting the
   *  design it was written for: cross the map, fight what wakes, get nothing.
   *  (The Gauntlet found this one at 3.3% for the whole table — see
   *  testLootGroups.) Every pre-A8 table leaves this undefined and behaves
   *  exactly as it always has. */
  group?: string;
}
export type LootTable = LootRoll[];
