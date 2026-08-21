// Soul Gear: the equip SLOT itself is the soul-bound thing, not any one item.
// A slot's soul tool "reincarnates" into whatever's the best physical item you
// currently wield there (its base stat), but its cultivated `level` — earned by
// use, on an RS-scale grind — persists across every upgrade. One growth curve
// per slot; the item that fills the slot only changes the *base* the curve
// grows from.
import { itemDef } from './items';

export type SoulSlot =
  | 'weapon' | 'armor' | 'tool_axe' | 'tool_pick'
  | 'ring' | 'amulet' | 'charm';

export const SOULGEAR: Record<SoulSlot, { growthPerLevel: number }> = {
  weapon: { growthPerLevel: 0.18 },     // + weapon dmg per level above 1
  armor: { growthPerLevel: 0.09 },      // + armor per level above 1
  tool_axe: { growthPerLevel: 0.025 },  // + tool power per level above 1
  tool_pick: { growthPerLevel: 0.025 },
  ring: { growthPerLevel: 0.06 },       // + dmg per level (levels on landed swings)
  amulet: { growthPerLevel: 0.05 },     // + armor per level (levels on hits taken)
  charm: { growthPerLevel: 0.02 },      // + day regen hp/s per level (levels on kills)
};

/** The physical item's raw stat for this slot (level-1 baseline). */
export function baseStatFor(slot: SoulSlot, itemId: string): number {
  const d = itemDef(itemId);
  if (!d) return 0;
  if (slot === 'weapon' || slot === 'ring') return d.weaponDmg ?? 0;
  if (slot === 'armor' || slot === 'amulet') return d.armor ?? 0;
  if (slot === 'charm') return d.regen ?? 0;
  return d.toolPower ?? 0; // tool_axe / tool_pick
}
