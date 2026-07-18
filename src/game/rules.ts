// Pure game rules: inventory math, the xp curve, loot rolls, tool/weapon
// lookups. No rendering, no DOM — everything here is unit-testable.
import { CFG } from './data/config';
import { ITEMS } from './data/items';
import { activeEffects } from './systems/effects';
import { SOULGEAR, baseStatFor, type SoulSlot } from './data/soulgear';
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
  // N2a: xp rate modifier from distinct regions probed — read from mapping (live-tweakable)
  const net = (window as any).NW?.NET;
  let xpMul = net?.getGameValue?.('xpRate') ?? 1.0;
  // X1: Sage's Charm — all skill xp flows 20% richer
  if (activeEffects(state).has('xp_boost')) xpMul *= 1.2;
  state.player.xp[skill] = (state.player.xp[skill] ?? 0) + Math.round(amount * xpMul);
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

/** Best owned weapon damage bonus (the sharpest thing you carry — not trinkets). */
export function bestWeaponDmg(state: GameState): number {
  let best = 0;
  for (const id of Object.keys(state.player.inv)) {
    const def = ITEMS[id];
    if (def?.trinket) continue; // rings carry weaponDmg but aren't weapons
    const d = def?.weaponDmg ?? 0;
    if (d > best) best = d;
  }
  return best;
}

// ------------------------------------------------------------ equipment ----

/** The slots the player can wear items in (tools are carried, not worn). */
export type EquipSlot = 'weapon' | 'armor' | 'ring' | 'amulet' | 'charm' | 'relic';

/** Which equip slot an item belongs to, or null if it isn't gear. Trinkets
 * declare theirs explicitly (their stat fields overlap weapons/armor). */
export function slotOf(id: string): EquipSlot | null {
  const d = ITEMS[id];
  if (!d) return null;
  if (d.trinket) return d.trinket;
  if (d.relic) return 'relic' as EquipSlot;
  if (d.weaponDmg != null) return 'weapon';
  if (d.armor != null) return 'armor';
  return null;
}

/** Soul-leveled stat of a worn slot, or 0 if empty / item no longer owned. */
function wornStat(state: GameState, slot: EquipSlot): number {
  // C4: relics are flat stats (no soul-leveling for relics)
  if (slot === 'relic') {
    const id = state.player.relic;
    return id && invCount(state, id) > 0 ? (ITEMS[id]?.weaponDmg ?? ITEMS[id]?.armor ?? ITEMS[id]?.regen ?? 0) : 0;
  }
  const id = state.player.equip?.[slot];
  return id && invCount(state, id) > 0 ? soulStat(state, slot as SoulSlot) : 0;
}

/** Total damage bonus from worn gear (weapon + ring) — soul-leveled. */
export function equippedWeaponDmg(state: GameState): number {
  return wornStat(state, 'weapon') + wornStat(state, 'ring');
}

/** Total flat damage reduction from worn gear (armor + amulet) — soul-leveled. */
export function armorDef(state: GameState): number {
  return wornStat(state, 'armor') + wornStat(state, 'amulet');
}

/** Bonus hp/s the worn charm adds to daytime regen — soul-leveled. */
export function charmRegen(state: GameState): number {
  return wornStat(state, 'charm');
}

/** Equip an item into its slot, or unequip if it's already worn there. */
export function toggleEquip(state: GameState, id: string): EquipSlot | null {
  const slot = slotOf(id);
  if (!slot) return null;
  // C4: relics use a separate field (player.relic), not the equip object
  if (slot === 'relic') {
    const wasWorn = state.player.relic === id;
    state.player.relic = wasWorn ? undefined : id;
    return slot;
  }
  state.player.equip ??= {};
  const wasWorn = state.player.equip[slot] === id;
  state.player.equip[slot] = wasWorn ? undefined : id;
  if (!wasWorn) bindSoulItem(state, slot, id);
  return slot;
}

/** When gear enters the bag and its slot is empty, wear it automatically. */
export function autoEquip(state: GameState, id: string) {
  const slot = slotOf(id);
  if (!slot) return;
  // C4: relics use separate field
  if (slot === 'relic') {
    if (!state.player.relic) state.player.relic = id;
    return;
  }
  state.player.equip ??= {};
  const cur = state.player.equip[slot];
  // upgrade to the better item, or fill an empty slot
  const stat = (x?: string) => (x ? baseStatFor(slot as SoulSlot, x) : 0);
  if (!cur || stat(id) > stat(cur)) state.player.equip[slot] = id;
}

/** autoEquip + tool selection, plus keeping the relevant soul item(s) bound to
 * whatever physical item(s) actually ended up in play. Call this wherever gear
 * enters the bag (craft/loot/gather); it's a superset of autoEquip. */
export function acquireGear(state: GameState, id: string) {
  autoEquip(state, id);
  const slot = slotOf(id);
  // C4: relics don't use soul binding
  if (slot && slot !== 'relic' && state.player.equip?.[slot] === id) bindSoulItem(state, slot, id);
  const cls = ITEMS[id]?.toolClass;
  if (cls) {
    const toolSlot: SoulSlot = cls === 'axe' ? 'tool_axe' : 'tool_pick';
    const best = bestTool(state, cls);
    if (best) bindSoulItem(state, toolSlot, best.id);
  }
}

// ------------------------------------------------------------- soul gear ----

/** xp needed to go from soul-level L to L+1 (see config.soulgear) — a much
 * steeper, higher-ceiling curve than skills: hundreds of hours to maxLevel. */
export function soulXpToNext(level: number): number {
  return Math.round(CFG.soulgear.xpBase * Math.pow(CFG.soulgear.xpGrowth, level - 1));
}

export function soulLevelFromXp(xp: number): number {
  let level = 1, need = soulXpToNext(1);
  while (xp >= need && level < CFG.soulgear.maxLevel) {
    xp -= need;
    level++;
    need = soulXpToNext(level);
  }
  return level;
}

export function soulXpProgress(xp: number): [number, number] {
  let level = 1, need = soulXpToNext(1);
  while (xp >= need && level < CFG.soulgear.maxLevel) {
    xp -= need;
    level++;
    need = soulXpToNext(level);
  }
  return [xp, need];
}

/** The slot's current effective stat: physical item's base + soul-level growth. */
export function soulStat(state: GameState, slot: SoulSlot): number {
  const s = state.player.soulItems?.[slot];
  if (!s) return 0;
  return baseStatFor(slot, s.templateId) + SOULGEAR[slot].growthPerLevel * (s.level - 1);
}

/** Ensures a slot's soul item exists (created at level 1 the first time
 * anything fills it) and points at the current physical item — level/xp persist. */
export function bindSoulItem(state: GameState, slot: SoulSlot, itemId: string) {
  state.player.soulItems ??= {};
  const cur = state.player.soulItems[slot];
  if (!cur) state.player.soulItems[slot] = { slot, templateId: itemId, level: 1, xp: 0 };
  else cur.templateId = itemId;
}

/** Grants soul xp to a slot; returns the new level if this crossed a threshold, else 0. */
export function awardSoulXp(state: GameState, slot: SoulSlot, amount: number): number {
  const s = state.player.soulItems?.[slot];
  if (!s) return 0;
  const before = s.level;
  s.xp += amount;
  s.level = soulLevelFromXp(s.xp);
  return s.level > before ? s.level : 0;
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
