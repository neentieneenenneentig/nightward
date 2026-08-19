// The night — and the day's prey. Night waves scale with nights survived AND
// territory score (greed = risk); they walk at the hall, chew through whatever
// blocks them, and switch to the player at close range. By day, sparse roamers
// (EnemyDef.daytime) pop up around the player to hunt for loot — they wander
// near where they spawned, never siege the hall, and melt away when left far
// behind. Knobs in config.horde / config.dayspawn.
import { CFG } from '../data/config';
import { ENEMIES, type EnemyDef } from '../data/enemies';
import { ITEMS } from '../data/items';
import { SKILLS } from '../data/skills';
import { acquireGear, addXp, awardSoulXp, hall, invAdd, rollLoot, territoryScore } from '../rules';
import { activeEffects } from './effects';
import type { Building } from '../state';
import { TILE } from '../world/worldgen';
import { BUILDINGS } from '../data/buildings';
import { Sound } from '../../engine/audio';
import { epithetForRegion, prefixForBirth } from '../data/lexicon';

const SKILL_NAME: Record<string, string> = Object.fromEntries(SKILLS.map((s) => [s.id, s.name]));

export interface Foe {
  uid: number;
  def: EnemyDef;
  x: number; y: number;
  px: number; py: number;
  hp: number; maxHp: number;
  dmg: number;
  baseDmg: number;    // dmg with all birth scaling (night/net/echo) — buffs restore to THIS, never def.dmg
  atkT: number;
  telegraphT: number; // >0 while committed to a telegraphed hit landing
  animT: number;
  dayMob?: boolean;   // day prey: wanders near home, never sieges, despawns when far
  homeX?: number; homeY?: number; // wander anchor (day mobs only)
}

/** X1: a ranged foe's shot in flight — advanced by the SIM tick (never
 * wall-clock timers: the game may be paused, sped, or slowed). */
interface Projectile {
  x: number; y: number;
  tx: number; ty: number; // aimed point (where the target was at fire time)
  speed: number; dmg: number;
  life: number;           // seconds of flight left
  ang: number;
  sparkT: number;         // visual: particle-trail accumulator
}

export class HordeSystem {
  foes: Foe[] = [];
  private projectiles: Projectile[] = [];
  private toSpawn = 0;
  private spawnT = 0;
  private daySpawnT = 0;

  constructor(private ctx: any) {}

  onDusk(nightIndex: number) {
    if (nightIndex < CFG.horde.firstNight) return;
    // M3: gold-scaled horde size — the network detects your cache
    const gold = this.ctx.state.player.gold;
    const goldSteps = Math.max(0, Math.floor((gold - CFG.horde.goldThreshold) / CFG.horde.goldThreshold));
    const goldMult = 1 + goldSteps * CFG.horde.goldMultPerThreshold;
    this.toSpawn = Math.round((
      CFG.horde.baseCount +
      CFG.horde.perNight * (nightIndex - 1) +
      CFG.horde.perTerritory * territoryScore(this.ctx.state)
    ) * goldMult);
    this.spawnT = 0;
    const s = this.ctx.net?.snap;
    this.ctx.toast(`Night ${nightIndex} — ${this.toSpawn} enemies converge`, 'bad');
    this.ctx.log?.push('combat', `Night ${nightIndex} falls — ${this.toSpawn} incoming (gold ${gold} → ${goldMult.toFixed(1)}× horde)`, this.ctx.state.clock);
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
    // by day, trickle prey up to its own (small) cap
    if (!this.ctx.isNight() && !this.ctx.state.gameOver) {
      const dayCount = this.foes.reduce((n, f) => n + (f.dayMob ? 1 : 0), 0);
      if (dayCount < CFG.dayspawn.maxAlive) {
        this.daySpawnT -= dt;
        if (this.daySpawnT <= 0) {
          this.daySpawnT = CFG.dayspawn.spawnIntervalSec;
          this.spawnDayMob();
        }
      }
    }
    this.updateTraps(dt);
    for (const f of [...this.foes]) this.updateFoe(f, dt);
    // X1: projectiles fly on the sim clock. They hit the player on contact, or
    // land at their aimed point when flight time runs out (splash vs whatever
    // stands there — player nearby, else a building on the tile).
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      const pNow = this.ctx.state.player;
      p.life -= dt;
      p.x += Math.cos(p.ang) * p.speed * dt;
      p.y += Math.sin(p.ang) * p.speed * dt;
      // faint spark trail so the shot is readable and dodgeable
      p.sparkT -= dt;
      if (p.sparkT <= 0) { p.sparkT = 0.06; this.ctx.particles?.spawn?.('spark', p.x, p.y, 1); }

      if (Math.hypot(pNow.x - p.x, pNow.y - p.y) < 18) {
        this.ctx.damagePlayer(p.dmg, 'a hurled bolt');
        this.projectiles.splice(i, 1);
      } else if (p.life <= 0) {
        if (Math.hypot(pNow.x - p.tx, pNow.y - p.ty) < TILE * 1.2) {
          this.ctx.damagePlayer(p.dmg, 'a hurled bolt');
        } else {
          const bt = this.ctx.world.buildingAt(Math.floor(p.tx / TILE), Math.floor(p.ty / TILE));
          if (bt) this.damageBuilding(bt, p.dmg);
        }
        // Review fix: 'hit' isn't a real ParticleKind (only poof/ember/slash/
        // spark/wisp/rift/death/heal/crit exist) — `ctx` being typed `any`
        // let this typo past tsc entirely. PARTICLE_DEFS['hit'] was
        // `undefined`, so this threw on every projectile landing, taking
        // hordes.update() (and the whole render-loop ticker callback that
        // calls it) down with it. 'spark' is the impact effect used
        // elsewhere in this file for the same kind of moment.
        this.ctx.particles?.spawn?.('spark', p.tx, p.ty, 4);
        this.projectiles.splice(i, 1);
      }
    }
  }

  private spawn() {
    const { state, world, views } = this.ctx;
    const n = this.ctx.nightIndex();

    // M3: gold-scaled enemy pool — at high gold, boss-type enemies can appear in night waves
    const gold = state.player.gold;
    const pool = ENEMIES.filter((e) => {
      if (e.fromNight > n) return false; // not unlocked yet
      if (e.boss) return gold >= CFG.horde.bossAtGold; // bosses only at high gold
      return true;
    });
    const totalW = pool.reduce((s, e) => s + (e.boss ? e.weight * CFG.horde.bossGoldWeight : e.weight), 0);
    let r = Math.random() * totalW;
    let def = pool[0];
    for (const e of pool) {
      const w = e.boss ? e.weight * CFG.horde.bossGoldWeight : e.weight;
      r -= w;
      if (r <= 0) { def = e; break; }
    }

    const h = hall(state);
    const cx = h ? (h.tx + 0.5) * TILE : state.player.x;
    const cy = h ? (h.ty + 0.5) * TILE : state.player.y;
    let x = cx, y = cy, placed = false;
    for (let i = 0; i < 10 && !placed; i++) {
      const ang = Math.random() * Math.PI * 2;
      const dist = (CFG.horde.spawnRadiusMinTiles + Math.random() * (CFG.horde.spawnRadiusMaxTiles - CFG.horde.spawnRadiusMinTiles)) * TILE * (0.9 + Math.random() * 0.35);
      x = cx + Math.cos(ang) * dist;
      y = cy + Math.sin(ang) * dist;
      placed = world.canStand(x, y, 5) && this.nearestCampfireDist(x, y) > CFG.fire.campfireFearTiles * TILE;
    }
    if (!placed) return; // hostile geography (or firelight); try again next tick

    const hpMul = Math.pow(CFG.horde.hpGrowth, n - 1);
    const dmgMul = Math.pow(CFG.horde.dmgGrowth, n - 1);
    // N1: network enemy scaling (worse connection = tougher enemies)
    // X1: 'Veil Pressure' — JS heap weight leans on foe hp too
    const netScale = (this.ctx.net?.getGameValue?.('enemyScale') ?? 1.0)
      * (this.ctx.net?.getGameValue?.('veilPressure') ?? 1.0);

    // N2a: echo-derived stats for night-wave mobs (C2)
    const echo = this.ctx.net?.lastEcho;
    const echoFresh = echo && (performance.now() - echo.tsMs < 30000);
    let echoHpMul = 1.0, echoDmgMul = 1.0, echoSoak = 0, epithetName = def.name, specialSkill: string | null = null;
    let echoMoveMul = 1.0;
    if (echoFresh) {
      // hp × (0.9 + ms/400), clamp 0.9–1.6
      echoHpMul = Math.max(0.9, Math.min(1.6, 0.9 + echo!.ms / 400));
      // damage × (0.9 + jitterAtBirth/80), clamp 0.9–1.5
      echoDmgMul = Math.max(0.9, Math.min(1.5, 0.9 + echo!.jitterAtBirth / 80));
      // defense (flat soak): cold ? 2 : 0
      echoSoak = echo!.cold ? 2 : 0;
      // move speed × (1.25 − ms/300), clamp 0.85–1.2
      echoMoveMul = Math.max(0.85, Math.min(1.2, 1.25 - echo!.ms / 300));

      // Special skills (max one per foe)
      const prof = this.ctx.net?.computeRealmProfile?.() ?? { median: echo!.ms, variance: 0 };
      if (prof.variance >= 8000) {
        specialSkill = 'Blinker'; // teleports 2 tiles away the first time hit
      } else if (echo!.cold) {
        specialSkill = 'Shelled'; // +2 extra soak until hit 3 times
        echoSoak += 2;
      }

      // Epithet name: prefix + base name + region suffix
      const prefix = prefixForBirth(echo!.cold, echo!.jitterAtBirth, echo!.ms);
      const suffix = epithetForRegion(echo!.route.region);
      epithetName = [prefix, def.name, suffix].filter(Boolean).join(' ');
    }

    const scaledDmg = Math.round(def.dmg * dmgMul * netScale * echoDmgMul);
    const foe: any = {
      uid: state.nextUid++, def,
      x, y, px: x, py: y,
      hp: Math.round(def.hp * hpMul * netScale * echoHpMul),
      maxHp: Math.round(def.hp * hpMul * netScale * echoHpMul),
      dmg: scaledDmg, baseDmg: scaledDmg,
      atkT: 0, telegraphT: 0, animT: Math.random(),
    };
    // N2a: attach echo-derived fields
    foe.echoSoak = echoSoak;
    foe.echoMoveMul = echoMoveMul;
    foe.specialSkill = specialSkill;
    foe.epithetName = epithetName;
    foe.hitCount = 0;
    foe.blinked = false;
    this.foes.push(foe);
    views.addFoe(foe);
    this.toSpawn--;
    // X1: swarm enemies spawn in packs — extra copies in a cluster
    if (def.behavior?.kind === 'swarm' && (def.behavior.swarmSize ?? 1) > 1) {
      const extra = (def.behavior.swarmSize ?? 2) - 1;
      for (let s = 0; s < extra && this.foes.length < CFG.horde.maxAlive; s++) {
        const sx = x + (Math.random() - 0.5) * TILE * 2;
        const sy = y + (Math.random() - 0.5) * TILE * 2;
        if (!world.canStand(sx, sy, 5)) continue;
        const swarmFoe: any = {
          uid: state.nextUid++, def,
          x: sx, y: sy, px: sx, py: sy,
          hp: foe.maxHp, maxHp: foe.maxHp,
          dmg: foe.baseDmg, baseDmg: foe.baseDmg, atkT: 0, telegraphT: 0, animT: Math.random() + s * 0.3,
          echoSoak: 0, echoMoveMul: 1, specialSkill: null, epithetName: def.name, hitCount: 0, blinked: false,
        };
        this.foes.push(swarmFoe);
        views.addFoe(swarmFoe);
      }
    }
    // N2a: Chronicle gets fiction voice, Lens feed gets technical
    if (echoFresh) {
      this.ctx.log?.push('spawn', `A ${epithetName} joins the night wave (${foe.hp} hp)`, state.clock);
    } else {
      this.ctx.log?.push('spawn', `A ${def.name} joins the night wave (${foe.hp} hp)`, state.clock);
    }
  }

  /** Day prey: spawns around the PLAYER at base (night-1) stats — loot on legs. */
  private spawnDayMob() {
    const { state, world, views } = this.ctx;
    const pool = ENEMIES.filter((e) => e.daytime);
    if (!pool.length) return;
    const totalW = pool.reduce((s, e) => s + e.weight, 0);
    let r = Math.random() * totalW;
    let def = pool[0];
    for (const e of pool) { r -= e.weight; if (r <= 0) { def = e; break; } }

    const { minRadiusTiles: mn, maxRadiusTiles: mx } = CFG.dayspawn;
    let x = 0, y = 0, placed = false;
    for (let i = 0; i < 10 && !placed; i++) {
      const ang = Math.random() * Math.PI * 2;
      const dist = (mn + Math.random() * (mx - mn)) * TILE;
      x = state.player.x + Math.cos(ang) * dist;
      y = state.player.y + Math.sin(ang) * dist;
      placed = world.canStand(x, y, 5);
    }
    if (!placed) return; // hostile geography; try again next tick

    // N1: network enemy scaling applied to day mobs too
    const netScale = this.ctx.net?.getGameValue?.('enemyScale') ?? 1.0;
    const dayDmg = Math.round(def.dmg * netScale);
    const foe: Foe = {
      uid: state.nextUid++, def,
      x, y, px: x, py: y,
      hp: Math.round(def.hp * netScale), maxHp: Math.round(def.hp * netScale),
      dmg: dayDmg, baseDmg: dayDmg,
      atkT: 0, telegraphT: 0, animT: Math.random(),
      dayMob: true, homeX: x, homeY: y,
    };
    this.foes.push(foe);
    views.addFoe(foe);
    const s = this.ctx.net?.snap;
    this.ctx.log?.push('spawn', `A ${def.name} prowls into view (${foe.hp} hp)`, state.clock);
  }

  private updateFoe(f: Foe, dt: number) {
    const { state, world } = this.ctx;
    f.px = f.x; f.py = f.y;
    f.atkT -= dt;
    f.animT += dt;

    // X1: poison DoT (Venom/Blight/Plague spires) — whole points, accumulated
    const efp = f as any;
    if (efp._poisonUntil > state.clock && efp._poisonDps > 0) {
      efp._poisonAcc = (efp._poisonAcc ?? 0) + efp._poisonDps * dt;
      const whole = Math.floor(efp._poisonAcc);
      if (whole > 0) {
        efp._poisonAcc -= whole;
        this.hurt(f, whole, false); // tower rule: no xp/vitals
        if (f.hp <= 0) return;
      }
    }

    const p = state.player;

    // committed to an already-telegraphed hit — frozen mid-swing regardless of
    // what the player does next; only the final distance check decides hit/whiff
    if (f.telegraphT > 0) {
      f.telegraphT -= dt;
      if (f.telegraphT <= 0) {
        const dpNow = Math.hypot(p.x - f.x, (p.y - 10) - f.y);
        if (dpNow < 24 + CFG.combat.telegraphSlackPx) this.ctx.damagePlayer(f.dmg, f.def.name);
        else this.ctx.log?.push('combat', `${f.def.name} lunges and misses`, state.clock);
      }
      return;
    }

      // day prey left far behind fades back into the network
    if (f.dayMob && Math.hypot(p.x - f.x, p.y - f.y) > CFG.dayspawn.despawnTiles * TILE) {
      this.foes = this.foes.filter((x) => x.uid !== f.uid);
      this.ctx.views.removeFoe(f.uid);
      return;
    }

    const beh = f.def.behavior;
    const h = hall(state);
    const dp = Math.hypot(p.x - f.x, (p.y - 10) - f.y);
    // day mobs are prey, not siege: aggro the player up close, otherwise wander home
    const targetPlayer = dp < CFG.horde.aggroRangePx || (!h && !f.dayMob);
    let tx: number, ty: number;
    if (targetPlayer) { tx = p.x; ty = p.y - 10; }
    else if (f.dayMob) {
      tx = f.homeX! + Math.cos(f.animT * 0.35 + f.uid) * TILE * 2.5;
      ty = f.homeY! + Math.sin(f.animT * 0.28 + f.uid) * TILE * 2.5;
    } else { tx = (h!.tx + 0.5) * TILE; ty = (h!.ty + 0.9) * TILE; }
    const dist = Math.hypot(tx - f.x, ty - f.y) || 1;

    // ---- X1: Behavior-driven AI -------------------------------------------

    // RANGED: fire projectiles from preferred range, kite away if too close
    if (beh?.kind === 'ranged' && targetPlayer) {
      const prefPx = (beh.preferredRangeTiles ?? 4) * TILE;
      const projSpeed = beh.projectileSpeed ?? 180;
      if (dp < prefPx * 1.1 && f.atkT <= 0 && this.hasLineOfSight(f.x, f.y, tx, ty)) {
        f.atkT = f.def.atkCooldown;
        // fire a projectile toward the player
        this.spawnProjectile(f.x, f.y, tx, ty, projSpeed, f.dmg);
        this.ctx.log?.push('combat', `${f.def.name} fires at you`, state.clock);
      }
      // kite: move away if too close
      if (dp < prefPx * 0.6) {
        const away = Math.atan2(f.y - ty, f.x - tx);
        tx = f.x + Math.cos(away) * TILE * 5;
        ty = f.y + Math.sin(away) * TILE * 5;
      }
    }

    // SIEGE: target buildings preferentially, bonus structure damage
    if (beh?.kind === 'siege') {
      const nearestWall = this.nearestWallInRange(f.x, f.y, TILE * 8);
      if (nearestWall) {
        tx = (nearestWall.tx + 0.5) * TILE; ty = (nearestWall.ty + 0.5) * TILE;
        const wdist = Math.hypot(tx - f.x, ty - f.y);
        if (wdist < 48 && f.atkT <= 0) {
          f.atkT = f.def.atkCooldown;
          this.damageBuilding(nearestWall, Math.round(f.dmg * (beh.structureDmgMul ?? 2)), f);
          return;
        }
      }
    }

    // EXPLODER: detonate on reaching melee range (suicide — no loot)
    if (beh?.kind === 'exploder' && targetPlayer && dp < 36 && f.atkT <= 0) {
      this.detonateFoe(f, beh.explodeRadiusTiles ?? 2, beh.explodeDmg ?? f.dmg * 2, true);
      return;
    }

    // BUFFER / HEALER / SUMMONER: stay behind the front line
    if (beh && (beh.kind === 'buffer' || beh.kind === 'healer' || beh.kind === 'summoner')) {
      // Keep distance from player — hover behind other foes
      const keepDist = TILE * 5;
      if (dp < keepDist) {
        const away = Math.atan2(f.y - ty, f.x - tx);
        tx = f.x + Math.cos(away) * TILE * 3;
        ty = f.y + Math.sin(away) * TILE * 3;
      }
      // BUFFER: pulse buff aura to nearby allies
      if (beh.kind === 'buffer' && f.atkT <= 0) {
        f.atkT = f.def.atkCooldown;
        this.pulseBuff(f, beh.buffRadiusTiles ?? 4, beh.buffDmgMul ?? 1.3, beh.buffSpeedMul ?? 1.15);
      }
      // HEALER: pulse heal to nearby damaged allies
      if (beh.kind === 'healer' && f.atkT <= 0) {
        f.atkT = beh.healCooldownSec ?? 4;
        this.pulseHeal(f, beh.healRadiusTiles ?? 5, beh.healAmount ?? 10);
      }
      // SUMMONER: periodically spawn minions
      if (beh.kind === 'summoner' && f.atkT <= 0) {
        f.atkT = beh.summonCooldownSec ?? 12;
        this.summonMinions(f, beh.summonId ?? 'gnawer', beh.summonCount ?? 2, beh.summonMax ?? 6);
      }
    }

    // in reach of the player → wind up a telegraphed bite (see block above).
    // Only ranged foes (they kite instead) and exploders (contact = detonate)
    // skip this — everything else cornered by the player still fights back.
    if (targetPlayer && dp < 24 && beh?.kind !== 'ranged' && beh?.kind !== 'exploder') {
      if (f.atkT <= 0) {
        f.atkT = f.def.atkCooldown;
        f.telegraphT = f.def.telegraphSec;
        Sound.play('telegraph');
        this.ctx.log?.push('combat', `${f.def.name} bites at you`, state.clock);
      }
      return;
    }
    // in reach of the hall → chew the hall (day mobs never siege)
    if (!targetPlayer && !f.dayMob && dist < 42) {
      if (f.atkT <= 0) {
        f.atkT = f.def.atkCooldown;
        this.damageBuilding(h!, f.dmg * (beh?.structureDmgMul ?? 1), f);
      }
      return;
    }

    // march (day prey ambles while wandering, runs when it has you). Terrain
    // under the foe's feet scales its speed too (mud bogs the horde down), and
    // firelight nearby makes it hesitate (no pathfinding — just a speed penalty).
    const ux = (tx - f.x) / dist, uy = (ty - f.y) / dist;
    const terrain = world.speedAt(Math.floor(f.x / TILE), Math.floor(f.y / TILE));
    const fear = this.nearestCampfireDist(f.x, f.y) < CFG.fire.campfireFearTiles * TILE ? CFG.fire.campfireFearSpeedMult : 1;
    // C1: Rime Nova chill — the echo system stamps chillUntil/chillMult on struck foes
    const ef2 = f as any;
    const chill = ef2.chillUntil > state.clock ? (ef2.chillMult ?? 1) : 1;
    // C5: tower slow debuff (Frostspire etc.) — 40% speed reduction
    const towerSlow = ef2._slowedUntil > state.clock ? 0.6 : 1;
    // X1: buff aura — allies near a buffer get +speed and +dmg. Restore to
    // baseDmg on expiry, NOT def.dmg — def.dmg would silently wipe the
    // night/network/echo birth scaling off every foe.
    const buffActive = ef2._buffUntil > state.clock;
    const buffSpeedMul = buffActive ? (ef2._buffSpeedMul ?? 1) : 1;
    const baseD = f.baseDmg ?? f.def.dmg;
    f.dmg = buffActive ? Math.round(baseD * (ef2._buffDmgMul ?? 1)) : baseD;
    // C5/X1: stunned foes (Earthshaker) stand frozen
    const stunned = ef2._stunnedUntil > state.clock;
    // X1: tar pits bog foes down
    const tarSlow = ef2._tarUntil > state.clock ? (ef2._tarMul ?? 0.3) : 1;
    let step = f.def.speed * dt * (f.dayMob && !targetPlayer ? 0.4 : 1) * terrain * fear * chill * towerSlow * tarSlow;
    step *= buffSpeedMul;
    if (stunned) step = 0;
    let blocked: Building | null = null;
    const nx = f.x + ux * step, ny = f.y + uy * step;
    if (world.canStand(nx, f.y, 5)) f.x = nx;
    else blocked = this.obstacle(f, ux, 0) ?? blocked;
    if (world.canStand(f.x, ny, 5)) f.y = ny;
    else blocked = this.obstacle(f, 0, uy) ?? blocked;

    if (blocked && !f.dayMob) {
      // something the racket built is in the way — eat it
      if (f.atkT <= 0) {
        f.atkT = f.def.atkCooldown;
        this.damageBuilding(blocked, f.dmg, f);
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

  private damageBuilding(b: Building, dmg: number, attacker?: Foe) {
    const { state, world, views, toast } = this.ctx;
    b.hp -= Math.round(dmg * (CFG.horde.foeDmgToBuildings ?? 1));
    // X1: spiked buildings (Iron Bulwark) bleed their attacker
    const bdef = BUILDINGS.find((d) => d.id === b.type);
    if (attacker && bdef?.thorns && attacker.hp > 0) {
      this.hurt(attacker, bdef.thorns, false);
    }
    if (b.hp > 0) return;
    const def = BUILDINGS.find((d) => d.id === b.type)!;
    const wasAnchor = b.type === 'hall' || b.type === 'waystone';
    state.buildings = state.buildings.filter((x: Building) => x.uid !== b.uid);
    world.reindexBuildings();
    views.removeBuilding(b.uid);
    this.ctx.fire?.onBuildingRemoved(b);
    if (b.type === 'wall') views.refreshWallsAround(b.tx, b.ty);
    toast(`${def.name} destroyed!`, 'bad');
    this.ctx.log?.push('build', `${def.name} destroyed at (${b.tx},${b.ty})`, state.clock);
    if (b.type === 'hall') this.ctx.onHallDestroyed();

    // C2: waystone/hall destruction triggers disconnect decay cascade
    if (wasAnchor) {
      const disco = world.findDisconnected([b]);
      if (disco.length > 0) {
        this.ctx.build?.markDisconnected?.(disco);
        toast(`${disco.length} building(s) cut off — decaying!`, 'bad');
        this.ctx.log?.push('build',
          `${disco.length} buildings disconnected by ${def.name} destruction — decaying`,
          state.clock);
      }
    }
  }

  /** X1: traps fire on foes in radius. Spike/Flame deal damage on a cooldown
   *  (tower rule: no xp/vitals from trap kills); Tar stamps a slow debuff. */
  private updateTraps(dt: number) {
    const { state } = this.ctx;
    if (!this.foes.length) return;
    for (const b of state.buildings) {
      const def = BUILDINGS.find((d) => d.id === b.type);
      if (!def?.trap) continue;
      const eb = b as any;
      eb._trapT = (eb._trapT ?? 0) - dt;
      if (eb._trapT > 0) continue;
      const bx = (b.tx + 0.5) * TILE, by = (b.ty + 0.5) * TILE;
      const r = def.trap.radiusTiles * TILE + 8;
      let fired = false;
      for (const f of [...this.foes]) {
        if (Math.hypot(f.x - bx, f.y - by) > r) continue;
        fired = true;
        if (def.trap.slowMul != null) {
          const ef = f as any;
          ef._tarUntil = state.clock + 2.0;
          ef._tarMul = def.trap.slowMul;
        }
        if (def.trap.damage > 0) this.hurt(f, def.trap.damage, false);
      }
      if (fired) {
        eb._trapT = def.trap.cooldownSec;
        if (def.trap.damage > 0) {
          // Review fix: same 'hit' → 'spark' typo as the projectile-impact
          // site above (PARTICLE_DEFS has no 'hit' entry — this threw on
          // every damaging trap spring).
          this.ctx.particles?.spawn?.('spark', bx, by, 6);
          Sound.play('hit');
          this.ctx.log?.push('combat', `${def.name} springs!`, state.clock);
        }
        // Flame Vent lights the real fire CA
        if (b.type === 'trap_flame') this.ctx.worldCore?.ignite?.(b.tx, b.ty);
      }
    }
  }

  // ---- X1: Behavior helpers ------------------------------------------------

  /** Simple Bresenham-ish line-of-sight check — no opaque tiles between a and b. */
  private hasLineOfSight(ax: number, ay: number, bx: number, by: number): boolean {
    const steps = Math.ceil(Math.hypot(bx - ax, by - ay) / (TILE / 2));
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const tx = Math.floor((ax + (bx - ax) * t) / TILE);
      const ty = Math.floor((ay + (by - ay) * t) / TILE);
      if (!this.ctx.world.canStand(tx * TILE + TILE / 2, ty * TILE + TILE / 2, 5)) return false;
    }
    return true;
  }

  /** Fire a projectile from (fx,fy) toward (tx,ty). Resolved by update(). */
  private spawnProjectile(fx: number, fy: number, tx: number, ty: number, speed: number, dmg: number) {
    const ang = Math.atan2(ty - fy, tx - fx);
    const dist = Math.hypot(tx - fx, ty - fy);
    this.projectiles.push({ x: fx, y: fy, tx, ty, speed, dmg, life: dist / speed, ang, sparkT: 0 });
  }

  /** Exploder detonates — AoE damage to player and nearby buildings.
   *  `remove` only when the foe suicides (contact detonation); a KILLED
   *  exploder detonates too but continues through hurt()'s normal death path
   *  so it still pays out loot/xp/gold like any other kill. */
  private detonateFoe(f: Foe, radiusTiles: number, dmg: number, remove: boolean) {
    const { state } = this.ctx;
    const radiusPx = radiusTiles * TILE;
    if (Math.hypot(state.player.x - f.x, state.player.y - f.y) < radiusPx) {
      this.ctx.damagePlayer(dmg, `${f.def.name} explosion`);
    }
    for (const b of [...state.buildings]) {
      const bx = (b.tx + 0.5) * TILE, by = (b.ty + 0.5) * TILE;
      if (Math.hypot(bx - f.x, by - f.y) < radiusPx) {
        this.damageBuilding(b, Math.round(dmg * 0.6));
      }
    }
    if (remove) {
      this.foes = this.foes.filter((x) => x.uid !== f.uid);
      this.ctx.views.removeFoe(f.uid);
    }
    this.ctx.particles?.spawn?.('death', f.x, f.y, 16);
    Sound.play('hit');
    this.ctx.log?.push('combat', `${f.def.name} detonates!`, state.clock);
  }

  /** Buffer pulses a buff aura — nearby allies get +dmg and +speed for a duration. */
  private pulseBuff(f: Foe, radiusTiles: number, dmgMul: number, speedMul: number) {
    const radiusPx = radiusTiles * TILE;
    const dur = 5; // seconds
    for (const ally of this.foes) {
      if (ally.uid === f.uid) continue;
      if (Math.hypot(ally.x - f.x, ally.y - f.y) > radiusPx) continue;
      const ea = ally as any;
      ea._buffUntil = this.ctx.state.clock + dur;
      ea._buffDmgMul = dmgMul;
      ea._buffSpeedMul = speedMul;
    }
    this.ctx.particles?.spawn?.('spark', f.x, f.y, 6);
  }

  /** Healer pulses — nearby damaged allies regain HP. */
  private pulseHeal(f: Foe, radiusTiles: number, amount: number) {
    const radiusPx = radiusTiles * TILE;
    let healed = 0;
    for (const ally of this.foes) {
      if (ally.uid === f.uid) continue;
      if (ally.hp >= ally.maxHp) continue;
      if (Math.hypot(ally.x - f.x, ally.y - f.y) > radiusPx) continue;
      const before = ally.hp;
      ally.hp = Math.min(ally.maxHp, ally.hp + amount);
      healed += ally.hp - before;
    }
    if (healed > 0) {
      this.ctx.particles?.spawn?.('spark', f.x, f.y, 4);
    }
  }

  /** Summoner spawns minions nearby. */
  private summonMinions(f: Foe, summonId: string, count: number, maxAlive: number) {
    const { state, world, views } = this.ctx;
    // Count existing summons by this summoner
    const existingSpawns = this.foes.filter((x) => (x as any)._summonedBy === f.uid).length;
    if (existingSpawns >= maxAlive) return;
    const toSpawn = Math.min(count, maxAlive - existingSpawns);
    const def = ENEMIES.find((e) => e.id === summonId);
    if (!def) return;
    for (let i = 0; i < toSpawn; i++) {
      const ang = Math.random() * Math.PI * 2;
      const dist = TILE * (1.5 + Math.random());
      const sx = f.x + Math.cos(ang) * dist;
      const sy = f.y + Math.sin(ang) * dist;
      if (!world.canStand(sx, sy, 5)) continue;
      // minions inherit the summoner's birth scaling (night/net/echo),
      // read off its hp ratio — a night-20 broodmother births night-20 gnawers
      const parentMul = f.def.hp > 0 ? f.maxHp / f.def.hp : 1;
      const mini: any = {
        uid: state.nextUid++, def,
        x: sx, y: sy, px: sx, py: sy,
        hp: Math.round(def.hp * parentMul), maxHp: Math.round(def.hp * parentMul),
        dmg: Math.round(def.dmg * parentMul), baseDmg: Math.round(def.dmg * parentMul),
        atkT: 0, telegraphT: 0, animT: Math.random(),
        _summonedBy: f.uid,
      };
      this.foes.push(mini);
      views.addFoe(mini);
    }
    this.ctx.particles?.spawn?.('spark', f.x, f.y, 5);
  }

  /** Find the nearest wall or building within range (for siege enemies). */
  private nearestWallInRange(fx: number, fy: number, rangePx: number): Building | null {
    let best: Building | null = null;
    let bestDist = rangePx;
    for (const b of this.ctx.state.buildings) {
      const bx = (b.tx + 0.5) * TILE, by = (b.ty + 0.5) * TILE;
      const d = Math.hypot(bx - fx, by - fy);
      if (d < bestDist) { bestDist = d; best = b; }
    }
    return best;
  }

  // ---- End X1 behavior helpers ---------------------------------------------

  /** Distance (px) to the nearest campfire, or Infinity if none stand. Used for the spawn-avoid
   * radius and the march-speed hesitation penalty — no pathfinding, just proximity. */
  nearestCampfireDist(x: number, y: number): number {
    const { state } = this.ctx;
    let best = Infinity;
    for (const b of state.buildings) {
      if (b.type !== 'campfire') continue;
      best = Math.min(best, Math.hypot((b.tx + 0.5) * TILE - x, (b.ty + 0.5) * TILE - y));
    }
    return best;
  }

  /** M3: Scatter Cache — spend gold to reduce incoming horde size and pacify bosses.
   *  The network's attention is proportional to your wealth; burning some of it
   *  makes you a less interesting target. Costs scale with current gold. */
  scatterCache(): boolean {
    const { state, toast } = this.ctx;
    const cost = Math.max(60, Math.floor(state.player.gold * 0.18));
    if (state.player.gold < cost) {
      toast(`Need ${cost} gold to scatter your cache (have ${state.player.gold})`, 'bad');
      return false;
    }
    state.player.gold -= cost;
    // reduce incoming horde size for current night
    const reduced = Math.floor(this.toSpawn * 0.45);
    this.toSpawn = Math.max(0, this.toSpawn - reduced);
    // also reduce territory score temporarily for boss aggression calculations
    const s = this.ctx.net?.snap;
    toast(`Cache scattered! −${cost} gold, ${reduced} fewer enemies incoming`, 'good');
    this.ctx.log?.push('economy', `Scattered hoard: −${cost} gold, horde reduced by ${reduced} (${this.toSpawn} remaining)`, state.clock);
    return true;
  }
  hurt(f: Foe, dmg: number, awardXp = true, feedsVitals?: boolean) {
    // feedsVitals defaults to awardXp (backward compat: swings feed both,
    // towers feed neither). Echoes pass awardXp=false, feedsVitals=true.
    const feedVitals = feedsVitals ?? awardXp;
    // N2a: Shelled soak — extra soak until hit 3 times
    const ef = f as any;
    if (ef.echoSoak > 0) {
      const soaked = Math.min(dmg, ef.echoSoak);
      dmg -= soaked;
      ef.echoSoak -= soaked;
      ef.hitCount = (ef.hitCount ?? 0) + 1;
      if (ef.echoSoak <= 0 && ef.specialSkill === 'Shelled') {
        this.ctx.log?.push('combat', `${ef.epithetName ?? f.def.name}'s shell cracks`, this.ctx.state.clock);
      }
    }
    // N2a: Blinker — teleport 2 tiles away the first time hit
    if (ef.specialSkill === 'Blinker' && !ef.blinked && dmg > 0) {
      ef.blinked = true;
      const ang = Math.random() * Math.PI * 2;
      const dist = TILE * 2;
      const nx = f.x + Math.cos(ang) * dist;
      const ny = f.y + Math.sin(ang) * dist;
      if (this.ctx.world.canStand(nx, ny, 5)) { f.x = nx; f.y = ny; }
      this.ctx.log?.push('combat', `${ef.epithetName ?? f.def.name} blinks away!`, this.ctx.state.clock);
    }
    f.hp -= dmg;
    if (f.hp > 0) return;
    // X1: exploders blow up when killed too — AoE first, then the NORMAL death
    // path below still runs, so the kill pays out loot/xp/gold like any other
    if (f.def.behavior?.kind === 'exploder' && f.def.behavior.explodeOnDeath) {
      this.detonateFoe(f, f.def.behavior.explodeRadiusTiles ?? 2, f.def.behavior.explodeDmg ?? f.def.dmg * 2, false);
    }
    // X1: Plague Spire — a poisoned foe's death passes the rot to its packmates
    if (ef._poisonSpread && ef._poisonUntil > this.ctx.state.clock) {
      for (const g of this.foes) {
        if (g.uid === f.uid || Math.hypot(g.x - f.x, g.y - f.y) > 2 * TILE) continue;
        const eg = g as any;
        eg._poisonDps = ef._poisonDps;
        eg._poisonUntil = this.ctx.state.clock + 3;
        // no _poisonSpread on the secondary — one hop, not a chain reaction
      }
    }
    const { state, views, toast } = this.ctx;
    this.foes = this.foes.filter((x) => x.uid !== f.uid);
    views.removeFoe(f.uid);
    Sound.play('enemyDie');

    // S1: only player-swing & echo kills feed vitals — tower kills do NOT
    if (feedVitals) {
      this.ctx.vitals?.onKill?.(!!f.def.boss);
    }
    // W6: track kills for scoreboard
    this.ctx.scoreboard?.onKill?.(!!f.def.boss);

    const [gMin, gMax] = f.def.gold;
    let goldWon = gMin + Math.floor(Math.random() * (gMax - gMin + 1));
    // X1: Miser's Charm — player kills pay out more gold
    if (awardXp && activeEffects(state).has('gold_find')) goldWon = Math.round(goldWon * 1.25);
    state.player.gold += goldWon;
    for (const d of rollLoot(f.def.loot)) {
      invAdd(state, d.id, d.n);
      acquireGear(state, d.id);
      toast(`+${d.n} ${ITEMS[d.id].name}`);
    }
    if (awardXp) {
      const lvl = addXp(state, 'combat', f.def.xp);
      toast(`+${f.def.xp} ${SKILL_NAME['combat']} xp`);
      if (lvl) { toast(`Combat reached level ${lvl}!`, 'good'); this.ctx.log?.push('level', `Combat reached level ${lvl}`, state.clock); }
      if (state.player.equip?.charm) {
        const cl = awardSoulXp(state, 'charm', CFG.soulgear.charmXpPerKill);
        if (cl) { toast(`Your charm drinks the kill — soul level ${cl}!`, 'good'); this.ctx.log?.push('level', `Charm reached soul level ${cl}`, state.clock); }
      }
    }
    this.ctx.log?.push('combat', `Slew a ${f.def.name}`, state.clock);
    // G1: death poof particles at foe location
    this.ctx.particles?.spawn?.('death', f.x, f.y, 12);
  }
}
