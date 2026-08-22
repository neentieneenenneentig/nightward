// ============================================================================
// N4.5 + A7 — The Covenants.
//
// ONE control, two vocabularies. The Veil calls it a covenant you swear; the
// Lens calls it a data budget you consent to. They are the same row.
//
// ---------------------------------------------------------------------------
// Why these two milestones are one file
// ---------------------------------------------------------------------------
//
// The arsenal plan wanted Hero Siege's Normal → Nightmare → Hell → Inferno
// ladder (A7). The deep-wire plan already had a difficulty axis in it: the
// data-budget opt-in, where the tier you pick is your bandwidth consent (N4.5,
// user-directed in the N4 §8 Q1 answers). A7's own brief says it plainly and
// in bold — **do not build a second difficulty axis; they must be the same
// selector** — because two independent difficulty systems is exactly the thing
// that ships when two plans get written by the same person on different days,
// and it makes both of them unbalanceable.
//
// So: one table. Picking a tier raises the horde AND authorises the bytes, and
// the two cannot drift apart because there is nothing for them to drift from.
//
// ---------------------------------------------------------------------------
// The consent rule that shapes everything below
// ---------------------------------------------------------------------------
//
// A throughput sounding spends the PLAYER'S data. Not the developer's, not a
// server's — theirs, possibly metered, possibly roaming. That makes it the one
// thing in this entire project that cannot be a default.
//
// Hence:
//
//   * `quiet` is the default and it is byte-for-byte today's game. Every
//     multiplier is exactly 1.0, `budgetMB` is 0, and the Sounding Stone
//     refuses to fire. A player who never opens the panel plays the game that
//     shipped, at the difficulty it shipped at, having spent nothing.
//   * The budget is a HARD ceiling for the whole run, not a per-sounding rate.
//     Spend it and the stone goes quiet until the run ends. A budget you can
//     exceed by playing longer is not a budget.
//   * Every tier's cost is stated in megabytes, in the panel, before the
//     player picks — not in a tooltip, not in a doc, not in the Lens.
//
// The payoff for accepting the cost is real and it is the ARPG shape A7 asked
// for: harder enemies, a rarity FLOOR that rises, Riftborn gated to the top
// two tiers, and a Legacy Score multiplier. The data cost stops being a hidden
// tax and becomes a chosen, rewarded difficulty.
// ============================================================================
import { CFG } from './config';
import type { RarityId } from './rarity';

export type CovenantId = 'quiet' | 'listening' | 'deep' | 'drowning' | 'abyssal';

export interface CovenantDef {
  id: CovenantId;
  /** The Veil name. Pillar 7: what you swear, never what it costs. */
  name: string;
  /** The Lens name. The same row, said in instrument. */
  budgetLabel: string;
  /** One line, in fiction, for the panel. */
  blurb: string;
  /** The honest sentence, in bytes, shown beside the fiction. Not a tooltip. */
  cost: string;
  /** Total megabytes this run may spend on soundings. 0 = the stone stays cold
   *  and no throughput request is ever made. */
  budgetMB: number;
  /** How many soundings that budget buys, roughly — stated so the player can
   *  reason about the stone rather than about arithmetic. */
  soundings: number;
  /** x enemy hp and x enemy damage, on top of every existing scaler. */
  hpMul: number;
  dmgMul: number;
  /** The rarity ladder's FLOOR rises with the pact. A1's bands each declare
   *  their own floor; this raises whichever is lower, so it can only ever help
   *  and can never accidentally lower a lord's guaranteed Hallowed. */
  rarityFloor: RarityId;
  /** Can a Riftborn drop at all this run? A7: tier-gated to the top two. The
   *  `rift` band's ceiling is clipped below that. */
  riftborn: boolean;
  /** x on the run's Legacy Score. The reward for the whole bargain. */
  legacyMul: number;
  /** Panel accent. */
  color: string;
}

export const COVENANTS: CovenantDef[] = [
  {
    id: 'quiet', name: 'The Quiet Pact', budgetLabel: 'No soundings',
    blurb: 'you ask the dark nothing, and it asks nothing of you',
    cost: 'spends none of your data',
    budgetMB: 0, soundings: 0,
    hpMul: 1, dmgMul: 1, rarityFloor: 'plain', riftborn: false, legacyMul: 1,
    color: '#8a8a9a',
  },
  {
    id: 'listening', name: 'The Listening Pact', budgetLabel: 'Light budget',
    blurb: 'you listen at the edge of the water — briefly, and not deep',
    cost: 'about 3 MB over a whole run',
    budgetMB: 3, soundings: 4,
    hpMul: 1.15, dmgMul: 1.10, rarityFloor: 'plain', riftborn: false, legacyMul: 1.15,
    color: '#8fb6e8',
  },
  {
    id: 'deep', name: 'The Deep Pact', budgetLabel: 'Standard budget',
    blurb: 'you put your ear to the deep, and the deep leans back',
    cost: 'about 12 MB over a whole run',
    budgetMB: 12, soundings: 8,
    // The first tier that changes the loot FLOOR rather than only the odds:
    // nothing you find is plain any more. That is the moment the bargain
    // starts paying in something you can hold.
    hpMul: 1.35, dmgMul: 1.25, rarityFloor: 'touched', riftborn: true, legacyMul: 1.40,
    color: '#7fd6a0',
  },
  {
    id: 'drowning', name: 'The Drowning Pact', budgetLabel: 'Heavy budget',
    blurb: 'you go under to hear it properly, and something down there is glad',
    cost: 'about 40 MB over a whole run',
    budgetMB: 40, soundings: 14,
    hpMul: 1.60, dmgMul: 1.45, rarityFloor: 'woven', riftborn: true, legacyMul: 1.80,
    color: '#d8c07a',
  },
  {
    id: 'abyssal', name: 'The Abyssal Pact', budgetLabel: 'Unbounded budget',
    blurb: 'there is no bottom, and you have agreed not to look for one',
    cost: 'about 100 MB over a whole run — do not swear this on a metered line',
    budgetMB: 100, soundings: 30,
    hpMul: 1.90, dmgMul: 1.70, rarityFloor: 'woven', riftborn: true, legacyMul: 2.40,
    color: '#f08a6a',
  },
];

export const DEFAULT_COVENANT: CovenantId = 'quiet';

export const covenantDef = (id: string): CovenantDef =>
  COVENANTS.find((c) => c.id === id) ?? COVENANTS[0];

export const covenantIndex = (id: string): number =>
  Math.max(0, COVENANTS.findIndex((c) => c.id === id));

/** The covenant actually in force.
 *
 *  With CFG.n45.enabled off the whole N4.5/A7 selector is reverted, so this is
 *  always `quiet` — the feature's one flag is its one revert, the same
 *  discipline as CFG.a6 / CFG.a8 / CFG.a2. Every consumption site (horde
 *  scaling, the rarity floor, the Riftborn gate) reads through here rather than
 *  through covenantDef(), so a flag flip cannot leave a half-applied pact. */
export function activeCovenant(id: string): CovenantDef {
  return CFG.n45.enabled ? covenantDef(id) : COVENANTS[0];
}

/** Can `to` be sworn while holding `from`?
 *
 *  Raise-only, and that is the whole anti-exploit rule. A pact you can lower is
 *  a pact you swear at the last minute for the multiplier, and a difficulty
 *  selector that can be turned down after the hard part is not a difficulty
 *  selector. It is also just better fiction: nobody un-swears anything.
 *
 *  Raising mid-run IS allowed, and is fairly paid — see `legacyWeight` below. */
export function canSwear(from: string, to: string): boolean {
  return covenantIndex(to) > covenantIndex(from);
}

/** The Legacy multiplier a run actually earned, given how much of it was spent
 *  under each pact.
 *
 *  `nightsAt` maps covenant id → nights survived while holding it. A straight
 *  "whatever you hold at death" rule would let a player clear nine nights under
 *  the Quiet Pact and swear the Abyssal one on the way out for x2.4; a
 *  "lowest ever held" rule would mean raising mid-run is strictly punished and
 *  nobody would ever do it. Weighting by nights is the only version that makes
 *  raising a real decision: the nights you already survived are scored at the
 *  price you actually paid for them, and the ones after the raise at the new
 *  one.
 *
 *  A run that ends before its first dawn has no nights to weight, so it falls
 *  back to the tier currently held — which for the Quiet Pact is 1.0, and for
 *  anything else is a player who swore, spent, and died for it. */
export function legacyWeight(nightsAt: Record<string, number>, current: string): number {
  let nights = 0, sum = 0;
  for (const [id, n] of Object.entries(nightsAt)) {
    if (!(n > 0)) continue;
    nights += n;
    sum += covenantDef(id).legacyMul * n;
  }
  return nights > 0 ? sum / nights : covenantDef(current).legacyMul;
}
