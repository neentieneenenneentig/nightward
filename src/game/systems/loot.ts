// A1 — the roll.
//
// One function is the whole milestone: `rollItem(baseId, opts)` takes an
// authored item id and returns the id that should actually enter the world.
// For a material, or for a Plain roll, that is the SAME id it was handed —
// which is the decision that keeps the bag working. If every plain flint axe
// became a unique instance, a 15-minute run would end with forty singleton
// stacks of identical icons and stacking would be dead. Plain IS the authored
// item, byte for byte, exactly as it was before this milestone existed.
//
// Only when a roll actually produces something — a rarity above Plain, with at
// least one affix — does the item become a unique `base#n` id backed by a
// merged def (see data/items.ts).
import { CFG } from '../data/config';
import {
  ITEMS, itemDef, registerRolled, rolledOf, type ItemDef, type RolledAffix, type RolledItem,
} from '../data/items';
import {
  CURSES, PREFIXES, SUFFIXES, type AffixDef, type AffixSlot,
} from '../data/affixes';
import {
  LOOT_BANDS, RARITIES, RARITY_ORDER, rarityDef, rarityIndex,
  type LootBand, type RarityId,
} from '../data/rarity';
import { activeCovenant } from '../data/covenants';
import { rollSocketCount } from '../data/weaves';

let uidSeq = 0;

/** Reset the id counter. Paired with resetRolled() in newWorld(). */
export function resetLootSeq() { uidSeq = 0; }

// ------------------------------------------------------------ item class ----

/** Which affix pool an item draws from, or null if it does not roll at all.
 *
 *  Derived from the columns the item already declares rather than a new data
 *  field, so a new weapon added tomorrow rolls correctly with no maintenance —
 *  the same reasoning B5 used for `isGear()`.
 *
 *  Relics deliberately return null. They are hand-authored uniques with fixed
 *  identities and a dedicated slot; rolling affixes onto a boss relic would
 *  make five carefully-designed items into five random ones. */
export function affixSlotOf(def: ItemDef | undefined): AffixSlot | null {
  if (!def) return null;
  if (def.relic) return null;
  if (def.toolClass) return 'tool';
  if (def.trinket) return def.trinket as AffixSlot;
  if (def.weaponDmg != null) return 'weapon';
  if (def.armor != null) return 'armor';
  return null;
}

/** Can this authored id roll at all? Materials, food and potions cannot. */
export function isRollable(id: string): boolean {
  return affixSlotOf(ITEMS[id]) !== null;
}

// --------------------------------------------------------------- rarity ----

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Pick a tier inside a band, with Fortune tilting the ladder.
 *
 *  Fortune multiplies each tier's weight by `fortune^tierIndex`, which is
 *  monotone: at 1.35 a Hallowed is 2.46× more likely and a Plain is unchanged;
 *  at 0.75 a Hallowed is 0.42×. Tilting an exponent rather than adding a bonus
 *  keeps the shape of the ladder intact — a good wire makes the top rungs
 *  reachable, it never makes the bottom rung disappear. */
export function rollRarity(band: LootBand = LOOT_BANDS.common, fortune = 1): RarityId {
  const lo = rarityIndex(band.floor ?? 'plain');
  const hi = rarityIndex(band.ceiling ?? 'hallowed');
  const pool = RARITIES.filter((r) => {
    const i = rarityIndex(r.id);
    return i >= lo && i <= hi;
  });
  if (!pool.length) return 'plain';
  const f = Math.max(0.2, fortune);
  let total = 0;
  const w = pool.map((r) => {
    const v = r.weight * Math.pow(f, rarityIndex(r.id));
    total += v;
    return v;
  });
  let x = Math.random() * total;
  for (let i = 0; i < pool.length; i++) {
    x -= w[i];
    if (x <= 0) return pool[i].id;
  }
  return pool[pool.length - 1].id;
}

/** A frayed wire buries you in junk; a clean one hands you fewer, better things.
 *  This is the compensating half of Fortune — without it a bad connection would
 *  be strictly worse loot, which is a punishment rather than a tradeoff. */
export function lootQuantityMul(fortune = 1): number {
  return Math.max(1, Math.min(1.4, 1 + (1 - fortune) * 0.8));
}

/** The band a roll actually uses, after the covenant has had its say.
 *
 *  Two edits, both one-directional so they can never break a band:
 *
 *    * the covenant's `rarityFloor` RAISES the band's floor — max(), so a
 *      lord's guaranteed Hallowed can never be lowered, only a band whose own
 *      floor sits below the pact's gets lifted up to it;
 *    * when the pact does not carry Riftborn, a band whose ceiling reaches
 *      `riftborn` is clipped to `sovereign`. The rift is still the rift; a
 *      Quiet Pact simply has nothing Riftborn to find in it.
 *
 *  Reads through activeCovenant() so CFG.n45.enabled = false returns the band
 *  untouched — the flag is the revert. */
export function covenantBand(band: LootBand, covenantId?: string): LootBand {
  if (!CFG.n45.enabled) return band;
  const cov = activeCovenant(covenantId ?? 'quiet');
  const ceiling = rarityIndex(band.ceiling ?? 'hallowed');
  const floor = Math.min(
    Math.max(rarityIndex(band.floor ?? 'plain'), rarityIndex(cov.rarityFloor)),
    ceiling,
  );
  const ceil = (!cov.riftborn && rarityIndex('riftborn') <= ceiling)
    ? Math.max(floor, Math.min(ceiling, rarityIndex('sovereign')))
    : ceiling;
  return { floor: RARITY_ORDER[floor], ceiling: RARITY_ORDER[ceil] };
}

// --------------------------------------------------------------- affixes ----

function pickWeighted<T extends { weight: number }>(pool: T[]): T | null {
  if (!pool.length) return null;
  let total = 0;
  for (const p of pool) total += p.weight;
  let x = Math.random() * total;
  for (const p of pool) { x -= p.weight; if (x <= 0) return p; }
  return pool[pool.length - 1];
}

const between = ([lo, hi]: [number, number]) => lo + Math.random() * (hi - lo);

/** Eligible affixes for one item. Two filters matter beyond the obvious slot
 *  check:
 *
 *  - `minTier` keeps the loudest effects (an aura that ignites the world) off
 *    the bottom of the ladder, so tier means something before you read stats.
 *  - a `mul`-only affix needs the column to be non-zero, because 22% of nothing
 *    is nothing. That would be an affix that rolled, displayed, and did
 *    NOTHING — the exact failure this project keeps finding in its own tests. */
function eligible(pool: AffixDef[], slot: AffixSlot, rarity: RarityId, base: ItemDef): AffixDef[] {
  const tier = rarityIndex(rarity);
  return pool.filter((a) => {
    if (!a.on.includes(slot)) return false;
    if (a.minTier && tier < rarityIndex(a.minTier)) return false;
    if (a.mul && !a.add && a.stat && !(base[a.stat] ?? 0)) return false;
    return true;
  });
}

function resolve(a: AffixDef): RolledAffix {
  const r: RolledAffix = { id: a.id, name: a.name, kind: a.kind };
  if (a.stat) r.stat = a.stat;
  if (a.add) r.add = Math.round(between(a.add) * 10) / 10;
  if (a.mul) r.mul = Math.round(between(a.mul) * 100) / 100;
  if (a.mod && a.modRange) { r.mod = a.mod; r.modVal = Math.round(between(a.modRange) * 100) / 100; }
  if (a.effect) r.effect = a.effect;
  if (a.cursed) r.cursed = true;
  return r;
}

// ------------------------------------------------------------- the merge ----

/** Fold the rarity multiplier and every affix into a plain ItemDef.
 *
 *  This is what lets the other ~33 stat readers stay untouched: they ask
 *  `itemDef(id)` for a def and get one, with the affixes already inside it.
 *  Nothing downstream of here knows rarity exists. */
function mergeDef(base: ItemDef, rarity: RarityId, affixes: RolledAffix[], uid: string, name: string): ItemDef {
  const d: ItemDef = { ...base, id: uid, name };
  const mul = rarityDef(rarity).statMul;
  const cols = ['weaponDmg', 'armor', 'regen', 'toolPower'] as const;

  // Rarity first: it scales what the item already was.
  for (const c of cols) if (d[c] != null) (d as any)[c] = (d[c] as number) * mul;

  // Then affixes: additions before multipliers, so "+4 armor, ×1.15" is 15%
  // better than a +4 rather than 15% of the base plus 4. Stated because the
  // other order is defensible and the difference is invisible without a test.
  for (const a of affixes) {
    if (a.stat && a.add != null) (d as any)[a.stat] = ((d[a.stat] as number) ?? 0) + a.add;
  }
  for (const a of affixes) {
    if (a.stat && a.mul != null) (d as any)[a.stat] = (((d[a.stat] as number) ?? 0)) * a.mul;
  }
  for (const c of cols) {
    if (d[c] != null) (d as any)[c] = Math.round((d[c] as number) * 100) / 100;
  }
  // Armor can be driven negative by a curse. Zero is the floor: negative armor
  // would read as "this item heals the enemy", which no tooltip could explain.
  if (d.armor != null && d.armor < 0) d.armor = 0;

  const fx = new Set<string>(base.effects ?? []);
  for (const a of affixes) if (a.effect) fx.add(a.effect);
  if (fx.size) d.effects = [...fx];

  return d;
}

function nameFor(base: ItemDef, affixes: RolledAffix[]): string {
  const p = affixes.find((a) => a.kind === 'prefix' && !a.cursed);
  const s = affixes.find((a) => a.kind === 'suffix');
  return [p?.name, base.name, s?.name].filter(Boolean).join(' ');
}

// ----------------------------------------------------------------- roll ----

export interface RollOpts {
  /** A LOOT_BANDS key, or a band literal. Decides which rungs are reachable. */
  band?: LootBand | keyof typeof LOOT_BANDS;
  /** The Fortune multiplier — see rollRarity(). */
  fortune?: number;
  /** World clock, stored on the roll for the run trophy. */
  clock?: number;
  /** N4.5/A7: the covenant the roll honours — its rarity floor and Riftborn
   *  gate. Omit it (crafting) and the raw band is used unchanged. */
  covenant?: string;
  /** Test seam: skip the weighted draw and roll exactly this tier. */
  forceRarity?: RarityId;
}

/** Roll one authored item into the id that should enter the world.
 *
 *  Returns the SAME id for materials and for Plain results — see the file
 *  header. Returns a new `base#n` uid otherwise. */
export function rollItem(baseId: string, opts: RollOpts = {}): string {
  if (!CFG.loot.enabled) return baseId;
  const base = ITEMS[baseId];
  const slot = affixSlotOf(base);
  if (!base || !slot) return baseId;

  const band = typeof opts.band === 'string' ? LOOT_BANDS[opts.band] : opts.band;
  const rarity = opts.forceRarity ?? rollRarity(covenantBand(band ?? LOOT_BANDS.common, opts.covenant), opts.fortune ?? 1);
  const rd = rarityDef(rarity);

  const [lo, hi] = rd.affixes;
  let count = lo + Math.floor(Math.random() * (hi - lo + 1));
  if (rarity === 'plain' || count <= 0) return baseId;

  const chosen: RolledAffix[] = [];
  const used = new Set<string>();

  // A cursed tier spends one of its slots on the price rather than adding a
  // sixth line. Riftborn is the best thing in the game; it is not free.
  if (rd.cursed) {
    const curse = pickWeighted(eligible(CURSES, slot, rarity, base));
    if (curse) { chosen.push(resolve(curse)); used.add(curse.id); count--; }
  }

  const pool = [...eligible(PREFIXES, slot, rarity, base), ...eligible(SUFFIXES, slot, rarity, base)];
  for (let i = 0; i < count; i++) {
    const avail = pool.filter((a) => !used.has(a.id));
    const pick = pickWeighted(avail);
    if (!pick) break;
    used.add(pick.id);
    chosen.push(resolve(pick));
  }
  if (!chosen.length) return baseId;

  const uid = `${baseId}#${(uidSeq++).toString(36)}`;
  const name = nameFor(base, chosen);
  const rolled: RolledItem = {
    uid, base: baseId, rarity, name, affixes: chosen,
    // A5: sockets roll with the item. Plain never reaches this line (it returns
    // the authored id above), so a Plain item's zero sockets need no special case.
    sockets: rollSocketCount(rarity),
    bornT: opts.clock ?? 0,
  };
  registerRolled(rolled, mergeDef(base, rarity, chosen, uid, name));
  return uid;
}

// ------------------------------------------------------------- the rework ----

export interface ReforgeResult {
  ok: boolean;
  /** Why it was refused — for the caller's message, never shown raw. */
  why?: 'not-rolled' | 'no-affix' | 'no-slot' | 'no-pool';
  before?: RolledAffix;
  after?: RolledAffix;
}

/** A6 — replace exactly ONE affix on a rolled item, in place.
 *
 *  This lives here rather than in systems/hub.ts because everything it needs —
 *  `eligible`, `resolve`, `mergeDef`, `nameFor` — is how an item is ASSEMBLED,
 *  and there should go on being exactly one file that knows that. A rework is
 *  a partial re-roll, not a new mechanism.
 *
 *  Three rules, each of which is a decision:
 *
 *  1. **The uid does not change.** `state.sockets`, `state.player.equip`, the
 *     soul bindings and every ground drop are keyed by it, and re-registering
 *     under the same uid means a worn item's stats update on the next read with
 *     nothing to notify. Threads stay socketed in their order; a weave survives
 *     a rework, which is right — you reworked the metal, not the weaving.
 *
 *  2. **A cursed slot rerolls from the CURSES pool.** Riftborn's curse is the
 *     price of the best tier in the game (data/rarity.ts, rule 2). Letting gold
 *     replace it with a blessing would make the Forge-Warden a laundry for the
 *     one rule that keeps the top of the ladder honest. You may change WHICH
 *     curse you carry. You may not stop carrying one.
 *
 *  3. **The affix being replaced stays in its own pool.** Only the item's OTHER
 *     affixes are excluded, so a rework can land the same affix at a different
 *     value. That is the near-miss repair the whole feature is for: a Keen at
 *     ×1.09 wants another draw at Keen, not a guarantee of something else.
 *
 *  Stats are recomputed from the authored base every time, so a hundred
 *  reworks cannot drift a number the way an in-place edit would. */
export function reforgeAffix(uid: string, index: number): ReforgeResult {
  const roll = rolledOf(uid);
  if (!roll) return { ok: false, why: 'not-rolled' };
  const old = roll.affixes[index];
  if (!old) return { ok: false, why: 'no-affix' };
  const base = ITEMS[roll.base];
  const slot = affixSlotOf(base);
  if (!base || !slot) return { ok: false, why: 'no-slot' };

  const pool = old.cursed
    ? eligible(CURSES, slot, roll.rarity, base)
    : [...eligible(PREFIXES, slot, roll.rarity, base), ...eligible(SUFFIXES, slot, roll.rarity, base)];
  const held = new Set(roll.affixes.filter((_, i) => i !== index).map((a) => a.id));
  const pick = pickWeighted(pool.filter((a) => !held.has(a.id)));
  if (!pick) return { ok: false, why: 'no-pool' };

  const next = resolve(pick);
  const affixes = roll.affixes.map((a, i) => (i === index ? next : a));
  const name = nameFor(base, affixes);
  registerRolled({ ...roll, affixes, name }, mergeDef(base, roll.rarity, affixes, uid, name));
  return { ok: true, before: old, after: next };
}

/** Roll a whole loot result in place. Gear becomes one uid per unit — two
 *  identical swords from one corpse should be two different swords, which is
 *  the entire premise — while materials pass straight through and keep
 *  stacking. */
export function rollStacks(
  stacks: { id: string; n: number }[],
  opts: RollOpts = {},
): { id: string; n: number }[] {
  if (!CFG.loot.enabled) return stacks;
  const out: { id: string; n: number }[] = [];
  for (const st of stacks) {
    if (st.n <= 0) continue;
    if (!isRollable(st.id)) { out.push(st); continue; }
    for (let i = 0; i < st.n; i++) out.push({ id: rollItem(st.id, opts), n: 1 });
  }
  return out;
}

/** The Fortune multiplier from the wire, or a neutral 1 when nothing is live.
 *  Pillar 5: every metric has a neutral fallback, so a filtered network plays a
 *  balanced game rather than an accidentally poor one. */
export function fortuneFrom(net: any): number {
  const v = net?.getGameValue?.('fortune');
  return typeof v === 'number' && isFinite(v) && v > 0 ? v : 1;
}

/** The best thing a run produced, for the scorecard trophy (§4.2b). Reads the
 *  registry rather than the bag on purpose: an item you found, wore and lost to
 *  a death scatter still happened to you. */
export function bestRoll(rolls: RolledItem[]): RolledItem | null {
  let best: RolledItem | null = null;
  for (const r of rolls) {
    if (!best
      || rarityIndex(r.rarity) > rarityIndex(best.rarity)
      || (r.rarity === best.rarity && r.affixes.length > best.affixes.length)) best = r;
  }
  return best;
}

export { RARITY_ORDER, rarityDef, rarityIndex, itemDef };
