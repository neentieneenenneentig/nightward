// Player melee: windup → active (damage resolves once here) → recovery state
// machine, best carried weapon auto-applies, plus watchtower fire, day regen,
// death & respawn.
import { CFG } from '../data/config';
import { BUILDINGS } from '../data/buildings';
import { ENEMIES } from '../data/enemies';
import { AFFIX_POWER } from '../data/elites';
import { armorDef, awardSoulXp, charmRegen, equippedWeaponDmg, gearMod, hall, playerMaxHp, skillLevel } from '../rules';
import { activeEffects, applyVenom, tickVenom } from './effects';
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
  private swingCount = 0;  // per-session swing counter for seeded rng

  constructor(private ctx: any) {}

  update(dt: number) {
    this.swingT -= dt;

    const { state } = this.ctx;
    // daylight heals; night doesn't. X1: 'Charging Bonus' Lens mapping scales it.
    const maxHp = playerMaxHp(state);
    if (!this.ctx.isNight() && state.player.hp < maxHp) {
      const regenMul = this.ctx.net?.getGameValue?.('regenRate') ?? 1;
      // B3.a: the Loom's regenPct ranks had no consumer — every 'Hearty' rank a
      // player bought did nothing at all.
      const loomRegenMul = this.ctx.loom?.getRegenMul?.() ?? 1;
      // C4: 'regen_boost' — the Tideculler relic and the 'of Mending' suffix.
      // Registered since C4, consumed by nothing until now: its handler returned
      // a number and no caller existed to add it to anything.
      const fxRegenMul = activeEffects(state).has('regen_boost')
        ? 1 + CFG.itemEffects.regenBoostPct : 1;
      state.player.hp = Math.min(maxHp, state.player.hp + (CFG.player.regenPerSec + charmRegen(state)) * regenMul * loomRegenMul * fxRegenMul * dt);
    }
    this.updateVenom(dt);
    this.updateAuras(dt);
    this.updateTowers(dt);
    this.updatePhase(dt);
  }

  /** A2 Venomous: the stacking bleed a Venomous foe leaves in you.
   *
   *  Deliberately NOT routed through damagePlayer(). Three reasons, and all
   *  three are the difference between a DoT and a second attack:
   *
   *  1. Armour must not soften it. Venom is the affix that answers a heavily
   *     armoured player, and a flat -armorDef() per tick would make it round to
   *     the 1-damage floor against exactly the build it exists to threaten.
   *  2. Dodge cannot slip it, thorns cannot reflect it, and soul-gear must not
   *     level off it — there is nobody swinging.
   *  3. It has to be able to kill you. So the death check below is the same one
   *     damagePlayer runs, called explicitly rather than duplicated: venom that
   *     took you to 0 and left you standing would be a bug you only find by
   *     watching a corpse walk.
   *
   *  God mode is honoured, matching every other damage path. */
  private updateVenom(dt: number) {
    const { state } = this.ctx;
    if (state.gameOver || state.god) return;
    const tick = tickVenom(state, dt);
    if (tick <= 0) return;
    state.player.hp -= tick;
    this.ctx.views?.addHitFlash?.(state.player.x, state.player.y - 10);
    if (state.player.hp <= 0) {
      this.ctx.log?.push('death', 'The venom finishes what it started', state.clock);
      this.fall();
    }
  }

  /** C4: 'fire_aura' — the Cindermaw relic and the 'of the Ember' suffix.
   *
   *  Deliberately a standing tick rather than something bolted to the swing: an
   *  aura you have to attack to benefit from is not an aura, and the fiction
   *  ("the ground near you smoulders") is about presence. Damage is rolled once
   *  per tick, not per foe, so a tick against six foes is one roll and one
   *  number — the same rule the Echo patches follow. */
  private auraT = 0;
  private updateAuras(dt: number) {
    const { state } = this.ctx;
    if (state.gameOver) return;
    if (!activeEffects(state).has('fire_aura')) { this.auraT = 0; return; }
    this.auraT += dt;
    if (this.auraT < CFG.itemEffects.fireAuraSec) return;
    this.auraT = 0;
    const px = state.player.x, py = state.player.y;
    const r = CFG.itemEffects.fireAuraTiles * TILE;
    const dmg = Math.max(1, Math.round(CFG.itemEffects.fireAuraDmg));
    let struck = 0;
    for (const f of [...(this.ctx.hordes?.foes ?? [])] as Foe[]) {
      if (f.hp <= 0) continue;
      if (Math.hypot(f.x - px, f.y - py) > r + f.def.art.size / 2) continue;
      // tower rule: no combat xp (you did not swing), but it feeds vitals —
      // the same terms the Echoes fire on
      this.ctx.hordes.hurt(f, dmg, false, true);
      this.ctx.views?.addHitFlash?.(f.x, f.y);
      struck++;
    }
    if (struck) {
      this.ctx.views?.addPulseRing?.(px, py, r, 0xc85a2e);
      this.ctx.particles?.spawn?.('ember', px, py - 6, 3);
    }
  }

  /** Windup/active/recovery durations, sped up by the weapon's soul level (floored)
   *  and the Loom's swingSpeedPct. */
  private envelope() {
    const lvl = this.ctx.state.player.soulItems?.weapon?.level ?? 1;
    const { attackSpeedPerSoulLevel: k, attackSpeedFloor: floor } = CFG.combat;
    const loomMods = this.ctx.loom?.ensureMods?.();
    const loomMul = loomMods ? (1 + (loomMods.swingSpeedPct ?? 0) / 100) : 1;
    // A1: 'Heavy' trades swing speed for flat damage; 'of Frailty' is a curse.
    // Multiplies INTO the same denominator as the soul level and the Loom, so
    // the attackSpeedFloor still caps the whole stack — an affix cannot open a
    // hole in a clamp that three other systems respect.
    const gearMul = gearMod(this.ctx.state, 'swingSpeed');
    const mult = Math.max(floor, 1 / ((1 + lvl * k) * loomMul * gearMul));
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

  /** Player pressed attack: starts windup from idle, restarts windup with damage
   * during windup/active (spam-clicking = rapid single-target DPS at the cost of
   * never reaching recovery), buffers one swing during recovery. */
  attack() {
    if (this.ctx.state.gameOver) return;
    this.ctx.vitals?.markAction?.(); // S1: attacking is not idle
    if (this.phase === 'idle') this.startSwing();
    else if (this.phase === 'recovery') this.queued = true;
    else this.restartSwing(); // windup or active — restart with damage
  }

  /** Restart the swing from windup, dealing damage immediately. Spam-clicking
   * during windup/active lets you chain rapid hits at the cost of never reaching
   * recovery (you stay locked in the swing animation). Rate-capped at
   * CFG.combat.restartMinIntervalSec to prevent unbounded autoclicker DPS. */
  private restartSwing() {
    const { state } = this.ctx;
    // Rate cap: enforce minimum interval between restarts
    const lastRestart = (this as any)._lastRestartClock ?? -999;
    if (state.clock - lastRestart < CFG.combat.restartMinIntervalSec) return;
    (this as any)._lastRestartClock = state.clock;

    const env = this.envelope();
    // Deal damage right now (the "redaming" from the start of the swing)
    this.resolveHit();
    // Reset to windup so the next phase transition will deal damage again
    this.setPhase('windup');
    this.phaseT = env.windup;
    // Re-roll damage for the new swing (seeded rng, no extra HTTP beacon —
    // probeAction is skipped on restart to avoid beacon spam)
    this.swingCount++;
    const swingSeed = (state.seed ?? 1234) ^ (this.swingCount * 0x9e3779b9);
    const rng = (() => {
      let s = swingSeed >>> 0;
      return () => {
        s = (s + 0x6d2b79f5) | 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    })();
    this.ctx.net?.rollDamageMul?.(rng);
    // NOTE: no probeAction('attack') on restart — the beacon fired on the
    // initial swing; restarts reuse the same connection window
    Sound.play('windup');
  }

  private startSwing() {
    const env = this.envelope();
    this.setPhase('windup');
    this.phaseT = env.windup;
    this.swingAngle = this.ctx.player.aimAngle ?? FACING_ANGLE[this.ctx.player.facing];
    Sound.play('windup');
    // D5: per-swing seeded-rng damage roll (lightning bands)
    this.swingCount++;
    const swingSeed = (this.ctx.state.seed ?? 1234) ^ (this.swingCount * 0x9e3779b9);
    const rng = (() => {
      let s = swingSeed >>> 0;
      return () => {
        s = (s + 0x6d2b79f5) | 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    })();
    this.ctx.net?.rollDamageMul?.(rng);
    // Fire attack echo volley
    this.ctx.net?.probeAction?.('attack');
  }

  /** Damage resolves once, on the windup → active transition. */
  private resolveHit() {
    const { state, player, hordes, views } = this.ctx;

    const fa = player.aimAngle ?? FACING_ANGLE[player.facing];
    this.swingT = 0.13;
    this.swingAngle = fa;

    // Damage = base × sync pulse multiplier × resonance crit (if any)
    let dmgMul = this.ctx.net?.lastSwingDmgMul ?? 1.0;
    const resonance = this.ctx.net?.consumeResonance?.() ?? null;
    const critMul = resonance ? resonance.multiplier : 1.0;

    // C3: Loom D5 roll transforms (dmgRollFloor + Glass Echo keystone)
    const loomMods = this.ctx.loom?.ensureMods?.();
    if (loomMods) {
      const floorAdd = loomMods.dmgRollFloor ?? 0;
      // B3.a: this used to carry its own copy of the Glass Echo remap, identical to
      // loom.getDmgRollTransform() — which nothing called. Two copies of one rule
      // is the shape that produced the levelOf drift bug (§17): the copies agreed
      // right up until one of them was edited.
      dmgMul = this.ctx.loom.getDmgRollTransform(dmgMul);
      // dmgRollFloor: shift the floor up (additive to D5 band minimum)
      dmgMul = Math.max(0.30, Math.min(1.50, dmgMul + floorAdd));
    }

    const totalMul = dmgMul * critMul;
    // SR7: crit weight. A resonance crit always reads as heavy; short of that,
    // a hit's severity is how far the roll climbed above 1x — the SAME number
    // that already decided the damage, so a boss fight and a trash pack agree
    // on what "heavy" looks like without a second, HP-relative calculation.
    const severity = resonance ? 1 : Math.min(1, Math.max(0, (totalMul - 1) * 2));

    const baseDmg = CFG.player.baseDmg + equippedWeaponDmg(state) + Math.floor(skillLevel(state, 'combat') / CFG.combat.dmgBonusPerLevel);
    // C3: Loom melee damage modifier and arc width
    const loomDmgMul = loomMods ? (1 + (loomMods.meleeDmgPct ?? 0) / 100) : 1;
    // A5: The Long Night weave — flat +25%, but only after dusk. The getter
    // returns 1 by day, so a daylight swing is bit-identical to pre-A5.
    // SR2: an evolved weapon's bonus rides the SAME chain — see
    // WeaveSystem.evolvedDmgMul.
    const weaveDmgMul = (this.ctx.weaves?.nightDmgMul?.() ?? 1) * (this.ctx.weaves?.evolvedDmgMul?.() ?? 1);
    const dmg = Math.round(baseDmg * totalMul * loomDmgMul * weaveDmgMul);
    const loomArcMul = loomMods ? (1 + (loomMods.arcWidthPct ?? 0) / 100) : 1;
    const arc = (CFG.combat.arcDeg * Math.PI * loomArcMul) / 180;
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
    let dealtTotal = 0; // X1: lifesteal reads the swing's total damage dealt
    const fx = activeEffects(state);
    const hitLines: string[] = [];
    for (const f of [...hordes.foes] as Foe[]) {
      const d = inArc(f.x, f.y, CFG.player.meleeRange + f.def.art.size / 2);
      if (d < 0) continue;
      // tiny knockback sells the hit
      const kx = f.x + (f.x - cx) / (d || 1) * 6, ky = f.y + (f.y - cy) / (d || 1) * 6;
      if (this.ctx.world.canStand(kx, ky, 5)) { f.x = kx; f.y = ky; }
      const hpBefore = f.hp;
      // X1: on-hit item effects — chill slows, fire lights the real CA
      if (fx.has('chill_on_hit')) {
        const ef = f as any;
        ef.chillUntil = state.clock + 2.0;
        ef.chillMult = 0.65;
      }
      if (fx.has('fire_on_hit') && Math.random() < 0.3) {
        this.ctx.worldCore?.ignite?.(Math.floor(f.x / TILE), Math.floor(f.y / TILE));
      }
      hordes.hurt(f, dmg);
      dealtTotal += Math.min(dmg, hpBefore);
      // X1: chain_on_kill — the killing blow arcs to the nearest other foe
      if (fx.has('chain_on_kill') && hpBefore > 0 && f.hp <= 0) {
        let arcF: Foe | null = null, arcD = 3 * TILE;
        for (const g of hordes.foes as Foe[]) {
          if (g.uid === f.uid) continue;
          const gd = Math.hypot(g.x - f.x, g.y - f.y);
          if (gd < arcD) { arcF = g; arcD = gd; }
        }
        if (arcF) {
          views.addShot(f.x, f.y - 8, arcF.x, arcF.y - 8);
          hordes.hurt(arcF, Math.round(dmg * 0.5));
        }
      }
      views.addHitFlash(f.x, f.y);
      // SR7: a floating number and a spray of blood, both scaled by the same
      // severity the damage roll already produced.
      this.ctx.floaters?.spawnDamage?.(f.x, f.y - 14, Math.min(dmg, hpBefore), severity, this.ctx.cam);
      this.ctx.particles?.spawn?.('blood', f.x, f.y - 6, 3 + Math.round(severity * 4), fa);
      this.ctx.scoreboard?.onDamageDealt?.(Math.min(dmg, hpBefore));
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
      this.ctx.floaters?.spawnDamage?.(b.x, b.y - size / 2, Math.min(dmg, hpBefore), severity, this.ctx.cam);
      this.ctx.particles?.spawn?.('blood', b.x, b.y - size / 4, 3 + Math.round(severity * 4), fa);
      this.ctx.scoreboard?.onDamageDealt?.(Math.min(dmg, hpBefore));
      landed = true;
      hitLines.push(`${b.name} for ${Math.min(dmg, hpBefore)} (${Math.max(0, b.hp)}/${b.maxHp} hp left)`);
    }
    if (landed) {
      // X1: lifesteal — Void gear drinks a share of the damage dealt
      if (fx.has('lifesteal') && dealtTotal > 0 && state.player.hp < playerMaxHp(state)) {
        state.player.hp = Math.min(playerMaxHp(state), state.player.hp + dealtTotal * 0.12);
      }
      Sound.play('hit');
      const net = this.ctx.net;
      const mulInfo = totalMul !== 1.0
        ? ` [${totalMul.toFixed(2)}×${resonance ? ' ⚡RESONANCE ' + resonance.label : ''} ← roll ${dmgMul.toFixed(2)}×, center ${(net?.lastSwingCenter ?? 1).toFixed(2)} ± ${(net?.lastSwingHalf ?? 0).toFixed(2)}]`
        : '';
      this.ctx.log?.push('combat', `Hit ${hitLines.join('; ')}${mulInfo}`, state.clock);
      // M3.6v2: Resonance crit floaters + particles
      if (resonance) {
        this.ctx.floaters?.spawnInfo?.(cx, cy - 30, `⚡RESONANCE ${resonance.label}`, '#ffcc00', this.ctx.cam);
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
      // G2: screen shake on hit (stronger on crits)
      this.ctx.cam.shake?.(resonance ? 5 : 3);
      // SR7: hit-stop, the same beat shake already marks
      this.ctx.requestHitstop?.(resonance ? CFG.combat.hitstopCritMs : CFG.combat.hitstopMs);
    } else {
      this.ctx.log?.push('combat', 'Swung and missed', state.clock);
    }
  }

  private updateTowers(dt: number) {
    const { state, hordes, views, worldbosses } = this.ctx;
    const bosses: WorldBoss[] = worldbosses ? worldbosses.alive() : [];
    if (!hordes.foes.length && !bosses.length) return;

    // C5: compute aura bonuses from Warbanner-type towers
    let auraDmgMul = 1.0;
    let auraRangeAdd = 0;
    for (const b of state.buildings) {
      const def = BUILDINGS.find((d) => d.id === b.type);
      if (!def?.aura) continue;
      const ax = (b.tx + 0.5) * TILE, ay = (b.ty + 0.5) * TILE;
      const aRange = def.aura.radiusTiles * TILE;
      // Check if any other tower is within aura range (simplified: global aura)
      auraDmgMul = Math.max(auraDmgMul, def.aura.dmgMul ?? 1);
      auraRangeAdd = Math.max(auraRangeAdd, def.aura.rangeAdd ?? 0);
    }

    // X1: Shrines buff towers standing within their radius
    const shrines: { x: number; y: number; r: number; dmgAdd: number; rangeAdd: number }[] = [];
    for (const b of state.buildings) {
      const def = BUILDINGS.find((d) => d.id === b.type);
      if (!def?.shrine) continue;
      shrines.push({
        x: (b.tx + 0.5) * TILE, y: (b.ty + 0.5) * TILE,
        r: def.shrine.radiusTiles * TILE,
        dmgAdd: def.shrine.dmgAdd ?? 0, rangeAdd: def.shrine.rangeAdd ?? 0,
      });
    }

    for (const b of state.buildings) {
      const def = BUILDINGS.find((d) => d.id === b.type);
      if (!def?.tower) continue;
      const t = (this.towerT.get(b.uid) ?? 0) - dt;
      if (t > 0) { this.towerT.set(b.uid, t); continue; }

      const bx = (b.tx + 0.5) * TILE, by = (b.ty + 0.2) * TILE;
      let shrineDmg = 0, shrineRange = 0;
      for (const s of shrines) {
        if (Math.hypot(bx - s.x, by - s.y) <= s.r) {
          shrineDmg = Math.max(shrineDmg, s.dmgAdd);
          shrineRange = Math.max(shrineRange, s.rangeAdd);
        }
      }
      // B3.a: towerDmgPct and towerRange had no consumers, so Siege Engineer,
      // Longshot, Keep Lord and Stone Mason were placebo — and Deep Roots' "towers
      // +1 range" was never wired at all. Both fold in here, the one place range
      // and damage are computed for every tower role below.
      const loomRangeAdd = this.ctx.loom?.getTowerRangeAdd?.() ?? 0;
      const loomDmgMul = this.ctx.loom?.getTowerDmgMul?.() ?? 1;
      const range = (def.tower.rangeTiles + auraRangeAdd + shrineRange + loomRangeAdd) * TILE;
      const dmg = Math.round((Math.round(def.tower.dmg * auraDmgMul) + shrineDmg) * loomDmgMul);

      // C5: sniper towers prefer highest-HP target (execute priority)
      if (def.towerRole === 'sniper') {
        let bestFoe: Foe | null = null, bestBoss: WorldBoss | null = null, bestHp = -Infinity;
        for (const f of hordes.foes as Foe[]) {
          const d = Math.hypot(f.x - bx, f.y - by);
          if (d < range && f.hp > bestHp) { bestFoe = f; bestBoss = null; bestHp = f.hp; }
        }
        for (const wb of bosses) {
          const d = Math.hypot(wb.x - bx, wb.y - by);
          if (d < range && wb.hp > bestHp) { bestBoss = wb; bestFoe = null; bestHp = wb.hp; }
        }
        if (bestFoe) {
          this.towerT.set(b.uid, def.tower.cooldown);
          views.addShot(bx, by, bestFoe.x, bestFoe.y - bestFoe.def.art.size / 2);
          // C5: Deadeye execute — insta-kill below 30% HP
          const execDmg = def.id === 'tower_deadeye' && bestFoe.hp / bestFoe.maxHp < 0.3
            ? bestFoe.hp : dmg;
          hordes.hurt(bestFoe, execDmg, false);
        } else if (bestBoss) {
          this.towerT.set(b.uid, def.tower.cooldown);
          views.addShot(bx, by, bestBoss.x, bestBoss.y);
          worldbosses.hurt(bestBoss, dmg, false);
        }
        continue;
      }

      // Default: closest target
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
        hordes.hurt(bestFoe, dmg, false);

        // C5: Splash — damage nearby foes too
        if (def.towerRole === 'splash') {
          const splashRadius = 2 * TILE;
          const splashDmg = Math.round(dmg * 0.5);
          for (const f2 of hordes.foes as Foe[]) {
            if (f2.uid === bestFoe.uid) continue;
            if (Math.hypot(f2.x - bestFoe.x, f2.y - bestFoe.y) < splashRadius) {
              hordes.hurt(f2, splashDmg, false);
            }
          }
          // Also ignite the ground for fire-based splash towers
          if (def.id === 'tower_inferno' || def.id === 'tower_forge') {
            this.ctx.worldCore?.ignite?.(bestFoe.x / TILE | 0, bestFoe.y / TILE | 0);
          }
        }

        // C5: Slow — apply slow debuff
        if (def.towerRole === 'slow') {
          (bestFoe as any)._slowedUntil = this.ctx.state.clock + 2.0; // 2s slow
        }

        // X1: Chain — lightning leaps to further foes, damage decaying per jump
        if (def.towerRole === 'chain' && def.chain) {
          const hit = new Set<number>([bestFoe.uid]);
          let from = bestFoe, arcDmg = dmg;
          for (let j = 0; j < def.chain.jumps; j++) {
            arcDmg = Math.max(1, Math.round(arcDmg * def.chain.falloff));
            let next: Foe | null = null, nd = 3.5 * TILE;
            for (const g of hordes.foes as Foe[]) {
              if (hit.has(g.uid)) continue;
              const gd = Math.hypot(g.x - from.x, g.y - from.y);
              if (gd < nd) { next = g; nd = gd; }
            }
            if (!next) break;
            hit.add(next.uid);
            views.addShot(from.x, from.y - 8, next.x, next.y - 8);
            hordes.hurt(next, arcDmg, false);
            from = next;
          }
        }

        // X1: Poison — DoT stamped on the target; hordes.updateFoe ticks it
        if (def.towerRole === 'poison' && def.poisonFx) {
          const ef = bestFoe as any;
          const clock = this.ctx.state.clock;
          const stacks = Math.min(def.poisonFx.maxStacks, (ef._poisonUntil > clock ? (ef._poisonStacks ?? 1) : 0) + 1);
          ef._poisonStacks = stacks;
          ef._poisonDps = Math.max(1, Math.round(dmg * def.poisonFx.dpsFrac)) * stacks;
          ef._poisonUntil = clock + def.poisonFx.durSec;
          if (def.poisonFx.spreadOnDeath) ef._poisonSpread = true;
        }

        // X1: Stun — target frozen in place
        if (def.towerRole === 'stun' && def.stunSec) {
          (bestFoe as any)._stunnedUntil = this.ctx.state.clock + def.stunSec;
        }
      } else if (bestBoss) {
        this.towerT.set(b.uid, def.tower.cooldown);
        views.addShot(bx, by, bestBoss.x, bestBoss.y);
        worldbosses.hurt(bestBoss, dmg, false);
      } else {
        this.towerT.set(b.uid, 0);
      }
    }
  }

  /** Enemy → player damage, plus death handling. `sourceFoe` is the melee
   *  attacker, when one exists — Ironwake reflects only against a body, not a
   *  fire or a hurled bolt. */
  damagePlayer(dmg: number, source?: string, sourceFoe?: Foe) {
    const { state, player, toast } = this.ctx;
    if (state.gameOver) return;
    if (state.god) { this.ctx.log?.push('combat', `${source ?? 'Something'} hits you for 0 (god mode)`, state.clock); return; }
    // X1: dodge — Warding gear slips the hit entirely, sometimes
    if (activeEffects(state).has('dodge') && Math.random() < 0.12) {
      this.ctx.log?.push('combat', `${source ?? 'Something'} strikes — you slip aside`, state.clock);
      return;
    }
    let taken = Math.max(1, dmg - armorDef(state)); // armor softens, never fully negates
    // S1: resolve-zero = +50% damage taken
    // B3.a: ...and the Loom's armorPct ranks soften it, diminishing so they can
    // never reach immunity. This key had no consumer, so 'Iron Resolve' and
    // 'Bulwark' were both placebo.
    taken = Math.round(taken
      * (this.ctx.vitals?.getDmgTakenMult?.() ?? 1.0)
      * (this.ctx.loom?.getIncomingDmgMul?.() ?? 1.0));
    taken = Math.max(1, taken);   // the floor survives the multipliers
    state.player.hp -= taken;
    player.flash();
    Sound.play('hurt');
    this.ctx.cam.shake?.(Math.min(11, 3 + taken * 0.25));
    this.ctx.log?.push('combat', `${source ?? 'Something'} hits you for ${taken} (${Math.max(0, Math.ceil(state.player.hp))}/${playerMaxHp(state)} hp left)`, state.clock);
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
    // C4: 'thorns_reflect' — the Thornwarden relic and the 'of the Thorn' suffix.
    // The ONLY implementation of thorns lived inside the registered handler, and
    // nothing ever dispatched it, so both were placebo from C4 until now. A5's
    // Ironwake was written self-contained rather than on top of it; the two now
    // stack deliberately, and each is announced separately in the log so a
    // playtest can tell which one is doing the work.
    if (sourceFoe && taken > 0 && activeEffects(state).has('thorns_reflect')) {
      const back = Math.max(1, Math.round(taken * CFG.itemEffects.thornsPct));
      this.ctx.hordes?.hurt?.(sourceFoe, back, false, true);
      this.ctx.views?.addHitFlash?.(sourceFoe.x, sourceFoe.y);
      this.ctx.log?.push('combat', `Thorns bite back for ${back}`, state.clock);
    }
    // A5: Ironwake — melee attackers take a share of their own hit back, and the
    // reflected damage stuns them. Applied before the death check so a lethal hit
    // still exchanges. Reads the weave so a run without it pays only a null check.
    const reflect = this.ctx.weaves?.reflect?.();
    if (reflect && sourceFoe && taken > 0) {
      const back = Math.max(1, Math.round(taken * reflect.pct));
      sourceFoe.hp -= back;
      const ef = sourceFoe as any;
      ef._stunnedUntil = Math.max(ef._stunnedUntil ?? 0, state.clock + reflect.stunSec);
      this.ctx.log?.push('weave', `Ironwake — ${back} back at ${sourceFoe.def?.name ?? 'the attacker'}, stunned for ${reflect.stunSec}s`, state.clock);
    }

    // ---- A2: the two affixes that fire on a landed hit --------------------
    //
    // Both hang off `sourceFoe`, and both are read AFTER `taken` is final, so
    // they compose with armour, the Resolve multiplier and the Loom rather than
    // with the raw number the foe swung. A Leeching foe heals for a share of
    // what it actually took off you — which means armour is a counter to
    // Leeching, and that is the correct answer to "what do I do about it".
    const eAff = (sourceFoe as any)?.elite?.has as Set<string> | undefined;
    if (eAff && taken > 0) {
      if (eAff.has('leeching')) {
        const back = Math.max(1, Math.round(taken * AFFIX_POWER.leechPct));
        const healed = Math.min(back, sourceFoe!.maxHp - sourceFoe!.hp);
        if (healed > 0) {
          sourceFoe!.hp += healed;
          this.ctx.views?.addPulseRing?.(sourceFoe!.x, sourceFoe!.y, 14, 0xc85a7a);
          this.ctx.log?.push('combat', `${sourceFoe!.def.name} drinks ${healed} back`, state.clock);
        }
      }
      if (eAff.has('venomous')) applyVenom(state);
    }

    if (state.player.hp > 0) return;
    this.fall();
  }

  /** You went down. Extracted from damagePlayer() when A2's venom needed to be
   *  able to kill without being an attack: the alternative was calling
   *  damagePlayer(0), and damagePlayer floors every hit at 1 — so "check if the
   *  venom finished me" would itself have dealt a point of damage, and rolled
   *  dodge, and fired thorns at nobody. */
  private fall() {
    const { state, player, toast } = this.ctx;
    // SR3: Fallen. Once the Reckoning is active, going down ends the run
    // instead of scattering you — the field is thinned to exactly one real
    // threat for this reason, and a death here is the wall the plan calls
    // for, not a survivable setback like every other death in the game.
    if (state.reckoning?.active) {
      this.ctx.onReckoningDeath?.();
      return;
    }
    // down — drop gold and the connection scatters you far into the wilds
    const lost = Math.floor(state.player.gold * CFG.player.deathGoldLossPct);
    state.player.gold -= lost;
    state.player.hp = playerMaxHp(state);
    const spot = this.randomRespawn();
    state.player.x = spot.x;
    state.player.y = spot.y;
    player.teleport(spot.x, spot.y);
    // S1: death scatters your vitals too — reset to 50/50
    this.ctx.vitals?.onRespawn?.();
    // A2: and it clears the venom. Respawning at full hp while still carrying
    // five stacks would mean the affix follows you across a death and a
    // teleport to the far side of the map, which is not attrition, it is a
    // punishment with no counterplay left in it.
    state._venomStacks = 0;
    state._venomUntil = 0;
    state._venomAcc = 0;
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
    // N4.7 Homeward: how far the thread throws you is how good your route is at
    // putting packets where it meant to. The scatter was always the connection
    // dropping you somewhere else — speed-of-light efficiency is finally a
    // number for how badly. 1.0 wherever the reading is absent, so a colo that
    // is not in the table plays the authored distance exactly.
    const homeward = this.ctx.net?.getGameValue?.('homeward') ?? 1;
    for (let i = 0; i < 80; i++) {
      const ang = Math.random() * Math.PI * 2;
      const dist = (mn + Math.random() * (mx - mn)) * TILE * homeward;
      const x = cx + Math.cos(ang) * dist, y = cy + Math.sin(ang) * dist;
      if (world.canStand(x, y)) return { x, y };
    }
    return { x: cx, y: cy };
  }
}
