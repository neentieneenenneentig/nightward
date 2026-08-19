// RS-style gathering: stand near a node, interact, wait out the (tool-scaled)
// timer, collect loot + xp. Moving cancels. Depleted nodes respawn on a clock.
import { CFG } from '../data/config';
import { ITEMS } from '../data/items';
import { SKILLS } from '../data/skills';
import type { FeatureDef } from '../data/features';
import { addXp, awardSoulXp, bestTool, rollLoot, skillLevel, soulStat } from '../rules';
import { BUILDINGS } from '../data/buildings';
import type { SoulSlot } from '../data/soulgear';
import { TILE, type MegaCluster } from '../world/worldgen';
import { Sound } from '../../engine/audio';
import { levelUpFlourish } from './flourish';

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
  active: (GatherTarget & { progress: number; need: number; megaScale: number; mega?: MegaCluster }) | null = null;

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

    // N2b: material effects — some tiles block gathering entirely
    if (this.ctx.matFx?.mods?.noGathering) {
      toast("This ground resists your efforts — nothing can be harvested here.", 'bad');
      return;
    }

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
    // simSpeed is NOT applied here: gather progress already advances at effectiveDt
    // (dt × simSpeed) in the sim loop, the same universal lag-compensation every system
    // gets. Folding simSpeed into `need` too made gather uniquely ~1/simSpeed² sensitive
    // (removed 2026-07-17 — was the N1 line `speed *= getGameValue('simSpeed')`).
    // N2a: gather speed modifier from downlink (0.85 + downlink×0.04, clamp 0.85–1.25)
    const dl = this.ctx.net?.snap?.downlink ?? 10;
    const gatherSpeedMul = Math.max(0.85, Math.min(1.25, 0.85 + dl * 0.04));
    speed *= gatherSpeedMul;

    // C3: Loom gather speed modifier
    const loomMods = this.ctx.loom?.ensureMods?.();
    if (loomMods) speed *= (1 + (loomMods.gatherSpeedPct ?? 0) / 100);

    // M3.5: Action-gated beacon echo — gathers ping resource-region beacons
    this.ctx.net?.probeAction?.('gather');
    // M3.6: Passive bandwidth snapshot — no HTTP request, just reads navigator.connection
    this.ctx.net?.samplePassive?.('gather');

    // Mega-cluster harvest: time grows with the side (a 3×3 tree takes 3× as
    // long), loot rolls with the AREA (9 rolls) — big nodes are jackpots.
    const mega = this.ctx.world.megaClusterAt(t.tx, t.ty);
    const megaScale = mega ? mega.size * mega.size : 1;

    this.active = { ...t, progress: 0, need: t.def.gatherSec * (mega ? mega.size : 1) / speed, megaScale, mega: mega ?? undefined };
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

  private finish(a: GatherTarget & { megaScale: number; mega?: MegaCluster }) {
    const { state, world, chunks, toast } = this.ctx;
    const drops = rollLoot(a.def.loot);

    // mega-cluster — one loot roll per tile of the square
    for (let i = 1; i < a.megaScale; i++) {
      for (const d of rollLoot(a.def.loot)) drops.push(d);
    }

    // C3: Loom double yield chance
    const loomMods = this.ctx.loom?.ensureMods?.();
    const doubleChance = loomMods ? (loomMods.doubleYieldChance ?? 0) / 100 : 0;
    if (doubleChance > 0 && Math.random() < doubleChance) {
      const extra = rollLoot(a.def.loot);
      for (const d of extra) { drops.push(d); }
    }

    // X1: Granary — foraged food yields more while one stands
    if (a.def.skill === 'foraging') {
      const gDef = BUILDINGS.find((b) => b.id === 'granary');
      if (gDef?.granary && state.buildings.some((b: any) => b.type === 'granary')) {
        for (const d of drops) d.n = Math.max(1, Math.round(d.n * gDef.granary.foodYieldMul));
      }
    }
    // X1: 'Battery Scarcity' Lens mapping — a starving vessel gathers thinner
    const yieldMul = this.ctx.net?.getGameValue?.('resourceYield') ?? 1;
    if (yieldMul < 1) {
      for (const d of drops) {
        const scaled = d.n * yieldMul;
        d.n = Math.max(0, Math.floor(scaled) + (Math.random() < scaled % 1 ? 1 : 0));
      }
    }
    // N2b: material effect — Verdant Bloom tiles boost gather yield
    const matYieldMul = this.ctx.matFx?.mods?.gatherYieldMult ?? 1;
    if (matYieldMul !== 1) {
      for (const d of drops) d.n = Math.max(1, Math.round(d.n * matYieldMul));
    }
    // B5: the yield leaves the node and lands on the floor. Every modifier above
    // has already run — this only changes WHERE the finished Stack[] goes. A
    // mega-cluster spreads wider so up to 16 rolls read as a field, not a pile.
    this.ctx.drops.spawn(drops.filter((d) => d.n > 0), (a.tx + 0.5) * TILE, (a.ty + 0.5) * TILE,
      { spread: a.megaScale > 1 ? 2.2 : 1 });
    // N2b: material XP multiplier (Azure Vein etc.)
    const matXpMul = this.ctx.matFx?.mods?.xpMult ?? 1;
    const scaledXp = Math.round(a.def.xp * matXpMul);
    const newLevel = addXp(state, a.def.skill, scaledXp);

    if (a.def.toolClass) {
      const slot = toolSlotFor(a.def.toolClass);
      // N2b: material soul-XP multiplier (Ley Bloom etc.)
      const matSoulXpMul = this.ctx.matFx?.mods?.soulXpMult ?? 1;
      const scaledSoulXp = Math.round(CFG.soulgear.toolXpPerUse * matSoulXpMul);
      const toolLvl = awardSoulXp(state, slot, scaledSoulXp);
      if (toolLvl) {
        toast(`Your ${a.def.toolClass} feels sharper — soul level ${toolLvl}!`, 'good');
        this.ctx.log?.push('level', `Tool (${a.def.toolClass}) reached soul level ${toolLvl}`, state.clock);
      }
    }

    world.deplete(a.tx, a.ty, a.def.respawnSec);
    chunks.rebakeTile(a.tx, a.ty);

    // mega-cluster — the whole square falls at once
    if (a.mega) {
      world.depleteMega(a.mega, a.def.respawnSec);
      for (let dy = 0; dy < a.mega.size; dy++) {
        for (let dx = 0; dx < a.mega.size; dx++) {
          chunks.rebakeTile(a.mega.rootTx + dx, a.mega.rootTy + dy);
        }
      }
      toast(`The great ${a.def.name.toLowerCase()} falls!`, 'good');
    }

    // S1: gathering feeds vigor and marks non-idle action
    this.ctx.vitals?.markAction?.();
    this.ctx.vitals?.onGather?.();

    // G1: particle poof at gather location
    const px = (a.tx + 0.5) * TILE, py = (a.ty + 0.5) * TILE;
    this.ctx.particles?.spawn?.('poof', px, py, a.megaScale > 1 ? 20 : 8);

    Sound.play(pickSfx(GATHER_SFX[a.def.skill] ?? ['forage']));
    const got = drops.map((d) => `+${d.n} ${ITEMS[d.id].name}`).join('  ');
    // B5: the yield line moved to the pickup (drops.ts aggregates it); only the
    // xp stays here, because xp really is earned at the swing. The log entry below
    // keeps `got` — the event log records what the WORLD produced, which is still
    // true at roll time even if the player never walks over to collect it.
    toast(CFG.drops.enabled
      ? `+${scaledXp} ${SKILL_NAME[a.def.skill]} xp`
      : `${got}   (+${scaledXp} ${SKILL_NAME[a.def.skill]} xp)`);
    const s = this.ctx.net?.snap;
    this.ctx.log?.push('gather', `${got || 'Gathered nothing'} from ${a.def.name}`, state.clock);

    // N1: spawn network floaters showing what metrics influenced this gather
    if (this.ctx.floaters && this.ctx.net) {
      const wx = (a.tx + 0.5) * TILE, wy = (a.ty + 0.5) * TILE;
      const rtt = this.ctx.net.snap?.rtt ?? 50;
      const simMul = this.ctx.net.getGameValue?.('simSpeed') ?? 1.0;
      this.ctx.floaters.spawn(wx, wy, 'rtt', rtt, 'ms', this.ctx.cam);
      if (simMul !== 1.0) {
        this.ctx.floaters.spawn(wx + 8, wy - 12, 'simSpeed', simMul, '', this.ctx.cam);
      }
    }

    if (newLevel) {
      levelUpFlourish(this.ctx);   // B6 (plays the sound too)
      toast(`${SKILL_NAME[a.def.skill]} reached level ${newLevel}!`, 'good');
      this.ctx.log?.push('level', `${SKILL_NAME[a.def.skill]} reached level ${newLevel}`, state.clock);
    }
  }
}
