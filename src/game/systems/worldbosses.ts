// World bosses = the domain lords made flesh. A handful of them stalk the
// overworld at once. Left alone they drift around their home domain; once your
// network grows loud enough (territory) — or night falls — they turn and
// converge on your hall, phasing across any terrain like living shadows.
// Slain, they re-form deeper in the network, stronger (Diablo-GR style).
import { CFG } from '../data/config';
import { ENEMIES, type EnemyDef } from '../data/enemies';
import { addXp, awardSoulXp, hall, rollLoot, territoryScore } from '../rules';
import type { WorldBoss } from '../state';
import { TILE } from '../world/worldgen';
import { REGION, domainAtRegion, regionCenterPx } from '../world/domains';
import { hash2 } from '../../engine/rng';
import { Sound } from '../../engine/audio';
import { levelUpFlourish } from './flourish';

const defOf = (id: string): EnemyDef => ENEMIES.find((e) => e.id === id)!;

export class WorldBossSystem {
  private warned = new Set<number>();

  constructor(private ctx: any) {
    if (!this.ctx.state.worldBosses.length) this.seedBosses();
    else for (const b of this.ctx.state.worldBosses) if (b.reviveAt === 0) this.ctx.views.addBoss(b);
  }

  /** Alive bosses (not currently re-forming) — combat targets these. */
  alive(): WorldBoss[] { return this.ctx.state.worldBosses.filter((b: WorldBoss) => b.reviveAt === 0); }

  /** Distance (tiles) to the nearest hunting boss, or null — drives music & fog. */
  nearestThreatTiles(): number | null {
    const p = this.ctx.state.player;
    let best: number | null = null;
    for (const b of this.alive()) {
      if (!b.hunting) continue;
      const d = Math.hypot(b.x - p.x, b.y - p.y) / TILE;
      if (best == null || d < best) best = d;
    }
    return best;
  }

  // ---- spawning / reviving ------------------------------------------------
  private seedBosses() {
    const { state } = this.ctx;
    const ring = CFG.worldBoss.spawnRing;
    const cands: [number, number][] = [];
    for (let gx = -ring; gx <= ring; gx++)
      for (let gy = -ring; gy <= ring; gy++)
        if (Math.max(Math.abs(gx), Math.abs(gy)) === ring) cands.push([gx, gy]);
    cands.sort((a, b) => hash2(a[0], a[1], state.seed ^ 0xb055) - hash2(b[0], b[1], state.seed ^ 0xb055));
    for (let i = 0; i < Math.min(CFG.worldBoss.count, cands.length); i++) {
      const [gx, gy] = cands[i];
      this.makeBoss(gx, gy, Math.max(1, domainAtRegion(gx, gy, state.seed).danger));
    }
  }

  private makeBoss(gx: number, gy: number, level: number) {
    const { state } = this.ctx;
    const dom = domainAtRegion(gx, gy, state.seed);
    const def = defOf(dom.lord.bossId);
    const [cx, cy] = regionCenterPx(gx, gy);
    const maxHp = this.hpFor(level);
    const b: WorldBoss = {
      uid: state.nextUid++, defId: def.id, lordId: dom.lord.id,
      name: `${def.name} of ${dom.name}`,
      x: cx, y: cy, px: cx, py: cy,
      hp: maxHp, maxHp, dmg: this.dmgFor(level), level,
      atkT: 0, telegraphT: 0, animT: Math.random(), hunting: false, provokedUntil: 0, reviveAt: 0, homeGx: gx, homeGy: gy,
    };
    state.worldBosses.push(b);
    this.ctx.views.addBoss(b);
  }

  private hpFor(level: number) {
    return Math.round(CFG.worldBoss.hpBase * Math.pow(CFG.worldBoss.hpPerLevel, level - 1)
      + CFG.worldBoss.hpPerTerritory * territoryScore(this.ctx.state));
  }
  private dmgFor(level: number) {
    return Math.round(CFG.worldBoss.dmgBase * Math.pow(CFG.worldBoss.dmgPerLevel, level - 1));
  }

  private revive(b: WorldBoss) {
    const { state } = this.ctx;
    b.level += CFG.worldBoss.levelPerRevive;
    const ringR = b.level + CFG.worldBoss.spawnRing;
    const ang = hash2(b.uid, b.level, state.seed) * Math.PI * 2;
    const gx = Math.round(Math.cos(ang) * ringR), gy = Math.round(Math.sin(ang) * ringR);
    const dom = domainAtRegion(gx, gy, state.seed);
    const def = defOf(dom.lord.bossId);
    const [cx, cy] = regionCenterPx(gx, gy);
    b.defId = def.id; b.lordId = dom.lord.id; b.name = `${def.name} of ${dom.name}`;
    b.homeGx = gx; b.homeGy = gy;
    b.x = b.px = cx; b.y = b.py = cy;
    b.maxHp = this.hpFor(b.level); b.hp = b.maxHp; b.dmg = this.dmgFor(b.level);
    b.reviveAt = 0; b.hunting = false; b.provokedUntil = 0; b.atkT = 0; b.telegraphT = 0;
    this.warned.delete(b.uid);
    this.ctx.views.addBoss(b);
    this.ctx.toast(`${b.name} re-forms in the deep dark, stronger.`, 'bad');
    this.ctx.log?.push('boss', `${b.name} re-forms, stronger (level ${b.level})`, this.ctx.state.clock);
  }

  // ---- per-step AI --------------------------------------------------------
  update(dt: number) {
    const { state } = this.ctx;
    const p = state.player;
    const hallB = hall(state);
    const terr = territoryScore(state);
    // B3.a: Night Market advertises "gold rouses bosses at HALF the threshold".
    // loom.getBossWakeGold() has existed since C3 and was called by nothing, so
    // the keystone's second clause did not exist in the game.
    const wakeGold = this.ctx.loom?.getBossWakeGold?.() ?? CFG.worldBoss.wakeGold;
    const goldRoused = state.player.gold >= wakeGold;
    const territoryRoused = terr >= CFG.worldBoss.wakeTerritory || this.ctx.isNight() || goldRoused;

    for (const b of state.worldBosses as WorldBoss[]) {
      if (b.reviveAt > 0) { if (state.clock >= b.reviveAt) this.revive(b); continue; }
      b.px = b.x; b.py = b.y; b.animT += dt; b.atkT -= dt;
      const def = defOf(b.defId);

      // committed to an already-telegraphed hit — frozen mid-swing; only the
      // final distance check (vs. the player specifically) decides hit/whiff
      if (b.telegraphT > 0) {
        b.telegraphT -= dt;
        if (b.telegraphT <= 0) {
          const dPlyNow = Math.hypot(p.x - b.x, (p.y - 10) - b.y);
          if (dPlyNow < CFG.worldBoss.attackReachPx + CFG.combat.telegraphSlackPx) {
            this.ctx.damagePlayer(b.dmg, b.name);
            this.ctx.cam.shake?.(7);
          } else {
            this.ctx.log?.push('boss', `${b.name} lunges and misses`, state.clock);
          }
        }
        this.checkWarning(b, Math.hypot(p.x - b.x, p.y - b.y) / TILE);
        continue;
      }

      // roused by territory/night, OR by having just been hit — a fight always gets fought back
      const roused = territoryRoused || b.provokedUntil > state.clock;

      // pick a target: hunt you/your hall when roused, otherwise drift at home
      let tx: number, ty: number;
      if (roused) {
        b.hunting = true;
        if (hallB) {
          const hx = (hallB.tx + 0.5) * TILE, hy = (hallB.ty + 0.9) * TILE;
          const dHall = Math.hypot(hx - b.x, hy - b.y);
          const dPly = Math.hypot(p.x - b.x, (p.y - 10) - b.y);
          if (dPly < dHall * 0.8) { tx = p.x; ty = p.y - 10; } else { tx = hx; ty = hy; }
        } else {
          tx = p.x; ty = p.y - 10; // no hall yet — you're the only thing worth converging on
        }
      } else {
        b.hunting = false;
        const [cx, cy] = regionCenterPx(b.homeGx, b.homeGy);
        tx = cx + Math.cos(b.animT * 0.3 + b.uid) * REGION * TILE * 0.3;
        ty = cy + Math.sin(b.animT * 0.24 + b.uid) * REGION * TILE * 0.3;
      }

      const dist = Math.hypot(tx - b.x, ty - b.y) || 1;
      const speed = b.hunting
        ? CFG.worldBoss.huntSpeed + CFG.worldBoss.convergePerTerritory * terr
        : CFG.worldBoss.roamSpeed;

      // attack if already on top of the player or the hall; else keep closing
      const dPly = Math.hypot(p.x - b.x, (p.y - 10) - b.y);
      if (b.hunting && dPly < CFG.worldBoss.attackReachPx) {
        if (b.atkT <= 0) { b.atkT = def.atkCooldown; b.telegraphT = def.telegraphSec; Sound.play('telegraph'); this.ctx.log?.push('boss', `${b.name} winds up a strike`, state.clock); }
      } else if (hallB && b.hunting && Math.hypot((hallB.tx + 0.5) * TILE - b.x, (hallB.ty + 0.9) * TILE - b.y) < CFG.worldBoss.attackReachPx + 12) {
        if (b.atkT <= 0) { b.atkT = def.atkCooldown; this.ctx.hordes.damageBuilding(hallB, b.dmg); this.ctx.cam.shake?.(5); }
      } else if (dist > 4) {
        const ux = (tx - b.x) / dist, uy = (ty - b.y) / dist;
        const terrain = this.ctx.world.speedAt(Math.floor(b.x / TILE), Math.floor(b.y / TILE));
        const nx = b.x + ux * speed * dt * terrain, ny = b.y + uy * speed * dt * terrain;
        // bosses are big data-constructs but a firewall still blocks them — chew through
        const blk = b.hunting ? this.ctx.world.buildingAt(Math.floor(nx / TILE), Math.floor((ny - 4) / TILE)) : null;
        if (blk && blk.type !== 'hall') {
          if (b.atkT <= 0) {
            b.atkT = def.atkCooldown;
            this.ctx.hordes.damageBuilding(blk, b.dmg);
            this.ctx.cam.shake?.(5);
            this.ctx.log?.push('boss', `${b.name} smashes your ${blk.type} for ${b.dmg}`, state.clock);
          }
        } else { b.x = nx; b.y = ny; }
      }

      this.checkWarning(b, Math.hypot(p.x - b.x, p.y - b.y) / TILE);
    }
  }

  private checkWarning(b: WorldBoss, tiles: number) {
    if (b.hunting && tiles < CFG.worldBoss.warnTiles && !this.warned.has(b.uid)) {
      this.warned.add(b.uid);
      this.ctx.toast(`${b.name} has caught your scent — it approaches!`, 'bad');
      Sound.play('bossRoar');
      this.ctx.cam.shake?.(4);
      this.ctx.log?.push('boss', `${b.name} has caught your scent`, this.ctx.state.clock);
    } else if (tiles > CFG.worldBoss.warnTiles * 1.5) {
      this.warned.delete(b.uid);
    }
  }

  // ---- taking damage from the player / towers -----------------------------
  hurt(b: WorldBoss, dmg: number, fromPlayer = true) {
    if (b.reviveAt > 0) return;
    const { state } = this.ctx;
    const wasHunting = b.hunting;
    b.hp -= dmg;
    if (b.hp > 0) {
      // being struck triggers it right now, whatever territory/night says —
      // it no longer just floats there taking hits obliviously
      if (fromPlayer) {
        b.provokedUntil = state.clock + CFG.worldBoss.provokedSec;
        b.hunting = true;
        if (!wasHunting) {
          this.ctx.toast(`${b.name} turns on you!`, 'bad');
          this.ctx.log?.push('boss', `${b.name} turns to fight back`, state.clock);
        }
      }
      return;
    }

    this.ctx.views.removeBoss(b.uid);
    b.reviveAt = state.clock + CFG.worldBoss.reviveSec;
    b.hunting = false;
    this.warned.delete(b.uid);

    // C1: the lord's echo clings to the slayer — granted on ANY death (player,
    // tower, or another echo); the echo belongs to the run, not the blow
    this.ctx.echoes?.onBossSlain?.(b);

    const def = defOf(b.defId);
    const [gmin, gmax] = CFG.worldBoss.goldOnKill;
    const goldWon = gmin + Math.floor(Math.random() * (gmax - gmin + 1)) + b.level * 20;
    // B5 Q2: a lord is a boss by construction — there is no enemy row to read a
    // `boss` flag off, which is why awardGold takes the claim as an argument.
    // At the shipped 'boss' setting this hoard bursts across the floor with the
    // relics, which is the only reason the number was ever worth this much.
    this.ctx.drops.awardGold(goldWon, b.x, b.y, true);
    // B5: a lord's hoard bursts outward rather than teleporting into the bag.
    // Relics are gear, so they never despawn — nothing rare is ever lost to a timer.
    // A1: a domain lord is the only ordinary route to a Sovereign — floor
    // Hallowed, ceiling Sovereign. See LOOT_BANDS in data/rarity.ts.
    this.ctx.drops.spawn(rollLoot(def.loot), b.x, b.y, { spread: 1.8, band: 'lord' });
    // A5: a lord leaves its element's thread — the elite drop this build has,
    // until A2's elites take over the job.
    const threadItem = this.ctx.weaves?.threadForBoss?.(b.defId);
    if (threadItem) {
      this.ctx.drops.spawn([{ id: threadItem, n: CFG.weaves.threadsPerLordKill }], b.x, b.y, { spread: 1.2 });
    }
    if (fromPlayer) {
      const lvl = addXp(state, 'combat', def.xp);
      if (lvl) { levelUpFlourish(this.ctx); this.ctx.toast(`Combat reached level ${lvl}!`, 'good'); this.ctx.log?.push('level', `Combat reached level ${lvl}`, state.clock); }
      if (state.player.equip?.charm) {
        const cl = awardSoulXp(state, 'charm', CFG.soulgear.charmXpPerKill * 10); // bosses feed charms well
        if (cl) { this.ctx.toast(`Your charm drinks deep — soul level ${cl}!`, 'good'); this.ctx.log?.push('level', `Charm reached soul level ${cl}`, state.clock); }
      }
    }
    // S1: a boss kill always feeds vitals — never AFK (locked spec)
    this.ctx.vitals?.onKill?.(true);
    // A5: Hollow Song stacks on top of the S1 resolve-per-kill
    this.ctx.weaves?.onKill?.();
    // Review fix: this call was missing entirely — hordes.ts calls
    // scoreboard.onKill on every foe death, but world bosses (the only
    // enemies with `boss: true`) never went through that path, so
    // ScoreboardSystem.bossesSlain was permanently stuck at 0 on every run.
    this.ctx.scoreboard?.onKill?.(true);
    this.ctx.loom?.onBossSlain?.();

    Sound.play('enemyDie');
    this.ctx.toast(`You have slain ${b.name}! The land trembles.`, 'good');
    this.ctx.log?.push('boss', `Slain ${b.name}!`, state.clock);
  }
}
