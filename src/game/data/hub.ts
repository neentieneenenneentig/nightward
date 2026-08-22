// A6 — the Hall becomes a hub.
//
// Gold has been accumulating since M1 with almost nowhere to go: one Scatter
// Cache button and a death penalty. Every other currency in this game is spent
// — materials build, threads socket, Loom points allocate — and a resource you
// only ever watch rise is a score, not an economy. This milestone gives gold
// two verbs.
//
// This file is the half that a balance pass edits: the tables and the two price
// functions. Everything that moves lives in systems/hub.ts.
//
// **The one number.** A-arsenal §5.6 predicted the retune before the code
// existed: "tribute income is currently tuned against a world where gold does
// nothing. Adding two sinks changes what the `goldRate` mapping and the Night
// Market keystone are worth." Both prices below pass through
// `CFG.a6.priceMul`, so that retune is one config edit rather than a table
// rewrite — and it can wait for the playtest verdict, which is what the plan
// asked for.
import type { RarityId } from './rarity';
import type { ItemDef } from './items';
import type { Stack } from '../types';
import type { AffixSlot } from './affixes';
import { CFG } from './config';

export type HubKind = 'reliquary' | 'forge' | 'sounding';

// ------------------------------------------------------------- the seals ----

export interface SealDef {
  id: string;
  /** Veil-legal (pillar 7). A player buys a seal, never a "loot band". */
  name: string;
  /** LOOT_BANDS key the purchase rolls on. This is the half you DO buy. */
  band: string;
  /** Fraction of the slot's base ladder this seal cannot reach, from the
   *  bottom. 0 = the whole ladder; 0.62 = only the top ~38% of bases.
   *
   *  This column exists because "you buy the slot and the tier weighting,
   *  never the roll" is only fair if the base is bounded. A Hallowed Copper
   *  Blade is 6 damage × 1.24 plus affixes; a Plain Star-Metal Sword is 18.
   *  Selling the top tier without bounding the base means the most expensive
   *  purchase in the game can hand you something worse than a free drop, which
   *  is not a gamble — it is a bug the player cannot distinguish from one. */
  stockFloor: number;
  /** Gold, before CFG.a6.priceMul. See sealPrice(). */
  gold: number;
  /** Shown under the name. Says what you are buying and what you are not. */
  blurb: string;
}

/** Three seals, one per band worth selling.
 *
 *  **No seal reaches `rift`.** data/rarity.ts states that the rift band is
 *  "only inside a rift realm — the sole route to Riftborn", and a shop that
 *  sells the top rarity would quietly retire that sentence. The Reliquary
 *  stops one rung below the best thing in the game, on purpose: gold buys you
 *  odds, and the rift still has to be walked into. `testReliquary` asserts it
 *  over a thousand draws rather than trusting the table. */
export const SEALS: SealDef[] = [
  {
    id: 'lesser', name: 'Lesser Seal', band: 'elite', stockFloor: 0, gold: 240,
    blurb: 'Touched or better, drawn from the whole stock. The cheap gamble.',
  },
  {
    id: 'warded', name: 'Warded Seal', band: 'champion', stockFloor: 0.34, gold: 620,
    blurb: 'Woven or better, and never the poorest metals.',
  },
  {
    id: 'lords', name: "Lord's Seal", band: 'lord', stockFloor: 0.62, gold: 1400,
    blurb: 'Hallowed or better, finest stock only. What a domain lord would have carried.',
  },
];

export const sealById = (id: string) => SEALS.find((s) => s.id === id);

/** The six shapes a sealed relic can take. Ordered as the equip panel is, so
 *  the two screens read the same way round. */
export const HUB_SLOTS: { slot: AffixSlot; label: string; glyph: string }[] = [
  { slot: 'weapon', label: 'Blade', glyph: '⚔' },
  { slot: 'armor', label: 'Armour', glyph: '🛡' },
  { slot: 'ring', label: 'Ring', glyph: '💍' },
  { slot: 'amulet', label: 'Amulet', glyph: '📿' },
  { slot: 'charm', label: 'Charm', glyph: '🍀' },
  { slot: 'tool', label: 'Tool', glyph: '⛏' },
];

/** How good a base item is *within its own slot*, for ranking the stock.
 *
 *  Two columns, no new data field — the same reasoning `affixSlotOf()` used:
 *  a weapon added tomorrow ranks correctly with no maintenance.
 *
 *  The effect term is the load-bearing part. A Void Blade is 8 damage and a
 *  Copper Blade is 6, but the Void Blade steals life and the Copper Blade is
 *  the item you start the run holding. Ranking on the stat column alone would
 *  put every elemental sidegrade at the bottom of the ladder and lock all four
 *  of them out of the seal that ought to sell them. Effects are worth 2.5
 *  because that is roughly what one of them is worth against the weapon
 *  ladder's own spacing (copper 6 → iron 9 → silver 13 → star 18). */
export function baseWorth(d: ItemDef): number {
  const stat = d.toolPower ?? d.weaponDmg ?? d.armor ?? d.regen ?? 0;
  return stat + 2.5 * (d.effects?.length ?? 0);
}

/** A seal's price in gold, with the retune multiplier applied. */
export function sealPrice(seal: SealDef): number {
  return Math.round(seal.gold * CFG.a6.priceMul);
}

// ------------------------------------------------------- the forge-warden ----

/** Materials the Forge-Warden burns per rework, by the item's tier.
 *
 *  These deliberately do NOT escalate with repeat reworks the way gold does.
 *  Star-Metal is the scarcest thing in a fifteen-minute run; doubling it on
 *  every rework would make the second attempt on a Sovereign unpayable in
 *  practice, which is a refusal wearing a price tag. Gold escalates because
 *  gold is the resource this milestone exists to drain. */
const REFORGE_MATS: Partial<Record<RarityId, Stack[]>> = {
  touched: [{ id: 'iron_bar', n: 1 }],
  woven: [{ id: 'iron_bar', n: 2 }],
  hallowed: [{ id: 'silver_bar', n: 2 }],
  sovereign: [{ id: 'silver_bar', n: 2 }, { id: 'star_bar', n: 1 }],
  riftborn: [{ id: 'star_bar', n: 2 }],
};

/** Gold per rarity rung, before escalation and before priceMul. Index into
 *  RARITY_ORDER: plain 0 (unreachable — a Plain item has no affixes to rework),
 *  touched 1 … riftborn 5. */
export const REFORGE_GOLD_PER_TIER = 140;

/** What the Forge-Warden charges to rework one affix on one item.
 *
 *  `prior` is how many times THIS item has already been reworked, and the
 *  escalation is the argument this milestone has with its own brief. §5.6 says
 *  one affix at a time makes the Forge-Warden "a repair for a near-miss rather
 *  than a slot machine that deletes the drop loop" — but rerolling one affix
 *  over and over is still a slot machine, just a narrower one. A flat price
 *  would mean the correct play on any Hallowed drop is to feed it gold until
 *  every line is perfect. The price rising per rework is what actually makes it
 *  a repair: the first is cheap, the fourth is a decision, the seventh is a
 *  fantasy. */
export function reforgePrice(rarity: RarityId, tierIndex: number, prior: number): { gold: number; mats: Stack[] } {
  const base = REFORGE_GOLD_PER_TIER * Math.max(1, tierIndex);
  const escalated = base * Math.pow(CFG.a6.reforgeEscalation, Math.max(0, prior));
  return {
    gold: Math.round(escalated * CFG.a6.priceMul),
    mats: REFORGE_MATS[rarity] ?? REFORGE_MATS.touched!,
  };
}
