// C3: The Loom — a per-run passive tree. Points come from nights survived.
// 3 branches (War / Field / Ward) × ~12 nodes each + 4 keystones.
// Nodes are data rows; effects are consumed by existing systems via the
// LoomSystem's modifier map — same pattern as NET_GAME_MAP.

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
  // keystone flags
  glassEcho: boolean;         // damage rolls only use TOP half of D5 band; max HP halved
  deepRoots: boolean;         // buildings +50% HP, towers +1 range; move speed −12%
  nightMarket: boolean;       // gold rate +40%; gold rouses bosses at half threshold
  longThread: boolean;        // skills cap at 80; +1 loom point per 4 total levels instead of 5
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
  glassEcho: false,
  deepRoots: false,
  nightMarket: false,
  longThread: false,
};

// ---- Node definitions -------------------------------------------------------

export const LOOM_NODES: LoomNode[] = [
  // ===== WAR branch — melee combat =====
  { id: 'w1', name: 'Sharpened Edge', branch: 'war', col: 0, row: 0, maxRank: 5,
    effects: { meleeDmgPct: 4 } },
  { id: 'w2', name: 'Quick Hands', branch: 'war', col: 0, row: 1, maxRank: 5,
    effects: { swingSpeedPct: 3 }, req: ['w1'] },
  { id: 'w3', name: 'Wide Arc', branch: 'war', col: 1, row: 0, maxRank: 3,
    effects: { arcWidthPct: 6 }, req: ['w1'] },
  { id: 'w4', name: 'Brutal Strike', branch: 'war', col: 1, row: 1, maxRank: 3,
    effects: { meleeDmgPct: 5, dmgRollFloor: 0.02 }, req: ['w2'] },
  { id: 'w5', name: 'Flurry', branch: 'war', col: 0, row: 2, maxRank: 5,
    effects: { swingSpeedPct: 2, meleeDmgPct: 1 }, req: ['w2'] },
  { id: 'w6', name: 'Heavy Blade', branch: 'war', col: 1, row: 2, maxRank: 3,
    effects: { meleeDmgPct: 8 }, req: ['w4'] },
  { id: 'w7', name: 'Momentum', branch: 'war', col: 2, row: 0, maxRank: 3,
    effects: { swingSpeedPct: 4, moveSpeedPct: 1 }, req: ['w3'] },
  { id: 'w8', name: 'Deep Wound', branch: 'war', col: 2, row: 1, maxRank: 3,
    effects: { meleeDmgPct: 3, dmgRollFloor: 0.03 }, req: ['w4'] },
  { id: 'w9', name: 'War Dance', branch: 'war', col: 0, row: 3, maxRank: 3,
    effects: { moveSpeedPct: 2, swingSpeedPct: 2 }, req: ['w5'] },
  { id: 'w10', name: 'Executioner', branch: 'war', col: 1, row: 3, maxRank: 3,
    effects: { meleeDmgPct: 6, dmgRollFloor: 0.02 }, req: ['w6'] },
  { id: 'w11', name: 'Whirlwind', branch: 'war', col: 2, row: 2, maxRank: 3,
    effects: { arcWidthPct: 8, swingSpeedPct: 2 }, req: ['w7', 'w8'] },
  { id: 'w12', name: "Berserker's Heart", branch: 'war', col: 1, row: 4, maxRank: 1,
    effects: { meleeDmgPct: 12, dmgRollFloor: 0.05 }, req: ['w10'] },

  // ===== FIELD branch — gathering, crafting, movement =====
  { id: 'f1', name: 'Harvester', branch: 'field', col: 0, row: 0, maxRank: 5,
    effects: { gatherSpeedPct: 5 } },
  { id: 'f2', name: 'Lucky Find', branch: 'field', col: 0, row: 1, maxRank: 5,
    effects: { doubleYieldChance: 3 }, req: ['f1'] },
  { id: 'f3', name: 'Swift Feet', branch: 'field', col: 1, row: 0, maxRank: 5,
    effects: { moveSpeedPct: 3 }, req: ['f1'] },
  { id: 'f4', name: 'Efficiency', branch: 'field', col: 1, row: 1, maxRank: 5,
    effects: { craftCostReduction: 4 }, req: ['f2'] },
  { id: 'f5', name: 'Forager', branch: 'field', col: 0, row: 2, maxRank: 5,
    effects: { gatherSpeedPct: 3, doubleYieldChance: 1 }, req: ['f2'] },
  { id: 'f6', name: 'Pathfinder', branch: 'field', col: 1, row: 2, maxRank: 3,
    effects: { moveSpeedPct: 4 }, req: ['f3'] },
  { id: 'f7', name: 'Master Crafter', branch: 'field', col: 2, row: 0, maxRank: 3,
    effects: { craftCostReduction: 5, doubleYieldChance: 1 }, req: ['f4'] },
  { id: 'f8', name: 'Bounty Hunter', branch: 'field', col: 2, row: 1, maxRank: 3,
    effects: { gatherSpeedPct: 4, moveSpeedPct: 1 }, req: ['f5'] },
  { id: 'f9', name: 'Wind Walker', branch: 'field', col: 0, row: 3, maxRank: 3,
    effects: { moveSpeedPct: 3, swingSpeedPct: 1 }, req: ['f6'] },
  { id: 'f10', name: 'Scavenger', branch: 'field', col: 1, row: 3, maxRank: 3,
    effects: { doubleYieldChance: 4, gatherSpeedPct: 2 }, req: ['f7'] },
  { id: 'f11', name: 'Nomad', branch: 'field', col: 2, row: 2, maxRank: 3,
    effects: { moveSpeedPct: 5, gatherSpeedPct: 2 }, req: ['f8', 'f9'] },
  { id: 'f12', name: "Provisioner's Gift", branch: 'field', col: 1, row: 4, maxRank: 1,
    effects: { doubleYieldChance: 8, craftCostReduction: 6 }, req: ['f10'] },

  // ===== WARD branch — defense, buildings, economy =====
  { id: 'd1', name: 'Fortify', branch: 'ward', col: 0, row: 0, maxRank: 5,
    effects: { buildingHpPct: 5 } },
  { id: 'd2', name: 'Iron Resolve', branch: 'ward', col: 0, row: 1, maxRank: 5,
    effects: { armorPct: 4 }, req: ['d1'] },
  { id: 'd3', name: 'Tribute', branch: 'ward', col: 1, row: 0, maxRank: 5,
    effects: { territoryIncomePct: 5 }, req: ['d1'] },
  { id: 'd4', name: 'Hearty', branch: 'ward', col: 1, row: 1, maxRank: 5,
    effects: { regenPct: 5 }, req: ['d2'] },
  { id: 'd5', name: 'Siege Engineer', branch: 'ward', col: 0, row: 2, maxRank: 5,
    effects: { towerDmgPct: 5 }, req: ['d2'] },
  { id: 'd6', name: 'Stone Mason', branch: 'ward', col: 1, row: 2, maxRank: 3,
    effects: { buildingHpPct: 4, towerDmgPct: 2 }, req: ['d3'] },
  { id: 'd7', name: 'Longshot', branch: 'ward', col: 2, row: 0, maxRank: 3,
    effects: { towerRange: 0.5 }, req: ['d5'] },
  { id: 'd8', name: 'Tax Collector', branch: 'ward', col: 2, row: 1, maxRank: 3,
    effects: { territoryIncomePct: 4, regenPct: 1 }, req: ['d6'] },
  { id: 'd9', name: 'Bulwark', branch: 'ward', col: 0, row: 3, maxRank: 3,
    effects: { armorPct: 3, buildingHpPct: 3 }, req: ['d5'] },
  { id: 'd10', name: 'Keep Lord', branch: 'ward', col: 1, row: 3, maxRank: 3,
    effects: { towerDmgPct: 4, towerRange: 0.3 }, req: ['d7'] },
  { id: 'd11', name: 'Golden Age', branch: 'ward', col: 2, row: 2, maxRank: 3,
    effects: { territoryIncomePct: 6, regenPct: 2 }, req: ['d8', 'd9'] },
  { id: 'd12', name: "Warden's Oath", branch: 'ward', col: 1, row: 4, maxRank: 1,
    effects: { buildingHpPct: 10, towerDmgPct: 5 }, req: ['d10'] },

  // ===== Keystones (rule-warping, one-shot) =====
  {
    id: 'keystone_glass', name: 'Glass Echo', branch: 'war', col: 2, row: 3, maxRank: 1,
    effects: {}, keystone: true,
    keystoneDesc: 'Your damage rolls only use the TOP half of the D5 band. Max HP halved.',
    req: ['w11'],
  },
  {
    id: 'keystone_roots', name: 'Deep Roots', branch: 'ward', col: 2, row: 3, maxRank: 1,
    effects: {}, keystone: true,
    keystoneDesc: 'Buildings +50% HP and towers +1 range. You move 12% slower.',
    req: ['d11'],
  },
  {
    id: 'keystone_market', name: 'Night Market', branch: 'field', col: 2, row: 3, maxRank: 1,
    effects: {}, keystone: true,
    keystoneDesc: 'Gold rate +40%. Gold rouses bosses at HALF the threshold.',
    req: ['f11'],
  },
  {
    id: 'keystone_thread', name: 'The Long Thread', branch: 'field', col: 0, row: 4, maxRank: 1,
    effects: {}, keystone: true,
    keystoneDesc: '+1 Loom point per 4 total skill levels. Skills cap at 80.',
    req: ['f9'],
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
