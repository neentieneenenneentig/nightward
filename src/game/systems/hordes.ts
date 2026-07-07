// The night. Waves scale with nights survived AND territory score (greed =
// risk). Enemies walk at the hall, chew through whatever blocks them, and
// switch to the player at close range. All knobs in config.horde.
import { CFG } from '../data/config';
import { ENEMIES, type EnemyDef } from '../data/enemies';
import { ITEMS } from '../data/items';
import { addXp, autoEquip, hall, invAdd, rollLoot, territoryScore } from '../rules';
import type { Building } from '../state';
import { TILE } from '../world/worldgen';
import { BUILDINGS } from '../data/buildings';
import { Sound } from '../../engine/audio';

export interface Foe {
  uid: number;
  def: EnemyDef;
  x: number; y: number;
  px: number; py: number;
  hp: number; maxHp: number;
  dmg: number;
  atkT: number;
  animT: number;
}

export class HordeSystem {
  foes: Foe[] = [];
  private toSpawn = 0;
  private spawnT = 0;

  constructor(private ctx: any) {}

  onDusk(nightIndex: number) {
    if (nightIndex < CFG.horde.firstNight) return;
    this.toSpawn = Math.round(
      CFG.horde.baseCount +
      CFG.horde.perNight * (nightIndex - 1) +
      CFG.horde.perTerritory * territoryScore(this.ctx.state),
    );
    this.spawnT = 0;
    this.ctx.toast(`Night ${nightIndex} — something stirs in the ungoverned dark…`, 'bad');
    this.ctx.log?.push('combat', `Night ${nightIndex} falls — ${this.toSpawn} incoming`, this.ctx.state.clock);
  }

  onDawn() {
    const { state, toast } = this.ctx;
    state.nightsSurvived++;
    if (CFG.horde.dawnFlee) {
      for (const f of this.foes) this.ctx.views.removeFoe(f.uid);
      this.foes = [];
    }
    this.toSpawn = 0;
    toast(`Dawn breaks. Nights survived: ${state.nightsSurvived}`, 'good');
    this.ctx.log?.push('combat', `Dawn breaks — nights survived: ${state.nightsSurvived}`, state.clock);
  }

  update(dt: number) {
    if (this.ctx.isNight() && this.toSpawn > 0 && this.foes.length < CFG.horde.maxAlive) {
      this.spawnT -= dt;
      if (this.spawnT <= 0) {
        this.spawnT = CFG.horde.spawnIntervalSec;
        this.spawn();
      }
    }
    for (const f of [...this.foes]) this.updateFoe(f, dt);
  }

  private spawn() {
    const { state, world, views } = this.ctx;
    const n = this.ctx.nightIndex();

    // weighted pick among types unlocked by this night (never world bosses)
    const pool = ENEMIES.filter((e) => !e.boss && e.fromNight <= n);
    const totalW = pool.reduce((s, e) => s + e.weight, 0);
    let r = Math.random() * totalW;
    let def = pool[0];
    for (const e of pool) { r -= e.weight; if (r <= 0) { def = e; break; } }

    const h = hall(state);
    const cx = h ? (h.tx + 0.5) * TILE : state.player.x;
    const cy = h ? (h.ty + 0.5) * TILE : state.player.y;
    let x = cx, y = cy, placed = false;
    for (let i = 0; i < 10 && !placed; i++) {
      const ang = Math.random() * Math.PI * 2;
      const dist = CFG.horde.spawnRadiusTiles * TILE * (0.9 + Math.random() * 0.35);
      x = cx + Math.cos(ang) * dist;
      y = cy + Math.sin(ang) * dist;
      placed = world.canStand(x, y, 5);
    }
    if (!placed) return; // hostile geography; try again next tick

    const hpMul = Math.pow(CFG.horde.hpGrowth, n - 1);
    const dmgMul = Math.pow(CFG.horde.dmgGrowth, n - 1);
    const foe: Foe = {
      uid: state.nextUid++, def,
      x, y, px: x, py: y,
      hp: Math.round(def.hp * hpMul), maxHp: Math.round(def.hp * hpMul),
      dmg: Math.round(def.dmg * dmgMul),
      atkT: 0, animT: Math.random(),
    };
    this.foes.push(foe);
    views.addFoe(foe);
    this.toSpawn--;
  }

  private updateFoe(f: Foe, dt: number) {
    const { state, world } = this.ctx;
    f.px = f.x; f.py = f.y;
    f.atkT -= dt;
    f.animT += dt;

    const p = state.player;
    const h = hall(state);
    const dp = Math.hypot(p.x - f.x, (p.y - 10) - f.y);
    const targetPlayer = dp < CFG.horde.aggroRangePx || !h;
    const tx = targetPlayer ? p.x : (h!.tx + 0.5) * TILE;
    const ty = targetPlayer ? p.y - 10 : (h!.ty + 0.9) * TILE;
    const dist = Math.hypot(tx - f.x, ty - f.y) || 1;

    // in reach of the player → bite
    if (targetPlayer && dp < 24) {
      if (f.atkT <= 0) {
        f.atkT = f.def.atkCooldown;
        this.ctx.damagePlayer(f.dmg);
      }
      return;
    }
    // in reach of the hall → chew the hall
    if (!targetPlayer && dist < 42) {
      if (f.atkT <= 0) {
        f.atkT = f.def.atkCooldown;
        this.damageBuilding(h!, f.dmg);
      }
      return;
    }

    // march
    const ux = (tx - f.x) / dist, uy = (ty - f.y) / dist;
    const step = f.def.speed * dt;
    let blocked: Building | null = null;
    const nx = f.x + ux * step, ny = f.y + uy * step;
    if (world.canStand(nx, f.y, 5)) f.x = nx;
    else blocked = this.obstacle(f, ux, 0) ?? blocked;
    if (world.canStand(f.x, ny, 5)) f.y = ny;
    else blocked = this.obstacle(f, 0, uy) ?? blocked;

    if (blocked) {
      // something the racket built is in the way — eat it
      if (f.atkT <= 0) {
        f.atkT = f.def.atkCooldown;
        this.damageBuilding(blocked, f.dmg);
      }
    } else if (f.x === f.px && f.y === f.py) {
      // stuck on terrain — sidestep randomly to slip around trees/rocks
      const j = (Math.random() - 0.5) * 2;
      const sx = f.x - uy * j * step * 2, sy = f.y + ux * j * step * 2;
      if (world.canStand(sx, sy, 5)) { f.x = sx; f.y = sy; }
    }
  }

  private obstacle(f: Foe, dx: number, dy: number): Building | null {
    const tx = Math.floor((f.x + (dx > 0 ? 10 : dx < 0 ? -10 : 0)) / TILE);
    const ty = Math.floor((f.y + (dy > 0 ? 4 : dy < 0 ? -12 : -4)) / TILE);
    return this.ctx.world.buildingAt(tx, ty);
  }

  private damageBuilding(b: Building, dmg: number) {
    const { state, world, views, toast } = this.ctx;
    b.hp -= dmg;
    if (b.hp > 0) return;
    const def = BUILDINGS.find((d) => d.id === b.type)!;
    state.buildings = state.buildings.filter((x: Building) => x.uid !== b.uid);
    world.reindexBuildings();
    views.removeBuilding(b.uid);
    if (b.type === 'wall') views.refreshWallsAround(b.tx, b.ty);
    toast(`${def.name} destroyed!`, 'bad');
    this.ctx.log?.push('build', `${def.name} destroyed at (${b.tx},${b.ty})`, state.clock);
    if (b.type === 'hall') this.ctx.onHallDestroyed();
  }

  /** Damage from the player (or towers). Handles death, loot, xp. */
  hurt(f: Foe, dmg: number, awardXp = true) {
    f.hp -= dmg;
    if (f.hp > 0) return;
    const { state, views, toast } = this.ctx;
    this.foes = this.foes.filter((x) => x.uid !== f.uid);
    views.removeFoe(f.uid);
    Sound.play('enemyDie');

    const [gMin, gMax] = f.def.gold;
    state.player.gold += gMin + Math.floor(Math.random() * (gMax - gMin + 1));
    for (const d of rollLoot(f.def.loot)) {
      invAdd(state, d.id, d.n);
      autoEquip(state, d.id);
      toast(`+${d.n} ${ITEMS[d.id].name}`);
    }
    if (awardXp) {
      const lvl = addXp(state, 'combat', f.def.xp);
      if (lvl) { toast(`Combat reached level ${lvl}!`, 'good'); this.ctx.log?.push('level', `Combat reached level ${lvl}`, state.clock); }
    }
    this.ctx.log?.push('combat', `Slew a ${f.def.name}`, state.clock);
  }
}
