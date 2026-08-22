// A1 — the rarity ladder.
//
// Until now the 67 authored items formed a strictly linear ladder: copper →
// iron → silver → star. Once you know the ladder, every drop is either an
// upgrade or litter, decided at a glance, forever. The point of rarity is that
// **two items of the same base can be wildly different**, so looking at loot
// becomes a decision instead of a lookup.
//
// Two rules here are load-bearing and are not Hero Siege's:
//
// 1. **The ladder has to be climbable inside fifteen minutes.** Pillar 8 caps a
//    run; Diablo-style drop rates inside that window would ship six tiers of
//    which no player ever sees the top four. That is the dormant-row failure
//    the Lens work spent two milestones stamping out, and it would be worse
//    here because the content would be invisible rather than merely dim. The
//    weights below are tuned so a competent run ends holding 2–4 Woven and
//    about one Hallowed — see LOOT_TUNING at the bottom for the arithmetic.
//
// 2. **Riftborn always costs something.** A tier that is strictly better than
//    the one beneath it is a number, not a decision. The Loom's keystones
//    already establish that the best things in this game have a price; the top
//    rarity should be the loudest example of that rule, not the exception.

export type RarityId = 'plain' | 'touched' | 'woven' | 'hallowed' | 'sovereign' | 'riftborn';

export interface RarityDef {
  id: RarityId;
  /** Veil-legal (pillar 7). No network jargon, no borrowed fiction. */
  name: string;
  /** CSS hex. Chosen against Grimdark Chrome (warm near-black iron, brass),
   *  not against another game's palette. */
  color: string;
  /** Inclusive affix count range. */
  affixes: [number, number];
  /** Relative drop weight before the tier floor/ceiling clamp and Fortune. */
  weight: number;
  /** Multiplier on the item's own base stat, on top of any affixes. Keeps a
   *  Hallowed copper blade meaningfully behind a Plain star blade — rarity
   *  should widen the space, not flatten the material progression. */
  statMul: number;
  /** Riftborn: one of its affixes is rolled from the cursed pool. */
  cursed?: boolean;
}

// ---- the 2026-08-22 Riftborn measurement -----------------------------------
//
// A verdict of "trim Riftborn from x2.23 to ~x1.8" was recorded against this
// table. It is NOT applied, because measuring it properly — through a worn
// blade, as the verdict itself demanded — showed the target was already met and
// that the edit would have broken the reason the verdict gave for wanting it.
//
// 60,000 forced rolls per tier on `sword_iron` (base weaponDmg 9). "delivered"
// folds in the swingSpeed mod a curse can carry, which the raw weaponDmg column
// simply does not see:
//
//   tier        raw mean   raw p50   raw p90   raw max | delivered mean
//   plain         1.000     1.000     1.000     1.000  |     1.000
//   touched       1.184     1.060     1.482     1.727  |     1.167
//   woven         1.346     1.288     1.728     2.204  |     1.317
//   hallowed      1.533     1.463     1.924     2.327  |     1.489
//   sovereign     1.763     1.670     2.188     2.497  |     1.701
//   riftborn      1.912     1.844     2.343     2.704  |     1.807
//
// Three things fall out of that table, and each of them is a decision:
//
// 1. **x2.23 was never the typical Riftborn.** It sits at about p85 of the raw
//    distribution. The median is x1.84 and the delivered mean is x1.807 — the
//    requested ~x1.8, already, today. The figure that raised the question was
//    one lucky blade, read off the stat column rather than off the swing.
//
// 2. **The trim would have inverted its own reason.** The verdict wanted
//    Sovereign to stay worth wearing. Riftborn leads it by +8.4% raw / +6.2%
//    delivered — thin already for something at weight 4 that only drops inside
//    a rift. Sweeping statMul: 1.48 cuts the lead to +3.9%, and 1.42 puts
//    Riftborn BELOW Sovereign on delivered damage. There is no statMul that
//    lands the raw mean on 1.8 and leaves a tier gap worth the rarity.
//
// 3. **The long tail is systemic, not Riftborn's.** A lucky Hallowed reaches
//    x2.33 — past the mean Riftborn and past the x2.23 that started this. The
//    tiers are meant to overlap; that is rule 1 of this file, and it is the
//    same principle the `heavy` verdict upheld on the same day ("a lucky blue
//    copper blade out-rolling a plain iron one is the best thing that can
//    happen to an early drop"). Capping it here would contradict that.
//
// The ladder relation is now pinned by testRarityLadder() in systems/regression.ts
// so a future statMul edit cannot quietly collapse it again.

export const RARITIES: RarityDef[] = [
  { id: 'plain',     name: 'Plain',     color: '#b9b2a4', affixes: [0, 0], weight: 620, statMul: 1.00 },
  { id: 'touched',   name: 'Touched',   color: '#6fa8dc', affixes: [1, 1], weight: 300, statMul: 1.06 },
  { id: 'woven',     name: 'Woven',     color: '#e8c34a', affixes: [2, 3], weight: 160, statMul: 1.14 },
  { id: 'hallowed',  name: 'Hallowed',  color: '#b47ae0', affixes: [3, 4], weight:  60, statMul: 1.24 },
  { id: 'sovereign', name: 'Sovereign', color: '#f08a3c', affixes: [4, 5], weight:  18, statMul: 1.38 },
  { id: 'riftborn',  name: 'Riftborn',  color: '#e0413e', affixes: [5, 5], weight:   4, statMul: 1.55, cursed: true },
];

export const RARITY_ORDER: RarityId[] = RARITIES.map((r) => r.id);

export function rarityDef(id: RarityId): RarityDef {
  return RARITIES.find((r) => r.id === id) ?? RARITIES[0];
}

export function rarityIndex(id: RarityId): number {
  const i = RARITY_ORDER.indexOf(id);
  return i < 0 ? 0 : i;
}

/** Where a drop came from decides which rungs it can reach. This is what keeps
 *  "Sovereign — domain lords only" true without a special case at every site:
 *  the source passes a band, the roll clamps to it.
 *
 *  A floor is not a courtesy. An elite that can drop Plain is an elite the
 *  player learns to ignore, which defeats the entire point of marking it. */
export interface LootBand {
  floor?: RarityId;
  ceiling?: RarityId;
}

export const LOOT_BANDS: Record<string, LootBand> = {
  /** Gathering, ordinary horde kills, crafting-adjacent finds. */
  common:  { floor: 'plain',    ceiling: 'hallowed' },
  /** A1 ships this band unused; A2's elites are its first consumer. Marked
   *  here rather than in A2 so the two milestones cannot disagree about it. */
  elite:   { floor: 'touched',  ceiling: 'hallowed' },
  champion:{ floor: 'woven',    ceiling: 'sovereign' },
  /** Domain lords. The only ordinary route to a Sovereign. */
  lord:    { floor: 'hallowed', ceiling: 'sovereign' },
  /** Only inside a rift realm — the sole route to Riftborn. */
  rift:    { floor: 'woven',    ceiling: 'riftborn' },
  /** A8 — a Cairn. Numerically identical to `lord` today, and deliberately a
   *  SEPARATE row: a barrow and a domain lord should be retunable apart, and
   *  aliasing `cairn: LOOT_BANDS.lord` would have made the next balance pass
   *  move both by accident. The brief asked for "guaranteed Hallowed+", which
   *  is exactly the lord band — so a Cairn is priced like a lord kill, and A8
   *  makes it cost like one too: opening a Cairn wakes what was buried under
   *  it (CFG.a8.cairn.wake). Free Hallowed would have inverted the whole
   *  ladder that A1 spent a milestone tuning. */
  cairn:   { floor: 'hallowed', ceiling: 'sovereign' },
  /** A8 — the Hoarder's burst. Below a Cairn on purpose: the Hoarder is a
   *  chase you can lose, so its payout has to survive being missed most of the
   *  time without feeling like the run turned on one lucky sprint. */
  hoard:   { floor: 'woven',    ceiling: 'sovereign' },
  /** A forge produces sound work, not miracles. Crafted gear can still be
   *  Touched, which is the whole reason to keep crafting once loot exists. */
  forge:   { floor: 'plain',    ceiling: 'touched' },
};

/** The arithmetic behind the weights, recorded so a future retune knows what
 *  target it is moving away from. Numbers are for the `common` band, which is
 *  renormalised over plain..hallowed = 620+300+160+60 = 1140:
 *
 *    plain 54.4%   touched 26.3%   woven 14.0%   hallowed 5.3%
 *
 *  A 15-minute run produces roughly 20 gear drops, so:  ~2.8 Woven, ~1.05
 *  Hallowed — which is the §4.2(a) target of "2–4 Woven, about one Hallowed".
 *
 *  The `lord` band renormalises over hallowed+sovereign = 78:
 *
 *    hallowed 77%   sovereign 23%
 *
 *  — the "~25% shot at a Sovereign if a lord dies" target, with five lords in
 *  the world so a good run gets more than one attempt.
 *
 *  If you retune, retune against these two sentences, not against feel alone. */
export const LOOT_TUNING = {
  gearDropsPerRun: 20,
  wovenPerRun: [2, 4] as [number, number],
  hallowedPerRun: 1,
  sovereignPerLord: 0.23,
};
