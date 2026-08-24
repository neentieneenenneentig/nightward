// C1: Echoes of the Slain — slain domain lords leave auto-firing abilities.
// The generic tick lives here; the content is rows in data/echoes.ts. Every
// damage number obeys D5: round(echoBaseDmg(level) × rollDamageMul(rng)) —
// echoes roll on the same lightning bands as swings, with `stash: false` so a
// roll here can never overwrite a swing's pending multiplier mid-windup.
import { Graphics } from 'pixi.js';
import { CFG } from '../data/config';
import { activeEffects } from './effects';
import { echoForBoss, echoById, statsFor, activeStatsFor, type EchoDef, type EchoStats } from '../data/echoes';
import { ENEMIES } from '../data/enemies';
import { TILE } from '../world/worldgen';
import type { Foe } from './hordes';
import type { WorldBoss } from '../state';
import { scaleMin1 } from '../rules';

interface Patch {
  tx: number; ty: number;
  x: number; y: number;
  until: number;      // clock time the patch gutters out
  nextTick: number;   // clock time of the next damage tick
  tickSec: number;
  dmg: number;        // potency rolled ONCE at patch birth (the roll is the patch)
}

const bossSize = (id: string) => ENEMIES.find((e) => e.id === id)?.art.size ?? 40;

export class EchoSystem {
  private cooldowns: Record<string, number> = {};
  private patches: Patch[] = [];
  private lastFootTx: number | null = null;
  private lastFootTy = 0;
  private orbAngle = 0;
  private orbGfx: Graphics | null = null;
  private orbHitAt = new Map<number, number>(); // foe uid → clock of last orb contact
  private fireCount = 0; // per-session counter for seeded per-fire rng
  // A3: Threefold Hollow's window. The orbit echo has no fire() to empower --
  // it is a persistent ring -- so its active is a TIMER the ring reads, which is
  // why this lives here beside the ring and not in the ability system.
  private orbEmpowerUntil = 0;
  private orbEmpowerBonus = 0;
  private orbEmpowerDmgMul = 1;

  constructor(private ctx: any) {}

  /** Grant/level the slain lord's echo. Called from worldbosses.hurt()'s death
   * branch for ANY killer (player, tower, another echo) — the echo clings to
   * the run, not to the blow that landed. */
  onBossSlain(b: WorldBoss | { defId: string; level?: number }) {
    const def = echoForBoss(b.defId);
    if (!def) return;
    const { state } = this.ctx;
    const cur = state.player.echoes[def.id] ?? 0;
    if (cur >= CFG.echoes.maxLevel) return; // past the cap, re-kills deepen nothing
    const lvl = cur + 1;
    state.player.echoes[def.id] = lvl;
    const lordName = ENEMIES.find((e) => e.id === def.bossId)?.name ?? def.name;
    if (lvl === 1) {
      this.ctx.toast(`${lordName}'s echo clings to you — ${def.name}!`, 'good');
      this.ctx.log?.push('boss', `${lordName}'s echo clings to you — ${def.name}`, state.clock);
    } else {
      this.ctx.toast(`${lordName}'s echo deepens — ${def.name} level ${lvl}!`, 'good');
      this.ctx.log?.push('boss', `${lordName}'s echo deepens — ${def.name} level ${lvl}`, state.clock);
    }
    // Lens gets the technical line (truth channel)
    this.ctx.log?.push('resonance', `echo grant: ${def.id} L${lvl} ← ${def.bossId} slain (boss level ${(b as any).level ?? '?'})`, state.clock);
  }

  update(dt: number) {
    const { state } = this.ctx;
    if (state.gameOver) return;
    this.updateTrail();
    this.updatePatches();
    this.updateOrbs(dt);

    for (const id of Object.keys(state.player.echoes ?? {})) {
      const lvl = state.player.echoes[id] ?? 0;
      if (lvl <= 0) continue;
      const def = echoById(id);
      if (!def) continue;
      if (def.kind !== 'pulse' && def.kind !== 'nova' && def.kind !== 'volley') continue;
      this.cooldowns[id] = (this.cooldowns[id] ?? 0) - dt;
      if (this.cooldowns[id] > 0) continue;
      const st = statsFor(def, lvl);
      const fired =
        def.kind === 'pulse' ? this.firePulse(def, st)
        : def.kind === 'nova' ? this.fireNova(def, st)
        : this.fireVolley(def, st);
      // no target in reach → keep checking every tick so it fires the moment one appears
      if (fired) this.cooldowns[id] = st.cooldown;
    }
  }

  // ---- Cinder Trail (T5 verdict: REAL fire) --------------------------------

  private updateTrail() {
    const { state } = this.ctx;
    const p = state.player;
    const tx = Math.floor(p.x / TILE), ty = Math.floor(p.y / TILE);
    if (this.lastFootTx === null) { this.lastFootTx = tx; this.lastFootTy = ty; return; }
    if (tx === this.lastFootTx && ty === this.lastFootTy) return;
    const fromTx = this.lastFootTx, fromTy = this.lastFootTy;
    const jump = Math.max(Math.abs(tx - fromTx), Math.abs(ty - fromTy));
    this.lastFootTx = tx; this.lastFootTy = ty;
    if (jump > 3) return; // teleports (death scatter) don't smoulder

    const lvl = state.player.echoes?.['cinder_trail'] ?? 0;
    if (lvl <= 0) return;
    const def = echoById('cinder_trail')!;
    const st = statsFor(def, lvl);
    // the patch drops on the tile you LEAVE — walking forward never self-immolates
    const mul = this.roll(def.id, true); // quiet: ~2 rolls/s while walking would drown the Lens
    const px = (fromTx + 0.5) * TILE, py = (fromTy + 0.5) * TILE;
    this.patches.push({
      tx: fromTx, ty: fromTy, x: px, y: py,
      until: state.clock + st.patchSec,
      nextTick: state.clock, tickSec: st.patchTickSec,
      dmg: scaleMin1(st.dmg, mul),
    });
    this.ctx.views?.addBurnPatch?.(px, py, st.patchSec);
    this.ctx.particles?.spawn?.('ember', px, py - 4, 2);
    // T5: attempt REAL fire-CA ignition. Direct core call — fire.ignite() would toast
    // "That won't catch" on every stone tile and book it as a controlled burn; trail
    // fires are wild (no charcoal). If the ground catches, the R2 CA owns it from here:
    // real spread, real burnout, burn damage to everyone — you and your base included.
    if (CFG.echoes.cinderIgnitesCA) this.ctx.worldCore?.ignite?.(fromTx, fromTy);
  }

  private updatePatches() {
    if (!this.patches.length) return;
    const { state, hordes } = this.ctx;
    const clock = state.clock;
    for (const p of this.patches) {
      if (clock < p.nextTick || clock >= p.until) continue;
      p.nextTick = clock + p.tickSec;
      for (const f of [...(hordes?.foes ?? [])] as Foe[]) {
        if (f.hp <= 0) continue;
        if (Math.floor(f.x / TILE) === p.tx && Math.floor(f.y / TILE) === p.ty) {
          hordes.hurt(f, p.dmg, false, true); // tower rule: no combat xp, but echoes feed vitals
        }
      }
    }
    this.patches = this.patches.filter((p) => clock < p.until);
  }

  // ---- Null Orb ------------------------------------------------------------

  private updateOrbs(dt: number) {
    const { state } = this.ctx;
    const lvl = state.player.echoes?.['null_orb'] ?? 0;
    if (lvl <= 0) {
      if (this.orbGfx) { this.orbGfx.destroy(); this.orbGfx = null; }
      return;
    }
    const def = echoById('null_orb')!;
    const base = statsFor(def, lvl);
    // A3: Threefold Hollow -- while the window holds, the ring gains orbs and bites
    // deeper. Applied HERE rather than at cast time because the ring is continuous:
    // an orb that spawned before the cast has to become empowered too, or the
    // player would watch three orbs appear and only the new ones do damage.
    const empowered = state.clock < this.orbEmpowerUntil;
    const st = empowered
      ? { ...base, orbCount: base.orbCount + this.orbEmpowerBonus, dmg: base.dmg * this.orbEmpowerDmgMul }
      : base;
    this.orbAngle += CFG.echoes.orbitRadPerSec * dt * (empowered ? 1.5 : 1);
    const rPx = st.orbRadiusTiles * TILE;

    if (!this.orbGfx && this.ctx.player?.cont) {
      this.orbGfx = new Graphics();
      this.orbGfx.zIndex = 1;
      this.ctx.player.cont.addChild(this.orbGfx);
    }
    if (this.orbGfx) {
      this.orbGfx.clear();
      for (let i = 0; i < st.orbCount; i++) {
        const a = this.orbAngle + (i / st.orbCount) * Math.PI * 2;
        const ox = Math.cos(a) * rPx, oy = Math.sin(a) * rPx * 0.6 - 12;
        this.orbGfx.circle(ox, oy, empowered ? 11 : 8)
          .stroke({ width: empowered ? 2.5 : 1.5, color: def.color, alpha: empowered ? 0.6 : 0.35 });
        this.orbGfx.circle(ox, oy, empowered ? 7 : 5).fill({ color: def.color, alpha: 0.85 });
        if (empowered) this.orbGfx.circle(ox, oy, 2.5).fill({ color: 0xffffff, alpha: 0.75 });
      }
    }

    // contact damage — hit test on the same squashed ring the eye sees
    const px = state.player.x, py = state.player.y;
    for (let i = 0; i < st.orbCount; i++) {
      const a = this.orbAngle + (i / st.orbCount) * Math.PI * 2;
      const ox = px + Math.cos(a) * rPx, oy = py + Math.sin(a) * rPx * 0.6;
      for (const f of [...(this.ctx.hordes?.foes ?? [])] as Foe[]) {
        if (f.hp <= 0) continue;
        const last = this.orbHitAt.get(f.uid) ?? -1e9;
        if (state.clock - last < CFG.echoes.orbContactImmunitySec) continue;
        if (Math.hypot(f.x - ox, f.y - oy) > f.def.art.size / 2 + 7) continue;
        const mul = this.roll(def.id);
        this.orbHitAt.set(f.uid, state.clock);
        this.ctx.hordes.hurt(f, scaleMin1(st.dmg, mul), false, true);
        this.ctx.views?.addHitFlash?.(f.x, f.y);
      }
    }
    // the immunity map only ever needs recent entries
    if (this.orbHitAt.size > 64) {
      for (const [uid, t] of this.orbHitAt) if (state.clock - t > 5) this.orbHitAt.delete(uid);
    }
  }

  // ---- pulse / nova / volley -------------------------------------------------

  private firePulse(def: EchoDef, st: Required<EchoStats>): boolean {
    const { state } = this.ctx;
    const r = st.radiusTiles * TILE;
    const t = this.targetsWithin(state.player.x, state.player.y, r);
    if (!t.foes.length && !t.bosses.length) return false;
    const dmg = scaleMin1(st.dmg, this.roll(def.id));
    this.ctx.views?.addPulseRing?.(state.player.x, state.player.y, r, def.color);
    this.hitAll(t, dmg);
    return true;
  }

  private fireNova(def: EchoDef, st: Required<EchoStats>): boolean {
    const { state } = this.ctx;
    const r = st.radiusTiles * TILE;
    const t = this.targetsWithin(state.player.x, state.player.y, r);
    if (!t.foes.length && !t.bosses.length) return false;
    const dmg = scaleMin1(st.dmg, this.roll(def.id));
    this.ctx.views?.addPulseRing?.(state.player.x, state.player.y, r, def.color);
    for (const f of t.foes) {
      // chill: hordes' march step reads these (bosses shrug the cold off in v1)
      (f as any).chillUntil = state.clock + st.slowSec;
      (f as any).chillMult = st.slowMult;
    }
    this.hitAll(t, dmg);
    return true;
  }

  private fireVolley(def: EchoDef, st: Required<EchoStats>): boolean {
    const { state } = this.ctx;
    const px = state.player.x, py = state.player.y;
    const range = st.rangeTiles * TILE;
    const foes = ([...(this.ctx.hordes?.foes ?? [])] as Foe[])
      .filter((f) => f.hp > 0 && Math.hypot(f.x - px, f.y - py) <= range + f.def.art.size / 2)
      .sort((a, b) => Math.hypot(a.x - px, a.y - py) - Math.hypot(b.x - px, b.y - py));
    let bosses: WorldBoss[] = [];
    if (!foes.length) {
      bosses = ((this.ctx.worldbosses?.alive?.() ?? []) as WorldBoss[])
        .filter((b) => Math.hypot(b.x - px, b.y - py) <= range + bossSize(b.defId) / 2)
        .sort((a, b) => Math.hypot(a.x - px, a.y - py) - Math.hypot(b.x - px, b.y - py));
    }
    if (!foes.length && !bosses.length) return false;
    const dmg = scaleMin1(st.dmg, this.roll(def.id));
    for (let i = 0; i < st.projectiles; i++) {
      if (foes.length) {
        const f = foes[i % foes.length];
        if (f.hp <= 0) continue;
        this.ctx.views?.addShot?.(px, py - 10, f.x, f.y - f.def.art.size / 2);
        this.ctx.views?.addHitFlash?.(f.x, f.y);
        this.ctx.hordes.hurt(f, dmg, false, true);
      } else {
        const b = bosses[i % bosses.length];
        if (b.hp <= 0) continue;
        this.ctx.views?.addShot?.(px, py - 10, b.x, b.y - bossSize(b.defId) / 4);
        this.ctx.views?.addHitFlash?.(b.x, b.y);
        this.ctx.worldbosses.hurt(b, dmg, true); // a boss kill is never AFK — provokes & pays
      }
    }
    return true;
  }

  private targetsWithin(x: number, y: number, r: number): { foes: Foe[]; bosses: WorldBoss[] } {
    const foes = ([...(this.ctx.hordes?.foes ?? [])] as Foe[])
      .filter((f) => f.hp > 0 && Math.hypot(f.x - x, f.y - y) <= r + f.def.art.size / 2);
    const bosses = ((this.ctx.worldbosses?.alive?.() ?? []) as WorldBoss[])
      .filter((b) => b.hp > 0 && Math.hypot(b.x - x, b.y - y) <= r + bossSize(b.defId) / 2);
    return { foes, bosses };
  }

  private hitAll(t: { foes: Foe[]; bosses: WorldBoss[] }, dmg: number) {
    for (const f of t.foes) {
      if (f.hp <= 0) continue;
      this.ctx.hordes.hurt(f, dmg, false, true); // no combat xp, but echoes feed vitals
      this.ctx.views?.addHitFlash?.(f.x, f.y);
    }
    for (const b of t.bosses) {
      if (b.hp <= 0) continue;
      this.ctx.worldbosses.hurt(b, dmg, true); // provokes — a struck lord always answers
      this.ctx.views?.addHitFlash?.(b.x, b.y - bossSize(b.defId) / 4);
    }
  }

  // ---- A3: the empowered forms ------------------------------------------------
  //
  // The ability system owns the bar, the Resolve cost and the cooldown. It does
  // NOT own what an echo does when it goes off -- that lives here, next to the
  // autofire it is a louder version of, so both halves obey the one damage law
  // below and both reach targets through the same targetsWithin()/hitAll() pair.
  // Two files deciding how much a Rime Nova hurts is how the two forms drift.
  //
  // Actives ALWAYS fire. The autofire returns false when nothing is in reach and
  // keeps its cooldown, which is right for something that fires itself -- but a
  // button you pressed that silently does nothing is indistinguishable from a
  // button that is broken. You pressed it, it goes off, it costs. If you emptied
  // it into the dark, that was your call and the visual says so.

  /** Cast an echo's empowered form. The caller has already charged the Resolve. */
  castActive(id: string): boolean {
    const def = echoById(id);
    if (!def) return false;
    const lvl = this.ctx.state.player.echoes?.[id] ?? 0;
    if (lvl <= 0) return false;
    const a = activeStatsFor(def, lvl);
    const { state } = this.ctx;
    // the tell: a white ring under the elemental one, on every active without
    // exception, so "I pressed something" is legible before the damage lands
    this.ctx.views?.addPulseRing?.(state.player.x, state.player.y, 22, 0xffffff);
    switch (def.kind) {
      case 'pulse':  this.castBurst(def, a); break;
      case 'trail':  this.castLine(def, a); break;
      case 'nova':   this.castFreeze(def, a); break;
      case 'volley': this.castChain(def, a); break;
      case 'orbit':  this.castOrbWindow(def, a); break;
    }
    this.ctx.log?.push('resonance',
      `active: ${def.active.name} (${def.id} L${lvl}) cast for ${def.active.cost} resolve`, state.clock);
    return true;
  }

  /** Bramblebreak -- the ring erupts, and throws back what lives through it. */
  private castBurst(def: EchoDef, a: ReturnType<typeof activeStatsFor>) {
    const { state } = this.ctx;
    const px = state.player.x, py = state.player.y;
    const r = a.radiusTiles * TILE;
    const t = this.targetsWithin(px, py, r);
    const dmg = scaleMin1(a.dmg, this.roll(def.id));
    this.ctx.views?.addPulseRing?.(px, py, r, def.color);
    this.ctx.views?.addPulseRing?.(px, py, r * 0.62, def.color);
    this.hitAll(t, dmg);
    // knockback: survivors only, and only onto ground they could have walked to.
    // canStand() is the same test the player's own movement uses -- shoving a foe
    // into a lake would strand it there forever, because speedAt() on water is 0
    // and the march step would never get it out.
    const push = (def.active.knockTiles ?? 0) * TILE;
    if (push > 0) {
      for (const f of t.foes) {
        if (f.hp <= 0) continue;
        const d = Math.hypot(f.x - px, f.y - py) || 1;
        const nx = f.x + ((f.x - px) / d) * push;
        const ny = f.y + ((f.y - py) / d) * push;
        if (this.ctx.world?.canStand?.(nx, ny) !== false) { f.x = nx; f.y = ny; }
      }
    }
  }

  /** Emberline -- the smoulder leaves your feet and lands where you are looking. */
  private castLine(def: EchoDef, a: ReturnType<typeof activeStatsFor>) {
    const { state } = this.ctx;
    const ang = this.ctx.player?.aimAngle ?? Math.PI / 2;
    const dx = Math.cos(ang), dy = Math.sin(ang);
    const tx0 = Math.floor(state.player.x / TILE), ty0 = Math.floor(state.player.y / TILE);
    const n = Math.max(1, Math.round(def.active.lineTiles ?? 5));
    const dmg = scaleMin1(a.dmg, this.roll(def.id));
    const seen = new Set<string>();
    for (let i = 1; i <= n; i++) {
      const tx = Math.round(tx0 + dx * i), ty = Math.round(ty0 + dy * i);
      const key = `${tx},${ty}`;
      if (seen.has(key)) continue;   // a shallow diagonal rounds two steps onto one tile
      seen.add(key);
      const x = (tx + 0.5) * TILE, y = (ty + 0.5) * TILE;
      this.patches.push({
        tx, ty, x, y,
        until: state.clock + a.patchSec,
        nextTick: state.clock, tickSec: a.patchTickSec,
        dmg,
      });
      this.ctx.views?.addBurnPatch?.(x, y, a.patchSec);
      this.ctx.particles?.spawn?.('ember', x, y - 4, 3);
      // same rule the trail has obeyed since T5: the line asks the real fire CA to
      // catch, and if it does the CA owns it -- including burning you and your base.
      if (CFG.echoes.cinderIgnitesCA) this.ctx.worldCore?.ignite?.(tx, ty);
    }
  }

  /** Hoarfrost -- the cold stops being a slow and becomes a wall. */
  private castFreeze(def: EchoDef, a: ReturnType<typeof activeStatsFor>) {
    const { state } = this.ctx;
    const px = state.player.x, py = state.player.y;
    const r = a.radiusTiles * TILE;
    const t = this.targetsWithin(px, py, r);
    const dmg = scaleMin1(a.dmg, this.roll(def.id));
    this.ctx.views?.addPulseRing?.(px, py, r, def.color);
    const freeze = def.active.freezeSec ?? 0;
    for (const f of t.foes) {
      const ef = f as any;
      // _stunnedUntil is the C5 Earthshaker consumer, already read by the march
      // step. Reusing it is the whole reason a hard freeze is four lines and not
      // a new debuff with a new consumer nobody wired.
      ef._stunnedUntil = Math.max(ef._stunnedUntil ?? 0, state.clock + freeze);
      // and the chill outlasts the freeze, so they thaw INTO a slow rather than
      // snapping back to full speed the instant the wall drops
      ef.chillUntil = state.clock + freeze + a.slowSec;
      ef.chillMult = a.slowMult;
    }
    this.hitAll(t, dmg);   // lords take the damage; the cold does not hold them (v1)
  }

  /** Undertow -- four lashes, further out, and it never lashes nothing. */
  private castChain(def: EchoDef, a: ReturnType<typeof activeStatsFor>) {
    const { state } = this.ctx;
    const px = state.player.x, py = state.player.y;
    const range = a.rangeTiles * TILE;
    const n = Math.max(1, Math.round(a.projectiles));
    const dmg = scaleMin1(a.dmg, this.roll(def.id));
    const foes = ([...(this.ctx.hordes?.foes ?? [])] as Foe[])
      .filter((f) => f.hp > 0 && Math.hypot(f.x - px, f.y - py) <= range + f.def.art.size / 2)
      .sort((x, y) => Math.hypot(x.x - px, x.y - py) - Math.hypot(y.x - px, y.y - py));
    const bosses = ((this.ctx.worldbosses?.alive?.() ?? []) as WorldBoss[])
      .filter((b) => b.hp > 0 && Math.hypot(b.x - px, b.y - py) <= range + bossSize(b.defId) / 2)
      .sort((x, y) => Math.hypot(x.x - px, x.y - py) - Math.hypot(y.x - px, y.y - py));
    // distinct targets FIRST, then wrap. "Four targets" against a lone charger
    // still has to be four lashes, or the active gets weaker as the field thins.
    if (!foes.length && !bosses.length) {
      // nothing in reach: four lashes into the dark, so a wasted cast looks wasted
      for (let i = 0; i < n; i++) {
        const ang = this.ctx.player?.aimAngle ?? 0;
        const s = ang + (i - (n - 1) / 2) * 0.35;
        this.ctx.views?.addShot?.(px, py - 10, px + Math.cos(s) * range, py + Math.sin(s) * range);
      }
      return;
    }
    for (let i = 0; i < n; i++) {
      if (foes.length) {
        const f = foes[i % foes.length];
        if (f.hp <= 0) continue;
        this.ctx.views?.addShot?.(px, py - 10, f.x, f.y - f.def.art.size / 2);
        this.ctx.views?.addHitFlash?.(f.x, f.y);
        this.ctx.hordes.hurt(f, dmg, false, true);
      } else {
        const b = bosses[i % bosses.length];
        if (b.hp <= 0) continue;
        this.ctx.views?.addShot?.(px, py - 10, b.x, b.y - bossSize(b.defId) / 4);
        this.ctx.views?.addHitFlash?.(b.x, b.y);
        this.ctx.worldbosses.hurt(b, dmg, true);
      }
    }
  }

  /** Threefold Hollow -- open the window; updateOrbs() does the rest, every tick. */
  private castOrbWindow(def: EchoDef, a: ReturnType<typeof activeStatsFor>) {
    const { state } = this.ctx;
    this.orbEmpowerUntil = state.clock + (def.active.windowSec ?? 0);
    this.orbEmpowerBonus = def.active.orbBonus ?? 0;
    this.orbEmpowerDmgMul = def.active.dmgMul;
    this.ctx.views?.addPulseRing?.(state.player.x, state.player.y, a.orbRadiusTiles * TILE, def.color);
  }

  /** A3 test seam: how long Threefold Hollow's window still has to run. */
  orbEmpowerLeft(): number {
    return Math.max(0, this.orbEmpowerUntil - (this.ctx.state?.clock ?? 0));
  }

  /** One damage law: the same seeded-rng D5 roll swings use, per fire.
   * `stash: false` — never overwrite a pending swing's stashed multiplier. */
  private roll(label: string, quiet = false): number {
    // C4: 'resonance_boost' — the Nullmaw relic and the 'of Resonance' suffix.
    // Applied HERE, in the one place both halves of an echo derive their damage,
    // so it lifts the autofire and A3's actives together and cannot drift apart
    // from either. Registered in C4; its handler's comment claimed the network
    // system consumed it, and the network system had never heard of it.
    const res = activeEffects(this.ctx.state).has('resonance_boost')
      ? 1 + CFG.itemEffects.resonancePct : 1;
    return res * this.rollBase(label, quiet);
  }

  private rollBase(label: string, quiet = false): number {
    this.fireCount++;
    const swingSeed = (this.ctx.state.seed ?? 1234) ^ (this.fireCount * 0x9e3779b9);
    let s = swingSeed >>> 0;
    const rng = () => {
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    return this.ctx.net?.rollDamageMul?.(rng, { label, stash: false, quiet })?.mul ?? 1.0;
  }
}
