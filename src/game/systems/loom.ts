// C3: The Loom — per-run passive tree. Points from nights survived.
// Allocate nodes; modifiers are consumed by existing systems as percentage
// multipliers. Keystones warp game rules. No respec — a run IS its weave.
import { CFG } from '../data/config';
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
    const totalLevels = Object.values(state.player.xp as Record<string, number>)
      .reduce((sum, xp) => sum + levelOf(xp), 0);
    // +1 point per 4 total levels
    const earned = Math.floor(totalLevels / 4);
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

  /** Apply Deep Roots keystone effects to building HP. */
  getBuildingHpMul(): number {
    const m = this.ensureMods();
    return m.deepRoots ? 1.5 : 1.0;
  }

  /** Apply Glass Echo: damage roll uses top half of D5 band. */
  getDmgRollTransform(roll: number): number {
    const m = this.ensureMods();
    if (!m.glassEcho) return roll;
    // Roll is already in [0.30, 1.50] (D5). Glass Echo remaps to [0.90, 1.50].
    return 0.90 + (roll - 0.30) * (0.60 / 1.20);
  }

  /** Apply Night Market: gold rouses bosses at half threshold. */
  getBossWakeGold(): number {
    const m = this.ensureMods();
    return m.nightMarket ? CFG.worldBoss.wakeGold / 2 : CFG.worldBoss.wakeGold;
  }
}

// ---- Helpers ----------------------------------------------------------------

function levelOf(xp: number): number {
  let lvl = 1;
  let needed = CFG.xp.base;
  let acc = 0;
  while (acc + needed <= xp && lvl < CFG.xp.maxLevel) {
    acc += needed;
    lvl++;
    needed *= CFG.xp.growth;
  }
  return lvl;
}
