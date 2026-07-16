// Player melee: windup → active (damage resolves once here) → recovery state
// machine, best carried weapon auto-applies, plus watchtower fire, day regen,
// death & respawn.
import { CFG } from '../data/config';
import { BUILDINGS } from '../data/buildings';
import { ENEMIES } from '../data/enemies';
import { armorDef, awardSoulXp, charmRegen, equippedWeaponDmg, hall, skillLevel } from '../rules';
import { TILE } from '../world/worldgen';
import { Sound } from '../../engine/audio';
import type { Foe } from './hordes';
import type { WorldBoss } from '../state';
import type { AttackPhase } from '../world/player';

const bossSize = (id: string) => ENEMIES.find((e) => e.id === id)?.art.size ?? 40;

const FACING_ANGLE: Record<string, number> = {
  right: 0, down: Math.PI / 2, left: Math.PI, up: -Math.PI / 2,
};

export class CombatSystem {
  phase: AttackPhase = 'idle';
  private phaseT = 0;
  private queued = false;    // one buffered swing, pressed during recovery
  swingT = 0;          // >0 while the swing flash is visible
  swingAngle = 0;
  private towerT = new Map<number, number>(); // building uid → cooldown

  constructor(private ctx: any) {}

  update(dt: number) {
    this.swingT -= dt;

    const { state } = this.ctx;
    // daylight heals; night doesn't
    if (!this.ctx.isNight() && state.player.hp < CFG.player.maxHp) {
      state.player.hp = Math.min(CFG.player.maxHp, state.player.hp + (CFG.player.regenPerSec + charmRegen(state)) * dt);
    }
    this.updateTowers(dt);
    this.updatePhase(dt);
  }

  /** Windup/active/recovery durations, sped up by the weapon's soul level (floored). */
  private envelope() {
    const lvl = this.ctx.state.player.soulItems?.weapon?.level ?? 1;
    const { attackSpeedPerSoulLevel: k, attackSpeedFloor: floor } = CFG.combat;
    const mult = Math.max(floor, 1 / (1 + lvl * k));
    return {
      windup: CFG.combat.windupSec * mult,
      active: CFG.combat.activeSec * mult,
      recovery: CFG.combat.recoverySec * mult,
    };
  }

  private setPhase(p: AttackPhase) {
    this.phase = p;
    this.ctx.player.setAttackPhase(p);
  }

  private updatePhase(dt: number) {
    if (this.phase === 'idle') return;
    this.phaseT -= dt;
    if (this.phaseT > 0) return;

    const env = this.envelope();
    if (this.phase === 'windup') {
      this.resolveHit();
      this.setPhase('active');
      this.phaseT = env.active;
    } else if (this.phase === 'active') {
      this.setPhase('recovery');
      this.phaseT = env.recovery;
    } else {
      // recovery elapsed
      if (this.queued) { this.queued = false; this.startSwing(); }
      else this.setPhase('idle');
    }
  }

  /** Player pressed attack: starts windup from idle, buffers one swing during
   * recovery (keeps mashing from feeling ignored), ignored mid-swing. */
  attack() {
    if (this.ctx.state.gameOver) return;
    if (this.phase === 'idle') this.startSwing();
    else if (this.phase === 'recovery') this.queued = true;
  }

  private startSwing() {
    const env = this.envelope();
    this.setPhase('windup');
    this.phaseT = env.windup;
    this.swingAngle = this.ctx.player.aimAngle ?? FACING_ANGLE[this.ctx.player.facing];
    Sound.play('windup');
    // Snapshot sync pulse for damage calc + fire attack echo volley
    this.ctx.net?.getDamageMul?.();  // snapshots lastSwingRtt + lastSwingDmgMul
    this.ctx.net?.probeAction?.('attack');
  }

  /** Damage resolves once, on the windup → active transition. */
  private resolveHit() {
    const { state, player, hordes, views } = this.ctx;

    const fa = player.aimAngle ?? FACING_ANGLE[player.facing];
    this.swingT = 0.13;
    this.swingAngle = fa;

    // Damage = base × sync pulse multiplier × resonance crit (if any)
    const dmgMul = this.ctx.net?.lastSwingDmgMul ?? 1.0;
    const resonance = this.ctx.net?.consumeResonance?.() ?? null;
    const critMul = resonance ? resonance.multiplier : 1.0;
    const totalMul = dmgMul * critMul;

    const baseDmg = CFG.player.baseDmg + equippedWeaponDmg(state) + Math.floor(skillLevel(state, 'combat') / CFG.combat.dmgBonusPerLevel);
    const dmg = Math.round(baseDmg * totalMul);
    const arc = (CFG.combat.arcDeg * Math.PI) / 180;
    // hit math anchors at the feet — same anchor as foe positions, so point-blank
    // angles don't flip; the slash draws at body height for looks only
    const cx = state.player.x, cy = state.player.y;

    // always draw the swing so a whiff still reads as an attack
    views.addSlash(cx, cy - 10, fa, CFG.player.meleeRange, arc);
    Sound.play('swing');
    // G1: slash trail particles along the swing arc
    this.ctx.particles?.spawn?.('slash', cx, cy - 8, 8, fa);

    const inArc = (x: number, y: number, reach: number) => {
      const d = Math.hypot(x - cx, y - cy);
      if (d > reach) return -1;
      let dd = Math.atan2(y - cy, x - cx) - fa;
      while (dd > Math.PI) dd -= Math.PI * 2;
      while (dd < -Math.PI) dd += Math.PI * 2;
      return Math.abs(dd) > arc / 2 ? -1 : d;
    };

    let landed = false;
    const hitLines: string[] = [];
    for (const f of [...hordes.foes] as Foe[]) {
      const d = inArc(f.x, f.y, CFG.player.meleeRange + f.def.art.size / 2);
      if (d < 0) continue;
      // tiny knockback sells the hit
      const kx = f.x + (f.x - cx) / (d || 1) * 6, ky = f.y + (f.y - cy) / (d || 1) * 6;
      if (this.ctx.world.canStand(kx, ky, 5)) { f.x = kx; f.y = ky; }
      const hpBefore = f.hp;
      hordes.hurt(f, dmg);
      views.addHitFlash(f.x, f.y);
      landed = true;
      hitLines.push(`${f.def.name} for ${Math.min(dmg, hpBefore)} (${Math.max(0, f.hp)}/${f.maxHp} hp left)`);
    }

    // world bosses share the swing — they're big, so aim generously
    const wb = this.ctx.worldbosses;
    if (wb) for (const b of wb.alive() as WorldBoss[]) {
      const size = bossSize(b.defId);
      if (inArc(b.x, b.y, CFG.player.meleeRange + size / 2) < 0) continue;
      const hpBefore = b.hp;
      wb.hurt(b, dmg);
      views.addHitFlash(b.x, b.y - size / 4);
      landed = true;
      hitLines.push(`${b.name} for ${Math.min(dmg, hpBefore)} (${Math.max(0, b.hp)}/${b.maxHp} hp left)`);
    }
    if (landed) {
      Sound.play('hit');
      const s = this.ctx.net?.snap;
      const mulInfo = totalMul !== 1.0
        ? ` [${totalMul.toFixed(2)}×${resonance ? ' ⚡RESONANCE ' + resonance.label : ''}]`
        : '';
      this.ctx.log?.push('combat', `Hit ${hitLines.join('; ')}${mulInfo}`, state.clock);
      // M3.6v2: Resonance crit floaters + particles
      if (resonance) {
        this.ctx.floaters?.spawnInfo?.(cx, cy - 30, `⚡RESONANCE ${resonance.label}`, '#ffcc00', this.ctx.camera);
        this.ctx.particles?.spawn?.('crit', cx, cy - 8, 15);
        this.ctx.toast?.(`Resonance crit! ${resonance.label} — your strike rings true`, 'good');
        Sound.play('hit'); // extra impact
      }
      const lvl = awardSoulXp(state, 'weapon', CFG.soulgear.weaponXpPerSwing);
      if (lvl) { this.ctx.toast(`Your weapon feels hungrier — soul level ${lvl}!`, 'good'); this.ctx.log?.push('level', `Weapon reached soul level ${lvl}`, state.clock); }
      if (state.player.equip?.ring) {
        const rl = awardSoulXp(state, 'ring', CFG.soulgear.ringXpPerSwing);
        if (rl) { this.ctx.toast(`Your ring tightens — soul level ${rl}!`, 'good'); this.ctx.log?.push('level', `Ring reached soul level ${rl}`, state.clock); }
      }
    } else {
      this.ctx.log?.push('combat', 'Swung and missed', state.clock);
    }
  }

  private updateTowers(dt: number) {
    const { state, hordes, views, worldbosses } = this.ctx;
    const bosses: WorldBoss[] = worldbosses ? worldbosses.alive() : [];
    if (!hordes.foes.length && !bosses.length) return;
    for (const b of state.buildings) {
      const def = BUILDINGS.find((d) => d.id === b.type);
      if (!def?.tower) continue;
      const t = (this.towerT.get(b.uid) ?? 0) - dt;
      if (t > 0) { this.towerT.set(b.uid, t); continue; }

      const bx = (b.tx + 0.5) * TILE, by = (b.ty + 0.2) * TILE;
      const range = def.tower.rangeTiles * TILE;
      let bestFoe: Foe | null = null, bestBoss: WorldBoss | null = null, bestD = Infinity;
      for (const f of hordes.foes as Foe[]) {
        const d = Math.hypot(f.x - bx, f.y - by);
        if (d < range && d < bestD) { bestFoe = f; bestBoss = null; bestD = d; }
      }
      for (const wb of bosses) {
        const d = Math.hypot(wb.x - bx, wb.y - by);
        if (d < range && d < bestD) { bestBoss = wb; bestFoe = null; bestD = d; }
      }
      if (bestFoe) {
        this.towerT.set(b.uid, def.tower.cooldown);
        views.addShot(bx, by, bestFoe.x, bestFoe.y - bestFoe.def.art.size / 2);
        this.ctx.log?.push('combat', `${def.name} shoots ${bestFoe.def.name} for ${def.tower.dmg} (${Math.max(0, bestFoe.hp - def.tower.dmg)}/${bestFoe.maxHp} hp left)`, state.clock);
        hordes.hurt(bestFoe, def.tower.dmg, false); // towers don't train your combat
      } else if (bestBoss) {
        this.towerT.set(b.uid, def.tower.cooldown);
        views.addShot(bx, by, bestBoss.x, bestBoss.y);
        this.ctx.log?.push('combat', `${def.name} shoots ${bestBoss.name} for ${def.tower.dmg} (${Math.max(0, bestBoss.hp - def.tower.dmg)}/${bestBoss.maxHp} hp left)`, state.clock);
        worldbosses.hurt(bestBoss, def.tower.dmg, false);
      } else {
        this.towerT.set(b.uid, 0);
      }
    }
  }

  /** Enemy → player damage, plus death handling. */
  damagePlayer(dmg: number, source?: string) {
    const { state, player, toast } = this.ctx;
    if (state.gameOver) return;
    if (state.god) { this.ctx.log?.push('combat', `${source ?? 'Something'} hits you for 0 (god mode)`, state.clock); return; }
    const taken = Math.max(1, dmg - armorDef(state)); // armor softens, never fully negates
    state.player.hp -= taken;
    player.flash();
    Sound.play('hurt');
    this.ctx.cam.shake?.(Math.min(11, 3 + taken * 0.25));
    this.ctx.log?.push('combat', `${source ?? 'Something'} hits you for ${taken} (${Math.max(0, Math.ceil(state.player.hp))}/${CFG.player.maxHp} hp left)`, state.clock);
    // M3.5: Action-gated network probe — taking damage routes through the shield network
    this.ctx.net?.probeAction?.('damage');
    // M3.6: Passive effectiveType snapshot — connection tier at hit time, zero HTTP
    this.ctx.net?.samplePassive?.('damage');
    if (state.player.equip?.armor) {
      const lvl = awardSoulXp(state, 'armor', CFG.soulgear.armorXpPerHit);
      if (lvl) { toast(`Your armor toughens — soul level ${lvl}!`, 'good'); this.ctx.log?.push('level', `Armor reached soul level ${lvl}`, state.clock); }
    }
    if (state.player.equip?.amulet) {
      const lvl = awardSoulXp(state, 'amulet', CFG.soulgear.amuletXpPerHit);
      if (lvl) { toast(`Your amulet hums — soul level ${lvl}!`, 'good'); this.ctx.log?.push('level', `Amulet reached soul level ${lvl}`, state.clock); }
    }
    if (state.player.hp > 0) return;

    // down — drop gold and the connection scatters you far into the wilds
    const lost = Math.floor(state.player.gold * CFG.player.deathGoldLossPct);
    state.player.gold -= lost;
    state.player.hp = CFG.player.maxHp;
    const spot = this.randomRespawn();
    state.player.x = spot.x;
    state.player.y = spot.y;
    player.teleport(spot.x, spot.y);
    toast(lost > 0
      ? `The thread snaps — you're scattered, ${lost} gold gone. Find your way home.`
      : 'The thread snaps — you are cast into distant lands…', 'bad');
    this.ctx.log?.push('death', `You fell${lost > 0 ? ` (−${lost} gold)` : ''} — cast into distant lands`, state.clock);
  }

  /** A random passable spot far from home — the reconnection point. */
  private randomRespawn(): { x: number; y: number } {
    const { state, world } = this.ctx;
    const h = hall(state);
    const cx = h ? (h.tx + 0.5) * TILE : this.ctx.spawnPoint.x;
    const cy = h ? (h.ty + 0.5) * TILE : this.ctx.spawnPoint.y;
    const { respawnMinTiles: mn, respawnMaxTiles: mx } = CFG.player;
    for (let i = 0; i < 80; i++) {
      const ang = Math.random() * Math.PI * 2;
      const dist = (mn + Math.random() * (mx - mn)) * TILE;
      const x = cx + Math.cos(ang) * dist, y = cy + Math.sin(ang) * dist;
      if (world.canStand(x, y)) return { x, y };
    }
    return { x: cx, y: cy };
  }
}
