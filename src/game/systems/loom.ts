// C3: The Loom — per-run passive tree. Points from nights survived.
// Allocate nodes; modifiers are consumed by existing systems as percentage
// multipliers. Keystones warp game rules. No respec — a run IS its weave.
import { CFG } from '../data/config';
import { levelFromXp, playerMaxHp } from '../rules';
import {
  LOOM_NODES, nodeById, computeModifiers,
  DEFAULT_MODIFIERS, type LoomModifiers, type LoomNode,
} from '../data/loom';

export class LoomSystem {
  /** Live modifiers — systems read these every frame. Rebuilt on allocation. */
  mods: LoomModifiers = { ...DEFAULT_MODIFIERS };
  private _rebuildNeeded = true;

  constructor(private ctx: any) {}

  /** Points available to spend (unspent). */
  get points(): number {
    return this.ctx.state.player.loomPoints ?? 0;
  }

  /** Nodes allocated so far (nodeId → rank). */
  get allocated(): Record<string, number> {
    return this.ctx.state.player.loomNodes ?? {};
  }

  /** Called at dawn — award Loom point(s) for surviving the night.
   *  T2 verdict: flat 1 point per night survived. */
  onNightSurvived() {
    const { state } = this.ctx;
    const bonus = 1;
    state.player.loomPoints = (state.player.loomPoints ?? 0) + bonus;
    this.ctx.toast?.(`The Loom strengthens — ${bonus} point${bonus > 1 ? 's' : ''}`, 'good');
    this.ctx.log?.push('loom', `+${bonus} Loom point (night ${state.nightsSurvived})`, state.clock);
  }

  /** L1: a second Loom-point income source — nights-survived alone (1/night)
   *  is too thin for a hard 15-minute run to meaningfully spend across a
   *  40-node/4-keystone tree. Called from worldbosses.hurt()'s death branch,
   *  any killer. */
  onBossSlain() {
    const { state } = this.ctx;
    const bonus = CFG.loom.pointsPerBossKill;
    state.player.loomPoints = (state.player.loomPoints ?? 0) + bonus;
    this.ctx.toast?.(`The Loom drinks deep — +${bonus} points`, 'good');
    this.ctx.log?.push('loom', `+${bonus} Loom points (boss slain)`, state.clock);
  }

  /** Check if the Long Thread keystone grants extra points from total levels. */
  onSkillLevelUp() {
    if (!this.ensureMods().longThread) return;
    const { state } = this.ctx;
    // B2: use rules.levelFromXp — the game's one xp curve. This file used to
    // carry its own copy that multiplied the growth factor unrounded, while
    // rules.xpToNext rounds each level's cost. The two disagreed at 64 xp values
    // in 0..60000 and — because loom's cumulative ran fractionally high — they
    // disagreed at *exactly* the gate totals (286→L5 vs L4, 886→L10 vs L9), so
    // a skill that had just levelled counted as one lower here.
    const totalLevels = Object.values(state.player.xp as Record<string, number>)
      .reduce((sum, xp) => sum + levelFromXp(xp), 0);
    // +1 point per N total levels (retuned B1: old /4 was ~7 pts on the expensive
    // curve; new curve triples levels so /10 keeps it ~7 pts). B3.a: the divisor
    // is a balance number, so it lives in CFG with the rest of them.
    const earned = Math.floor(totalLevels / CFG.loom.longThreadLevelsPerPoint);
    const prev = state.player._longThreadPoints ?? 0;
    if (earned > prev) {
      const diff = earned - prev;
      state.player.loomPoints = (state.player.loomPoints ?? 0) + diff;
      state.player._longThreadPoints = earned;
      this.ctx.log?.push('loom', `+${diff} Loom point (Long Thread: ${totalLevels} total levels)`, state.clock);
    }
  }

  /** Try to allocate (or rank up) a node. Returns false if invalid. */
  allocate(nodeId: string): boolean {
    const node = nodeById(nodeId);
    if (!node) return false;
    const { state } = this.ctx;
    if (this.points <= 0) return false;
    const cur = this.allocated[nodeId] ?? 0;
    if (cur >= node.maxRank) return false;
    // check prerequisites
    if (node.req) {
      for (const reqId of node.req) {
        if ((this.allocated[reqId] ?? 0) <= 0) return false;
      }
    }
    // keystones can only be taken once (maxRank 1 handles this, but be explicit)
    if (node.keystone && cur >= 1) return false;

    state.player.loomNodes = state.player.loomNodes ?? {};
    state.player.loomNodes[nodeId] = cur + 1;
    state.player.loomPoints!--;
    this._rebuildNeeded = true;

    // B3.a: Glass Echo halves max HP, so taking it can leave the player above their
    // new ceiling — a health bar past 100% and a free buffer the keystone was
    // supposed to cost them. Clamp on every allocation rather than special-casing
    // the keystone, so any future max-HP node is covered by construction.
    const cap = playerMaxHp(state);
    if (state.player.hp > cap) state.player.hp = cap;

    const rankStr = node.keystone ? '' : ` rank ${cur + 1}`;
    this.ctx.toast?.(`${node.name}${rankStr} woven into the Loom`, 'good');
    this.ctx.log?.push('loom',
      `Allocated ${node.name}${rankStr} (${state.player.loomPoints} pts left)`,
      state.clock);
    return true;
  }

  /** Check if a node can be allocated right now. */
  canAllocate(nodeId: string): boolean {
    const node = nodeById(nodeId);
    if (!node) return false;
    if (this.points <= 0) return false;
    const cur = this.allocated[nodeId] ?? 0;
    if (cur >= node.maxRank) return false;
    if (node.req) {
      for (const reqId of node.req) {
        if ((this.allocated[reqId] ?? 0) <= 0) return false;
      }
    }
    return true;
  }

  /** Rebuild the modifier map. Called lazily when mods are read. */
  ensureMods(): LoomModifiers {
    if (this._rebuildNeeded) {
      this.mods = computeModifiers(this.allocated);
      this._rebuildNeeded = false;
    }
    return this.mods;
  }

  // ---- The payoff layer -----------------------------------------------------
  //
  // B3.a: before this, three of the four methods below existed and were called by
  // NOTHING in production — `getBuildingHpMul`, `getBossWakeGold` and
  // `getDmgRollTransform` had zero call sites between them outside the regression
  // suite. Six of LoomModifiers' fourteen stat keys had no consumer either, which
  // made 10 of the tree's 36 nodes (38 of 128 ranks) placebo — including nine of
  // the twelve Ward nodes. Deep Roots did nothing whatsoever.
  //
  // Everything the tree advertises now routes through one of these. New callers
  // should use them rather than reading `mods` directly, so a keystone's downside
  // can never again be documented in one file and absent from the game.

  /** Building max HP: buildingHpPct ranks + Deep Roots. Applied at placement. */
  getBuildingHpMul(): number {
    const m = this.ensureMods();
    return (1 + (m.buildingHpPct ?? 0) / 100)
      * (m.deepRoots ? CFG.loom.deepRootsBuildingHpMul : 1);
  }

  /** Tower damage: towerDmgPct ranks. */
  getTowerDmgMul(): number {
    return 1 + (this.ensureMods().towerDmgPct ?? 0) / 100;
  }

  /** Extra tower range in TILES: towerRange ranks + Deep Roots. */
  getTowerRangeAdd(): number {
    const m = this.ensureMods();
    return (m.towerRange ?? 0) + (m.deepRoots ? CFG.loom.deepRootsTowerRangeAdd : 0);
  }

  /** Player move speed: moveSpeedPct ranks, then Deep Roots' penalty.
   *  Multiplicative on purpose — the keystone should cost a real slice of whatever
   *  speed you have built, not be cancelled by two ranks of Swift Feet. */
  getMoveSpeedMul(): number {
    const m = this.ensureMods();
    return (1 + (m.moveSpeedPct ?? 0) / 100)
      * (m.deepRoots ? CFG.loom.deepRootsMoveMul : 1);
  }

  /** Player max HP: Glass Echo halves it. The glass half of the glass cannon. */
  getMaxHpMul(): number {
    return this.ensureMods().glassEcho ? CFG.loom.glassEchoHpMul : 1;
  }

  /** Incoming damage after armour ranks. Diminishing, so stacking armorPct
   *  cannot reach immunity: 50 armorPct = ÷1.5 = 33% less damage taken. */
  getIncomingDmgMul(): number {
    return 1 / (1 + (this.ensureMods().armorPct ?? 0) / 100);
  }

  /** Daylight regen rate: regenPct ranks. */
  getRegenMul(): number {
    return 1 + (this.ensureMods().regenPct ?? 0) / 100;
  }

  /** Crafting ingredient cost: craftCostReduction ranks. Floored at 10% of the
   *  recipe so no amount of investment makes crafting free. */
  getCraftCostMul(): number {
    return Math.max(0.1, 1 - (this.ensureMods().craftCostReduction ?? 0) / 100);
  }

  /** Territory gold rate: territoryIncomePct ranks + Night Market. */
  getGoldMul(): number {
    const m = this.ensureMods();
    return (1 + (m.territoryIncomePct ?? 0) / 100)
      * (m.nightMarket ? CFG.loom.nightMarketGoldMul : 1);
  }

  /** Glass Echo: the D5 damage roll uses only the top half of the band.
   *  combat.ts carried an inline copy of this remap — identical, but a second
   *  copy of one rule is exactly the shape that produced the levelOf drift bug.
   *  It calls this now. */
  getDmgRollTransform(roll: number): number {
    const m = this.ensureMods();
    if (!m.glassEcho) return roll;
    // Roll is already in [0.30, 1.50] (D5). Glass Echo remaps to [0.90, 1.50].
    return 0.90 + (roll - 0.30) * (0.60 / 1.20);
  }

  /** Night Market: gold rouses bosses at half the usual threshold. */
  getBossWakeGold(): number {
    const m = this.ensureMods();
    return m.nightMarket
      ? CFG.worldBoss.wakeGold / CFG.loom.nightMarketWakeDiv
      : CFG.worldBoss.wakeGold;
  }
}
