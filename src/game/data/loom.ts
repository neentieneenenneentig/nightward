// C3: The Loom — a per-run passive tree. Points come from nights survived and
// lords slain. Nodes are data rows; effects are consumed by existing systems via
// the LoomSystem's modifier map — same pattern as NET_GAME_MAP.
//
// B3.b resized this from 40 nodes / 132 ranks to 15 / 47, and moved every keystone
// to depth 4. The old shape was built for an unbounded run. A run is now 15 minutes
// — 2.65 day/night cycles — and affords roughly six points, against keystones that
// sat at depths 5, 8, 9 and 9. Only The Long Thread was reachable, and it repaid
// its own cost threefold, so the opening was forced and B3's stated goal ("one
// keystone is a real choice") failed by construction.
//
// At depth 4 all four are affordable and none is free: a good run takes one and
// spends the rest on ranks, a great run can gamble on two. That is the choice the
// tree is supposed to be asking.
//
// Every one of LoomModifiers' 14 stat keys is granted by at least one node here,
// and every one is consumed by a system (B3.a — before that, six were consumed by
// nothing and nine of the twelve old Ward nodes did literally nothing). The
// regression suite pins both halves; see testLoomTreeShape and
// testLoomPayoffLayerIsReal.

export type LoomBranch = 'war' | 'field' | 'ward';

export interface LoomNode {
  id: string;
  name: string;
  branch: LoomBranch;
  /** position hint for layout: column (0-indexed) within branch */
  col: number;
  /** position hint for layout: row within column */
  row: number;
  /** prerequisite node IDs (must be allocated first) */
  req?: string[];
  /** max times this node can be allocated */
  maxRank: number;
  /** effect keys + values applied when allocated (multiplied by rank) */
  effects: Record<string, number>;
  /** keystone: warps a game rule (one-shot, not stackable) */
  keystone?: boolean;
  /** keystone description for the tooltip */
  keystoneDesc?: string;
}

/** Stat modifier keys the loom can touch — systems read these from LoomSystem. */
export interface LoomModifiers {
  meleeDmgPct: number;
  swingSpeedPct: number;
  arcWidthPct: number;
  dmgRollFloor: number;       // additive to D5 floor (0.30 → 0.35, etc.)
  gatherSpeedPct: number;
  doubleYieldChance: number;
  craftCostReduction: number;
  moveSpeedPct: number;
  armorPct: number;
  regenPct: number;
  buildingHpPct: number;
  towerDmgPct: number;
  towerRange: number;         // additive tiles
  territoryIncomePct: number;
  pickupRadiusPct: number;    // SR2: drops.ts magnet radius, multiplicative on CFG.drops.magnetTiles
  // keystone flags
  glassEcho: boolean;         // damage rolls only use TOP half of D5 band; max HP halved
  deepRoots: boolean;         // buildings +50% HP, towers +1 range; move speed −12%
  nightMarket: boolean;       // gold rate +40%; gold rouses bosses at half threshold
  longThread: boolean;        // +1 loom point per 10 total skill levels
}

export const DEFAULT_MODIFIERS: LoomModifiers = {
  meleeDmgPct: 0,
  swingSpeedPct: 0,
  arcWidthPct: 0,
  dmgRollFloor: 0,
  gatherSpeedPct: 0,
  doubleYieldChance: 0,
  craftCostReduction: 0,
  moveSpeedPct: 0,
  armorPct: 0,
  regenPct: 0,
  buildingHpPct: 0,
  towerDmgPct: 0,
  towerRange: 0,
  territoryIncomePct: 0,
  pickupRadiusPct: 0,
  glassEcho: false,
  deepRoots: false,
  nightMarket: false,
  longThread: false,
};

// ---- Node definitions -------------------------------------------------------

export const LOOM_NODES: LoomNode[] = [
  // ===== WAR — melee =====
  { id: 'w1', name: 'Sharpened Edge', branch: 'war', col: 0, row: 0, maxRank: 5,
    effects: { meleeDmgPct: 4 } },
  { id: 'w2', name: 'Whirling Guard', branch: 'war', col: 0, row: 1, maxRank: 4,
    effects: { swingSpeedPct: 3, arcWidthPct: 4 }, req: ['w1'] },
  { id: 'w3', name: 'Executioner', branch: 'war', col: 0, row: 2, maxRank: 3,
    effects: { meleeDmgPct: 4, dmgRollFloor: 0.02 }, req: ['w2'] },

  // ===== FIELD — gathering, crafting, movement =====
  // Forks after the root: one arm ends in Night Market, the other in The Long
  // Thread. Field carries two keystones because the branch has two distinct
  // fantasies (the harvester and the traveller) and because splitting them keeps
  // every keystone at the same depth.
  { id: 'f1', name: 'Harvester', branch: 'field', col: 0, row: 0, maxRank: 5,
    effects: { gatherSpeedPct: 5 } },
  // SR2: pickupRadiusPct rides along here rather than on a new node — a
  // fifteenth-node addition risks the exact tree shape B3.b tuned (M4), and
  // "loot finds its way to you a little easier" is the same fantasy Lucky
  // Find already sells.
  { id: 'f2', name: 'Lucky Find', branch: 'field', col: 0, row: 1, maxRank: 4,
    effects: { doubleYieldChance: 3, gatherSpeedPct: 2, pickupRadiusPct: 8 }, req: ['f1'] },
  { id: 'f3', name: 'Master Crafter', branch: 'field', col: 0, row: 2, maxRank: 3,
    effects: { craftCostReduction: 5 }, req: ['f2'] },
  { id: 'f4', name: 'Swift Feet', branch: 'field', col: 1, row: 1, maxRank: 4,
    effects: { moveSpeedPct: 3 }, req: ['f1'] },
  { id: 'f5', name: 'Wind Walker', branch: 'field', col: 1, row: 2, maxRank: 3,
    effects: { moveSpeedPct: 3, swingSpeedPct: 1 }, req: ['f4'] },

  // ===== WARD — defence, buildings, economy =====
  { id: 'd1', name: 'Fortify', branch: 'ward', col: 0, row: 0, maxRank: 5,
    effects: { buildingHpPct: 5, armorPct: 2 } },
  { id: 'd2', name: 'Siege Engineer', branch: 'ward', col: 0, row: 1, maxRank: 4,
    effects: { towerDmgPct: 5, towerRange: 0.25 }, req: ['d1'] },
  { id: 'd3', name: 'Golden Age', branch: 'ward', col: 0, row: 2, maxRank: 3,
    effects: { territoryIncomePct: 6, regenPct: 3 }, req: ['d2'] },

  // ===== Keystones — one rank, rule-warping, all at depth 4 =====
  {
    id: 'keystone_glass', name: 'Glass Echo', branch: 'war', col: 0, row: 3, maxRank: 1,
    effects: {}, keystone: true,
    keystoneDesc: 'Your damage rolls only use the TOP half of the D5 band. Max HP halved.',
    req: ['w3'],
  },
  {
    id: 'keystone_market', name: 'Night Market', branch: 'field', col: 0, row: 3, maxRank: 1,
    effects: {}, keystone: true,
    keystoneDesc: 'Gold rate +40%. Gold rouses bosses at HALF the threshold.',
    req: ['f3'],
  },
  {
    id: 'keystone_thread', name: 'The Long Thread', branch: 'field', col: 1, row: 3, maxRank: 1,
    effects: {}, keystone: true,
    keystoneDesc: '+1 Loom point per 12 total skill levels.',
    req: ['f5'],
  },
  {
    id: 'keystone_roots', name: 'Deep Roots', branch: 'ward', col: 0, row: 3, maxRank: 1,
    effects: {}, keystone: true,
    keystoneDesc: 'Buildings +50% HP and towers +1 range. You move 12% slower.',
    req: ['d3'],
  },
];

// ---- Helpers ----------------------------------------------------------------

export function nodeById(id: string): LoomNode | undefined {
  return LOOM_NODES.find((n) => n.id === id);
}

export function nodesByBranch(branch: LoomBranch): LoomNode[] {
  return LOOM_NODES.filter((n) => n.branch === branch);
}

/** Compute the full modifier map from allocated nodes. Returns additive
 *  percentage modifiers + keystone flags. */
export function computeModifiers(
  allocated: Record<string, number>,
): LoomModifiers {
  const m = { ...DEFAULT_MODIFIERS };
  for (const [id, rank] of Object.entries(allocated)) {
    if (rank <= 0) continue;
    const node = nodeById(id);
    if (!node) continue;
    if (node.keystone) {
      if (id === 'keystone_glass') m.glassEcho = true;
      if (id === 'keystone_roots') m.deepRoots = true;
      if (id === 'keystone_market') m.nightMarket = true;
      if (id === 'keystone_thread') m.longThread = true;
      continue;
    }
    for (const [key, val] of Object.entries(node.effects)) {
      (m as any)[key] = ((m as any)[key] ?? 0) + val * rank;
    }
  }
  return m;
}
