// ============================================================================
// A2 — Elites & Champions.
//
// Everything the horde does today is decided by the *type* on the row: a Brute
// is a Brute is a Brute, and once you have fought one on night 3 you have
// fought every one you will ever meet. The bestiary answered that with more
// rows — 25 of them — but a bestiary is a lookup table, and the twentieth new
// row teaches less than the first did. What is missing is variance *within* a
// type, so that the thing walking at you is a question rather than a label.
//
// So: affixes rolled per SPAWN, not per type. The same Brute can arrive
// Vigorous (a wall you should walk around) or Swift and Venomous (a thing you
// must not let touch you), and those are different fights out of one row. This
// is the enemy-side mirror of what A1 did to loot, and it is the same argument:
// a ladder you can read at a glance stops being a decision.
//
// ---------------------------------------------------------------------------
// The three rules that keep this from ruining the game
// ---------------------------------------------------------------------------
//
// 1. **The conflict table.** The A2 plan flagged its own failure mode before a
//    line was written: Vigorous + Warded + Leeching on a night-8 charger is an
//    unkillable wall inside a fifteen-minute clock (pillar 8). Every affix
//    therefore declares a `group`, and at most one affix per group lands on a
//    foe. `bulk` holds the two survivability affixes, so a foe is either hard
//    to chew through or hard to hurt, never both.
//
// 2. **A power budget, not an affix count.** Champions get three affixes, but
//    "three affixes" is not a difficulty — three cheap ones are a nuisance and
//    three expensive ones are a boss. Each affix carries a `cost`, and the roll
//    stops when the night's budget runs out. Night 1 can afford one cheap
//    affix; night 12 can afford a real champion. This is what makes night 7
//    read as a siege rather than as a longer night 1.
//
// 3. **Every affix is visible before it matters.** An aura ring in the affix's
//    own colour, a nameplate that spells the epithets out, and a Chronicle line
//    at spawn. A rolled property you only discover by dying to it is a bad roll
//    of the dice wearing a mechanic's coat.
//
// ---------------------------------------------------------------------------
// Pillar 1 (no assets) is intact: the nameplate is text, the ring is Graphics,
// and the colours are hex on the rows below.
// ---------------------------------------------------------------------------

/** Elite ranks. Two, not five: the point is a readable spike in the wave, and
 *  a ladder of five tiers of nameplate is a lookup table again. */
export type EliteRank = 'elite' | 'champion';

export interface EnemyAffixDef {
  id: string;
  /** The epithet. Goes on the nameplate verbatim, so it has to read as a word a
   *  herald would shout, not as a stat name. */
  name: string;
  /** Veil-legal (pillar 7). What the player sees happen, never the mechanism. */
  blurb: string;
  /** At most one affix per group lands on a foe. The whole balance guard. */
  group: string;
  /** Power cost against the night's budget. See eliteBudget(). */
  cost: number;
  /** Aura-ring tint and nameplate accent. CSS hex; parsed once at art time. */
  color: string;
  /** Relative roll weight inside the affordable pool. */
  weight: number;
  /** Never rolls before this night. Keeps the loudest affixes off night 1,
   *  where the player has no counterplay to them yet. */
  fromNight?: number;
}

/** The nine. Ordered loud-to-quiet, which is also roughly expensive-to-cheap.
 *
 *  Every one of them reuses machinery that already exists and is already
 *  tested — a fire aura, the poison DoT, the siege multiplier, the chill/slow
 *  product in the march step. Nine brand-new subsystems on one milestone is how
 *  a milestone ships nine half-working things; nine new *consumers* of proven
 *  code is how it ships nine working ones. */
export const ENEMY_AFFIXES: EnemyAffixDef[] = [
  {
    id: 'vigorous', name: 'Vigorous',
    blurb: 'it does not tire, and it does not fall',
    group: 'bulk', cost: 3, color: '#9fd05a', weight: 22,
  },
  {
    id: 'warded', name: 'Warded',
    blurb: 'blows land on it and slide off',
    // Same group as Vigorous ON PURPOSE — see rule 1 above. A foe that both
    // has 2.2x the pool and eats 3 off every hit is not hard, it is tedious,
    // and tedium inside a 15-minute clock is a stolen run.
    group: 'bulk', cost: 3, color: '#8aa7c8', weight: 20,
  },
  {
    id: 'swift', name: 'Swift',
    blurb: 'it covers ground faster than anything its size should',
    group: 'pace', cost: 3, color: '#e6c86e', weight: 20,
  },
  {
    id: 'kindled', name: 'Kindled',
    blurb: 'the air around it burns',
    group: 'touch', cost: 3, color: '#e8844a', weight: 16, fromNight: 3,
  },
  {
    id: 'venomous', name: 'Venomous',
    blurb: 'what it opens does not close',
    group: 'touch', cost: 3, color: '#8fd05a', weight: 16, fromNight: 3,
  },
  {
    id: 'leeching', name: 'Leeching',
    blurb: 'it drinks what it takes from you',
    // Not in `bulk`, because it is not survivability until it connects — a
    // Leeching foe you never let touch you has no affix at all. That makes it
    // the one affix whose counterplay is entirely in the player's hands.
    group: 'touch', cost: 4, color: '#c85a7a', weight: 12, fromNight: 5,
  },
  {
    id: 'splitting', name: 'Splitting',
    blurb: 'kill it and it is two smaller problems',
    group: 'death', cost: 4, color: '#c9a0dc', weight: 12, fromNight: 4,
  },
  {
    id: 'anchored', name: 'Anchored',
    blurb: 'it came for the walls, not for you',
    group: 'siege', cost: 2, color: '#9a8a6a', weight: 14,
  },
  {
    id: 'unseen', name: 'Unseen',
    blurb: 'at a distance it is barely there',
    group: 'veil', cost: 2, color: '#6a6a8a', weight: 14, fromNight: 2,
  },
];

export const affixDef = (id: string) => ENEMY_AFFIXES.find((a) => a.id === id);

/** Numbers each affix spends. Kept OUT of the rows above because these are the
 *  balance knobs and the rows are the vocabulary — a retune should touch one
 *  block, and a new affix should not have to invent a column. */
export const AFFIX_POWER = {
  /** Vigorous: x hp, applied at spawn to hp AND maxHp so the bar reads true. */
  vigorousHpMul: 2.2,
  /** Warded: flat damage eaten per hit. Unlike the N2a `Shelled` soak this does
   *  NOT deplete — it is a property of the foe, not a shield with a hit count —
   *  so the counterplay is hitting harder rather than hitting more. */
  wardedSoak: 3,
  /** Swift: x speed, into the same march-step product as chill and tar, so a
   *  slow still lands on a Swift foe exactly as it lands on a plain one. */
  swiftSpeedMul: 1.35,
  /** Kindled: the ring that burns. Radius in tiles, damage per tick, seconds
   *  between ticks. Deliberately a smaller radius and a slower tick than the
   *  player's own fire_aura — it is a reason to stop hugging, not a reason to
   *  never approach. */
  kindledTiles: 1.9,
  kindledDmg: 4,
  kindledSec: 1.0,
  /** Venomous: damage per second per stack, seconds per application, and the
   *  stack ceiling. Stacks so that being hit four times is categorically worse
   *  than being hit once — the affix is a warning about attrition, and attrition
   *  that does not compound is just a smaller number. */
  venomDps: 1.6,
  venomSec: 4,
  venomMaxStacks: 5,
  /** Leeching: share of damage dealt returned as healing, capped at maxHp. */
  leechPct: 0.30,
  /** Splitting: how many lesser copies, and at what share of the parent's pool
   *  and damage. The copies are NEVER elite themselves and are flagged so they
   *  cannot split again — one generation, or a night-12 champion pack becomes a
   *  geometric series and takes the frame budget with it. */
  splitCount: 2,
  splitHpMul: 0.35,
  splitDmgMul: 0.6,
  /** Anchored: x damage to structures. Multiplies INTO `structureDmgMul`, the
   *  siege behaviour's own column, so an Anchored Craggin Bulwark compounds
   *  with its authored siege value rather than replacing it. */
  anchoredStructureMul: 3,
  /** Unseen: alpha beyond `unseenTiles`. Never zero — a foe you genuinely
   *  cannot see is not stealth, it is an unfair hit, and the aura ring stays at
   *  full alpha underneath so the thing is always locatable if you look. */
  unseenAlpha: 0.45,
  unseenTiles: 6,
};

/** Rank properties. `affixes` is the TARGET count; the budget can cut it short,
 *  which is deliberate — an early-night champion is a champion that could not
 *  afford to be a very good one. */
export const ELITE_RANKS: Record<EliteRank, {
  name: string;
  /** Nameplate colour. Brass and violet, per the A2 plan. */
  color: string;
  affixes: number;
  /** LOOT_BANDS key the corpse rolls on. Both bands were authored in A1 and
   *  have been dormant since; this is their first consumer. */
  band: string;
  /** x xp and x gold. A harder fight has to pay, or the correct play is to walk
   *  around every elite in the game — which would make the whole milestone an
   *  avoidance minigame. */
  xpMul: number;
  goldMul: number;
  /** Champions arrive with a retinue: minions of the same type sharing ONE of
   *  the champion's affixes. A lone champion is a duel; a champion pack is a
   *  positioning problem, and positioning is what this game's combat is for. */
  minions: number;
  /** Chance the corpse also drops a thread (A5 weaving stock). The ROADMAP has
   *  carried "threads drop from elites" since A5 shipped with domain lords as
   *  the interim source; this is the ticket that owed it. */
  threadChance: number;
}> = {
  elite: {
    name: 'Elite', color: '#d8a83a', affixes: 1, band: 'elite',
    xpMul: 2.2, goldMul: 2.0, minions: 0, threadChance: 0.22,
  },
  champion: {
    name: 'Champion', color: '#b56ce0', affixes: 3, band: 'champion',
    xpMul: 4.5, goldMul: 3.5, minions: 3, threadChance: 0.6,
  },
};

/** The per-night power ceiling — rule 2.
 *
 *  Night 1 affords 3 (one cheap-to-mid affix). It climbs 1.1 per night and caps
 *  at 11, which is three affixes plus change: a night-8+ champion can roll the
 *  full three, and nothing before night 4 can. The cap exists so that night 30
 *  is not a different game from night 12 — pillar 8 means nobody is playing
 *  night 30, and a curve with no ceiling is a promise to a player who will
 *  never arrive. */
export function eliteBudget(night: number): number {
  return Math.min(11, 3 + Math.max(0, night - 1) * 1.1);
}

/** Chance a given night-wave spawn is an elite / a champion.
 *
 *  Both climb with the night and both cap, for the reason above. The champion
 *  curve starts later and stays under the elite curve by construction, so a
 *  wave can never be more champions than elites — the shape of a horde is a
 *  broad base with a few spikes in it, and inverting that would read as a
 *  difficulty bug rather than as a hard night. */
export function eliteChance(night: number): number {
  return Math.min(0.30, 0.05 + Math.max(0, night - 1) * 0.030);
}
export function championChance(night: number): number {
  if (night < 4) return 0;
  return Math.min(0.10, 0.012 + (night - 4) * 0.012);
}

/** Roll a legal affix set: conflict-free, affordable, unlocked for the night.
 *
 *  Pure and injectable — `rnd` is a parameter so the Gauntlet can pin a roll
 *  without stubbing Math.random globally, which is the trick that made A1's
 *  rarity histogram testable at all. */
export function rollAffixes(rank: EliteRank, night: number, rnd: () => number = Math.random): string[] {
  const want = ELITE_RANKS[rank].affixes;
  let budget = eliteBudget(night);
  const taken: string[] = [];
  const usedGroups = new Set<string>();

  for (let i = 0; i < want; i++) {
    const pool = ENEMY_AFFIXES.filter((a) =>
      !usedGroups.has(a.group) && a.cost <= budget && night >= (a.fromNight ?? 1));
    if (!pool.length) break;
    let total = 0;
    for (const a of pool) total += a.weight;
    let x = rnd() * total;
    let pick = pool[pool.length - 1];
    for (const a of pool) { x -= a.weight; if (x <= 0) { pick = a; break; } }
    taken.push(pick.id);
    usedGroups.add(pick.group);
    budget -= pick.cost;
  }
  return taken;
}

/** The nameplate line: "Vigorous Swift Brute". Epithets in roll order, because
 *  the roll order is the order the budget spent itself and the first affix is
 *  therefore the one that most defines the fight. */
export function eliteName(baseName: string, affixes: string[]): string {
  const words = affixes.map((id) => affixDef(id)?.name).filter(Boolean);
  return [...words, baseName].join(' ');
}

/** The guaranteed drop's base item.
 *
 *  A band decides which RUNGS of the rarity ladder are reachable; it cannot
 *  conjure an item out of a loot table that rolled nothing. "Guaranteed Touched+
 *  drop" therefore needs a base to hang the tier on, and this is it.
 *
 *  The materials ladder is gated by night rather than by rank, so a night-3
 *  champion pays out a very good COPPER blade rather than star-metal. Rank
 *  moves the rarity (via the band); the night moves the material. Letting rank
 *  move both would mean one lucky early champion hands the player endgame
 *  materials on night 3 and flattens the next ten minutes of the run. */
export const ELITE_GEAR: { id: string; fromNight: number; weight: number }[] = [
  { id: 'sword_copper', fromNight: 1, weight: 10 },
  { id: 'armor_copper', fromNight: 1, weight: 10 },
  { id: 'ring_copper', fromNight: 1, weight: 8 },
  { id: 'amulet_stone', fromNight: 1, weight: 8 },
  { id: 'charm_ember', fromNight: 1, weight: 6 },
  { id: 'sword_iron', fromNight: 4, weight: 12 },
  { id: 'armor_iron', fromNight: 4, weight: 12 },
  { id: 'ring_iron', fromNight: 4, weight: 9 },
  { id: 'amulet_iron', fromNight: 4, weight: 9 },
  { id: 'charm_moon', fromNight: 4, weight: 7 },
  { id: 'sword_silver', fromNight: 8, weight: 12 },
  { id: 'armor_silver', fromNight: 8, weight: 12 },
  { id: 'ring_silver', fromNight: 8, weight: 9 },
  { id: 'amulet_silver', fromNight: 8, weight: 9 },
  { id: 'charm_silver', fromNight: 8, weight: 7 },
  { id: 'sword_star', fromNight: 14, weight: 8 },
  { id: 'armor_star', fromNight: 14, weight: 8 },
  { id: 'ring_star', fromNight: 14, weight: 6 },
  { id: 'amulet_star', fromNight: 14, weight: 6 },
  { id: 'charm_star', fromNight: 14, weight: 5 },
];

/** Pick one base for the guaranteed drop.
 *
 *  Only the TOP THREE unlocked materials stay in the pool. Without that a
 *  night-16 champion still has a real chance of handing over a Copper Ring,
 *  which reads as the game being broken rather than as an unlucky roll — the
 *  rarity roll on top can make a Copper Ring genuinely good, but the player
 *  cannot see that until they pick it up, and the moment that matters is the
 *  one where a champion died. */
export function rollEliteGear(night: number, rnd: () => number = Math.random): string {
  const unlocked = ELITE_GEAR.filter((g) => g.fromNight <= night);
  if (!unlocked.length) return ELITE_GEAR[0].id;
  const tiers = [...new Set(unlocked.map((g) => g.fromNight))].sort((a, b) => b - a).slice(0, 3);
  const pool = unlocked.filter((g) => tiers.includes(g.fromNight));
  let total = 0;
  for (const g of pool) total += g.weight;
  let x = rnd() * total;
  for (const g of pool) { x -= g.weight; if (x <= 0) return g.id; }
  return pool[pool.length - 1].id;
}

/** The threads an elite can shed. Deliberately the five A5 thread ids and
 *  nothing else: a thread is the ONLY consumable that feeds the weave system,
 *  and widening this to "any material" would turn an elite kill into a
 *  gathering node with legs. */
export const ELITE_THREADS = ['thread_rime', 'thread_ember', 'thread_null', 'thread_tide', 'thread_thorn'];
