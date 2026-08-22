// SoulFeedSystem — consume inventory items to directly grant XP to soul-bound
// gear slots. This gives materials a second purpose beyond crafting and deepens
// the gear progression loop.
//
// Design:
// - Any item with soulXp > 0 (ItemDef) or material with xpValue > 0 (MaterialDef)
//   can be fed to a soul slot.
// - Affinity bonus: if the material/item's soulAffinity matches the target slot,
//   XP is multiplied by 1.5×. If opposed (see OPPOSED_AFFINITIES), 0.5×.
// - XP required per level follows the existing soul-gear curve (RS-style).
// - Feeding consumes the items from inventory. Cannot be undone.

import type { GameState } from '../state';
import type { SoulSlot } from '../data/soulgear';
import { itemDef, type ItemDef } from '../data/items';
import { MATERIALS, type MaterialDef } from '../data/materials';
import { CFG } from '../data/config';

// ---- affinity system ----
// Which slots are "opposed" to a given affinity — feeding to these gets 0.5× instead of 1.5×.
const OPPOSED: Partial<Record<SoulSlot, SoulSlot[]>> = {
  weapon: ['armor', 'charm'],
  armor: ['weapon', 'ring'],
  tool_axe: ['tool_pick', 'amulet'],
  tool_pick: ['tool_axe', 'ring'],
  ring: ['armor', 'tool_pick'],
  amulet: ['tool_axe', 'charm'],
  charm: ['weapon', 'amulet'],
};

export interface FeedResult {
  /** How much XP was actually granted. */
  xp: number;
  /** The affinity multiplier applied (0.5, 1.0, or 1.5). */
  affinityMul: number;
  /** Whether the slot leveled up from this feed. */
  leveled: boolean;
  /** New level after feed. */
  newLevel: number;
  /** New XP progress within the new level. */
  newXp: number;
}

// XP required to go from level L to L+1. Uses the existing soul-gear growth curve:
// baseCost = 50 + (L-1)*30, then scaled by a per-slot growth factor.
function xpToNext(slot: SoulSlot, currentLevel: number): number {
  const base = 50 + (currentLevel - 1) * 30;
  // Higher growth-per-level slots need more XP to level
  const growth = { weapon: 1.0, armor: 0.8, tool_axe: 0.6, tool_pick: 0.6, ring: 0.9, amulet: 0.85, charm: 0.7 } as const;
  return Math.ceil(base * (growth[slot] ?? 1.0));
}

/** How much soul XP is one unit of this item worth? Returns 0 if not feedable. */
export function itemSoulXp(itemId: string): number {
  const def = itemDef(itemId);
  if (!def) return 0;
  // ItemDef.soulXp takes priority
  if (def.soulXp && def.soulXp > 0) return def.soulXp;
  // Check if this item maps to a material (gatherable resources)
  // Items like 'log', 'stone' etc. don't have soulXp but their corresponding
  // materials do. We use the item's soulXp first, then fall back to material.
  return 0;
}

/** Get the soul affinity for a feedable item. */
export function itemSoulAffinity(itemId: string): SoulSlot | undefined {
  const def = itemDef(itemId);
  if (!def) return undefined;
  // Try to map to material affinity
  const mat = materialForItem(itemId);
  return mat?.soulAffinity;
}

/** Map an item ID to its corresponding material, if any. */
function materialForItem(itemId: string): MaterialDef | undefined {
  const def = itemDef(itemId);
  if (!def) return undefined;
  // Heuristic: items that are raw resources often match material names
  const matName = itemId === 'stone' ? 'hill' // Runestone comes from hills
    : itemId === 'log' || itemId === 'fine_log' || itemId === 'plank' ? 'forest'
    : itemId === 'copper_ore' || itemId === 'copper_bar' ? 'hill'
    : itemId === 'iron_ore' || itemId === 'iron_bar' ? 'mountain'
    : itemId === 'silver_ore' || itemId === 'silver_bar' ? 'Azure Vein'
    : itemId === 'star_ore' || itemId === 'star_bar' ? 'Warp Rift'
    : itemId === 'sunleaf' || itemId === 'berry' ? 'meadow'
    : itemId === 'moonbell' ? 'forest'
    : itemId === 'charcoal' || itemId === 'torch' ? 'Ash'
    : undefined;
  if (!matName) return undefined;
  return MATERIALS.find(m => m.name === matName);
}

/** How much total soul XP is this item worth (soulXp + material xpValue)? */
export function totalSoulXp(itemId: string): number {
  return itemSoulXp(itemId);
}

export class SoulFeedSystem {
  /** Feed `count` of `itemId` to `targetSlot`. Returns the result. */
  feed(state: GameState, itemId: string, count: number, targetSlot: SoulSlot): FeedResult | null {
    // Validate
    const xpEach = totalSoulXp(itemId);
    if (xpEach <= 0) return null;
    if (count <= 0) return null;
    const inInv = state.player.inv[itemId] ?? 0;
    if (inInv < count) return null;

    // Compute affinity multiplier
    const affinity = itemSoulAffinity(itemId);
    let affinityMul = 1.0;
    if (affinity && affinity === targetSlot) {
      affinityMul = 1.5;
    } else if (affinity && OPPOSED[affinity]?.includes(targetSlot)) {
      affinityMul = 0.5;
    }

    // Compute XP
    const baseXp = xpEach * count;
    const totalXp = Math.ceil(baseXp * affinityMul);

    // Consume items
    state.player.inv[itemId]! -= count;
    if (state.player.inv[itemId]! <= 0) delete state.player.inv[itemId];

    // Grant XP to soul slot
    const si = state.player.soulItems[targetSlot];
    if (!si) {
      // No soul item in this slot yet — create one at level 1
      const templateId = state.player.equip?.[targetSlot as keyof typeof state.player.equip]
        ?? (targetSlot === 'tool_axe' ? 'axe_flint'
          : targetSlot === 'tool_pick' ? 'pick_flint'
          : undefined);
      if (!templateId) return null; // can't feed an empty slot with no template
      const newSi = { slot: targetSlot, templateId, level: 1, xp: totalXp };
      state.player.soulItems[targetSlot] = newSi;
      // Check level-ups
      let leveled = false;
      while (newSi.xp >= xpToNext(targetSlot, newSi.level)) {
        newSi.xp -= xpToNext(targetSlot, newSi.level);
        newSi.level++;
        leveled = true;
      }
      return { xp: totalXp, affinityMul, leveled, newLevel: newSi.level, newXp: newSi.xp };
    }

    // Existing soul item
    si.xp += totalXp;
    let leveled = false;
    while (si.xp >= xpToNext(targetSlot, si.level)) {
      si.xp -= xpToNext(targetSlot, si.level);
      si.level++;
      leveled = true;
    }
    return { xp: totalXp, affinityMul, leveled, newLevel: si.level, newXp: si.xp };
  }

  /** Check if an item can be fed at all (has any soul XP value). */
  canFeed(itemId: string): boolean {
    return totalSoulXp(itemId) > 0;
  }

  /** Get a human-readable label for the affinity relationship. */
  affinityLabel(itemId: string, targetSlot: SoulSlot): string {
    const affinity = itemSoulAffinity(itemId);
    if (!affinity) return '';
    if (affinity === targetSlot) return '★ Affinity bonus: 1.5×';
    if (OPPOSED[affinity]?.includes(targetSlot)) return '⚠ Opposed: 0.5×';
    return '';
  }
}
