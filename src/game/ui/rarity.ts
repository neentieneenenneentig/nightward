// A4 — one place that knows how a rarity looks.
//
// The Bag, the tooltip, the ground beam, the toast line, the log and the death
// scorecard all need the same colour for the same item. Six copies of a hex
// value is five chances for the ladder to disagree with itself, and a ladder
// whose colours disagree is worse than no ladder — the player is reading tier
// from colour before they read a single stat.
import { itemDef, itemName, rolledOf } from '../data/items';
import { rarityDef, rarityIndex, type RarityId } from '../data/rarity';
import { affixDef } from '../data/affixes';

export function rarityOf(id: string): RarityId {
  return rolledOf(id)?.rarity ?? 'plain';
}

/** CSS colour for an item id. */
export function rarityColor(id: string): string {
  return rarityDef(rarityOf(id)).color;
}

/** The same colour as a Pixi tint. */
export function rarityTint(id: string): number {
  return parseInt(rarityDef(rarityOf(id)).color.slice(1), 16);
}

/** Is this item worth a light shaft on the floor? */
export function isBeamworthy(id: string, from: string): boolean {
  return rarityIndex(rarityOf(id)) >= rarityIndex(from as RarityId);
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!
  ));
}

/** The item's name, coloured. Plain items render in the ordinary ink colour
 *  rather than a near-white of their own — the ladder should be invisible until
 *  something actually rolled. */
export function nameHtml(id: string): string {
  const r = rolledOf(id);
  const name = escapeHtml(itemName(id));
  if (!r) return name;
  return `<span style="color:${rarityDef(r.rarity).color}">${name}</span>`;
}

export interface AffixLine {
  text: string;
  /** A curse reads red, everything else reads in its tier colour. */
  cursed: boolean;
}

/** Human-readable lines for each rolled affix. This is the text the player
 *  actually reads to decide whether a drop is an upgrade, so it says what the
 *  affix DOES, not what it is called internally. */
export function affixLines(id: string): AffixLine[] {
  const r = rolledOf(id);
  if (!r) return [];
  const out: AffixLine[] = [];
  for (const a of r.affixes) {
    const bits: string[] = [];
    if (a.add != null && a.stat) bits.push(`${a.add > 0 ? '+' : ''}${a.add} ${STAT_LABEL[a.stat]}`);
    if (a.mul != null && a.stat) bits.push(`×${a.mul.toFixed(2)} ${STAT_LABEL[a.stat]}`);
    if (a.mod && a.modVal != null) bits.push(modLabel(a.mod, a.modVal));
    if (a.effect) bits.push(EFFECT_LABEL[a.effect] ?? a.effect.replace(/_/g, ' '));
    out.push({ text: `${a.name} — ${bits.join(', ') || '—'}`, cursed: !!a.cursed });
  }
  return out;
}

const STAT_LABEL: Record<string, string> = {
  weaponDmg: 'damage', armor: 'armour', regen: 'regen/s', toolPower: 'tool power',
};

/** Modifiers are stored as multipliers where >1 always means "more of the thing
 *  named" (see data/affixes.ts). That convention is right for the maths and
 *  wrong for a human: "vigorDecay ×0.82" is good news written as a decrease.
 *  So each one is translated into the direction the player experiences. */
function modLabel(mod: string, v: number): string {
  const pct = Math.round(Math.abs(1 - v) * 100);
  switch (mod) {
    case 'moveSpeed':    return `${v >= 1 ? '+' : '−'}${pct}% move speed`;
    case 'swingSpeed':   return `${v >= 1 ? '+' : '−'}${pct}% swing speed`;
    case 'vigorDecay':   return `${v <= 1 ? '−' : '+'}${pct}% hunger`;
    case 'resolveDecay': return `${v <= 1 ? '−' : '+'}${pct}% dread`;
    case 'buildHp':      return `${v >= 1 ? '+' : '−'}${pct}% building health`;
    case 'soulXp':       return `${v >= 1 ? '+' : '−'}${pct}% soul xp`;
    default:             return `${mod} ×${v}`;
  }
}

/** Plain language for the fifteen hooks. The Veil applies (pillar 7): these are
 *  the words a player reads, so they are fantasy, not implementation. */
const EFFECT_LABEL: Record<string, string> = {
  fire_aura: 'burns what stands near you',
  chill_aura: 'chills what stands near you',
  thorns_reflect: 'returns a share of what strikes you',
  regen_boost: 'you mend faster',
  move_burst_on_kill: 'a kill quickens your step',
  see_foe_hp: 'you see the life left in a foe',
  resonance_boost: 'echoes answer you more readily',
  fire_on_hit: 'your strikes kindle',
  chill_on_hit: 'your strikes bite with cold',
  lifesteal: 'you drink from what you fell',
  chain_on_kill: 'a kill leaps to the next',
  dodge: 'you sometimes slip a blow entirely',
  gold_find: 'the land yields more tribute',
  xp_boost: 'you learn faster',
  night_vision: 'the dark presses less',
};

/** The stat column that matters for an equip slot — the one number a player
 *  compares when deciding whether a drop is an upgrade. */
export function primaryStat(id: string): { key: string; label: string; value: number } | null {
  const d = itemDef(id);
  if (!d) return null;
  if (d.toolClass) return { key: 'toolPower', label: 'tool power', value: d.toolPower ?? 0 };
  if (d.trinket === 'charm') return { key: 'regen', label: 'regen/s', value: d.regen ?? 0 };
  if (d.trinket === 'amulet') return { key: 'armor', label: 'armour', value: d.armor ?? 0 };
  if (d.trinket === 'ring') return { key: 'weaponDmg', label: 'damage', value: d.weaponDmg ?? 0 };
  if (d.weaponDmg != null) return { key: 'weaponDmg', label: 'damage', value: d.weaponDmg };
  if (d.armor != null) return { key: 'armor', label: 'armour', value: d.armor };
  if (d.regen != null) return { key: 'regen', label: 'regen/s', value: d.regen };
  return null;
}

export { rarityDef, rarityIndex, affixDef };
