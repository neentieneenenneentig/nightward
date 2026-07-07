// RS-style gathering: stand near a node, interact, wait out the (tool-scaled)
// timer, collect loot + xp. Moving cancels. Depleted nodes respawn on a clock.
import { CFG } from '../data/config';
import { ITEMS } from '../data/items';
import { SKILLS } from '../data/skills';
import type { FeatureDef } from '../data/features';
import { acquireGear, addXp, awardSoulXp, bestTool, invAdd, rollLoot, skillLevel, soulStat } from '../rules';
import type { SoulSlot } from '../data/soulgear';
import { TILE } from '../world/worldgen';
import { Sound } from '../../engine/audio';

// a couple of alternates per skill so gathering doesn't sound identical every hit
const GATHER_SFX: Record<string, string[]> = {
  woodcutting: ['chop', 'chop2'],
  mining: ['mine', 'mine2'],
  foraging: ['forage', 'forage2'],
};
const pickSfx = (names: string[]) => names[(Math.random() * names.length) | 0];

const SKILL_NAME = Object.fromEntries(SKILLS.map((s) => [s.id, s.name]));
export const VERB: Record<string, string> = {
  woodcutting: 'Chop', mining: 'Mine', foraging: 'Gather',
};

export interface GatherTarget { tx: number; ty: number; def: FeatureDef }

const toolSlotFor = (cls: 'axe' | 'pick'): SoulSlot => (cls === 'axe' ? 'tool_axe' : 'tool_pick');

export class GatherSystem {
  target: GatherTarget | null = null;
  active: (GatherTarget & { progress: number; need: number }) | null = null;

  constructor(private ctx: any) {}

  /** Nearest harvestable node within reach — recomputed every sim step. */
  private findTarget() {
    const { state, world } = this.ctx;
    const { x, y } = state.player;
    const ptx = Math.floor(x / TILE), pty = Math.floor(y / TILE);
    const reachPx = CFG.gather.reachTiles * TILE;
    let best: GatherTarget | null = null, bestD = Infinity;
    for (let ty = pty - 2; ty <= pty + 2; ty++) {
      for (let tx = ptx - 2; tx <= ptx + 2; tx++) {
        const def = world.activeFeatureAt(tx, ty);
        if (!def) continue;
        const d = Math.hypot((tx + 0.5) * TILE - x, (ty + 0.5) * TILE - y);
        if (d <= reachPx && d < bestD) {
          best = { tx, ty, def };
          bestD = d;
        }
      }
    }
    this.target = best;
  }

  /** Player pressed interact. */
  tryStart() {
    const t = this.target;
    if (!t || this.active) return;
    const { state, toast } = this.ctx;

    if (skillLevel(state, t.def.skill) < t.def.levelReq) {
      toast(`Requires ${SKILL_NAME[t.def.skill]} ${t.def.levelReq}`, 'bad');
      return;
    }
    let speed = 1;
    if (t.def.toolClass) {
      const tool = bestTool(state, t.def.toolClass);
      if (!tool && CFG.gather.toolsRequired) {
        toast(`You need a${t.def.toolClass === 'axe' ? 'n axe' : ' pick'} for that`, 'bad');
        return;
      }
      // soul-leveled power if the slot's bound yet, else the tool's raw stat
      const power = tool ? soulStat(state, toolSlotFor(t.def.toolClass)) || tool.power : 0;
      speed = 1 + CFG.gather.toolSpeedBonus * power;
    }
    this.active = { ...t, progress: 0, need: t.def.gatherSec / speed };
  }

  update(dt: number, moved: boolean) {
    this.findTarget();
    const a = this.active;
    if (!a) return;
    if (moved || !this.target || this.target.tx !== a.tx || this.target.ty !== a.ty) {
      this.active = null; // walked away — cancel
      return;
    }
    a.progress += dt;
    if (a.progress >= a.need) {
      this.finish(a);
      this.active = null;
    }
  }

  private finish(a: GatherTarget) {
    const { state, world, chunks, toast } = this.ctx;
    const drops = rollLoot(a.def.loot);
    for (const d of drops) { invAdd(state, d.id, d.n); acquireGear(state, d.id); }
    const newLevel = addXp(state, a.def.skill, a.def.xp);

    if (a.def.toolClass) {
      const slot = toolSlotFor(a.def.toolClass);
      const toolLvl = awardSoulXp(state, slot, CFG.soulgear.toolXpPerUse);
      if (toolLvl) {
        toast(`Your ${a.def.toolClass} feels sharper — soul level ${toolLvl}!`, 'good');
        this.ctx.log?.push('level', `Tool (${a.def.toolClass}) reached soul level ${toolLvl}`, state.clock);
      }
    }

    world.deplete(a.tx, a.ty, a.def.respawnSec);
    chunks.rebakeTile(a.tx, a.ty);

    Sound.play(pickSfx(GATHER_SFX[a.def.skill] ?? ['forage']));
    const got = drops.map((d) => `+${d.n} ${ITEMS[d.id].name}`).join('  ');
    toast(`${got}   (+${a.def.xp} ${SKILL_NAME[a.def.skill]} xp)`);
    this.ctx.log?.push('gather', `${got || 'Gathered nothing'} from ${a.def.name}`, state.clock);
    if (newLevel) {
      Sound.play('levelup'); toast(`${SKILL_NAME[a.def.skill]} reached level ${newLevel}!`, 'good');
      this.ctx.log?.push('level', `${SKILL_NAME[a.def.skill]} reached level ${newLevel}`, state.clock);
    }
  }
}
