// Pure game rules: inventory math, the xp curve, loot rolls, tool/weapon
// lookups. No rendering, no DOM — everything here is unit-testable.
import { CFG } from './data/config';
import { ITEMS } from './data/items';
import type { GameState } from './state';
import type { LootTable, Stack } from './types';

// ------------------------------------------------------------ inventory ----

export function invAdd(state: GameState, id: string, n: number) {
  state.player.inv[id] = (state.player.inv[id] ?? 0) + n;
  if (state.player.inv[id] <= 0) delete state.player.inv[id];
}

export function invCount(state: GameState, id: string): number {
  return state.player.inv[id] ?? 0;
}

export function invHasAll(state: GameState, stacks: Stack[]): boolean {
  return stacks.every((s) => invCount(state, s.id) >= s.n);
}

export function invTakeAll(state: GameState, stacks: Stack[]): boolean {
  if (!invHasAll(state, stacks)) return false;
  for (const s of stacks) invAdd(state, s.id, -s.n);
  return true;
}

// -------------------------------------------------------------------- xp ----

/** xp needed to go from level L to L+1 (see config.xp). */
export function xpToNext(level: number): number {
  return Math.round(CFG.xp.base * Math.pow(CFG.xp.growth, level - 1));
}

export function levelFromXp(xp: number): number {
  let level = 1, need = xpToNext(1);
  while (xp >= need && level < CFG.xp.maxLevel) {
    xp -= need;
    level++;
    need = xpToNext(level);
  }
  return level;
}

/** xp progress within the current level, for UI bars → [have, need]. */
export function xpProgress(xp: number): [number, number] {
  let level = 1, need = xpToNext(1);
  while (xp >= need && level < CFG.xp.maxLevel) {
    xp -= need;
    level++;
    need = xpToNext(level);
  }
  return [xp, need];
}

export function skillLevel(state: GameState, skill: string): number {
  return levelFromXp(state.player.xp[skill] ?? 0);
}

/** Grants xp; returns the new level if this crossed a threshold, else 0. */
export function addXp(state: GameState, skill: string, amount: number): number {
  const before = skillLevel(state, skill);
  state.player.xp[skill] = (state.player.xp[skill] ?? 0) + amount;
  const after = skillLevel(state, skill);
  return after > before ? after : 0;
}

// ------------------------------------------------------------------ loot ----

export function rollLoot(table: LootTable): Stack[] {
  const out: Stack[] = [];
  for (const roll of table) {
    if (Math.random() < roll.chance) {
      out.push({ id: roll.id, n: roll.min + Math.floor(Math.random() * (roll.max - roll.min + 1)) });
    }
  }
  return out;
}

// ----------------------------------------------------------------- tools ----

/** Best owned tool of a class (highest toolPower), or null. */
export function bestTool(state: GameState, cls: 'axe' | 'pick') {
  let best = null as null | { id: string; power: number };
  for (const id of Object.keys(state.player.inv)) {
    const def = ITEMS[id];
    if (def?.toolClass === cls && (!best || (def.toolPower ?? 0) > best.power)) {
      best = { id, power: def.toolPower ?? 0 };
    }
  }
  return best;
}

/** Best owned weapon damage bonus (the sharpest thing you carry). */
export function bestWeaponDmg(state: GameState): number {
  let best = 0;
  for (const id of Object.keys(state.player.inv)) {
    const d = ITEMS[id]?.weaponDmg ?? 0;
    if (d > best) best = d;
  }
  return best;
}

// ------------------------------------------------------------ equipment ----

/** Which equip slot an item belongs to, or null if it isn't gear. */
export function slotOf(id: string): 'weapon' | 'armor' | null {
  const d = ITEMS[id];
  if (!d) return null;
  if (d.weaponDmg != null) return 'weapon';
  if (d.armor != null) return 'armor';
  return null;
}

/** Damage bonus from the equipped weapon (0 if the slot is empty/lost). */
export function equippedWeaponDmg(state: GameState): number {
  const w = state.player.equip?.weapon;
  return w && invCount(state, w) > 0 ? (ITEMS[w]?.weaponDmg ?? 0) : 0;
}

/** Flat damage reduction from the equipped armor. */
export function armorDef(state: GameState): number {
  const a = state.player.equip?.armor;
  return a && invCount(state, a) > 0 ? (ITEMS[a]?.armor ?? 0) : 0;
}

/** Equip an item into its slot, or unequip if it's already worn there. */
export function toggleEquip(state: GameState, id: string): 'weapon' | 'armor' | null {
  const slot = slotOf(id);
  if (!slot) return null;
  state.player.equip ??= {};
  state.player.equip[slot] = state.player.equip[slot] === id ? undefined : id;
  return slot;
}

/** When gear enters the bag and its slot is empty, wear it automatically. */
export function autoEquip(state: GameState, id: string) {
  const slot = slotOf(id);
  if (!slot) return;
  state.player.equip ??= {};
  const cur = state.player.equip[slot];
  // upgrade to the better item, or fill an empty slot
  const stat = (x?: string) => (x ? (slot === 'weapon' ? ITEMS[x]?.weaponDmg : ITEMS[x]?.armor) ?? 0 : 0);
  if (!cur || stat(id) > stat(cur)) state.player.equip[slot] = id;
}

// ------------------------------------------------------------- territory ----

import { BUILDINGS } from './data/buildings';

const bDef = (type: string) => BUILDINGS.find((b) => b.id === type)!;

export function territoryScore(state: GameState): number {
  return state.buildings.reduce((sum, b) => sum + bDef(b.type).territory, 0);
}

export function population(state: GameState): number {
  if (!state.buildings.some((b) => b.type === 'hall')) return 0;
  return CFG.economy.basePop + state.buildings.reduce((sum, b) => sum + bDef(b.type).pop, 0);
}

export function hall(state: GameState) {
  return state.buildings.find((b) => b.type === 'hall') ?? null;
}
