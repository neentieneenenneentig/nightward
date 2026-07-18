// S1: Survival Pressure — two vitals (Vigor & Resolve) that decay over time
// and must be restored by action. The world starves you; hunting, building,
// and surviving restore you. All decay/restore rates are network-derived via
// NET_GAME_MAP rows — two players on the same seed with different connections
// feel different survival pressure.
import { CFG } from '../data/config';
import { hall } from '../rules';

export class VitalsSystem {
  private zeroVignetteT = 0;
  private vignetteEl: HTMLElement | null = null;

  constructor(private ctx: any) {}

  /** Called every sim tick. dt is already effectiveDt (dt × simSpeed). */
  update(dt: number) {
    const { state, isNight } = this.ctx;
    const p = state.player;
    if (state.gameOver) return;

    // ---- vigor decay ----
    const vigorDecayBase = CFG.vitals.vigorDecayPerSec;
    const vigorDecayNetMul = this.ctx.net?.getGameValue?.('vigorDecay') ?? 1.0;
    const vigorDecayRate = vigorDecayBase * vigorDecayNetMul;
    p.vigor = Math.max(0, p.vigor - vigorDecayRate * dt);

    // ---- resolve decay (multiplicative stacking) ----
    const resolveDecayBase = CFG.vitals.resolveDecayPerSec;
    const resolveDecayNetMul = this.ctx.net?.getGameValue?.('resolveDecay') ?? 1.0;

    // night multiplier
    const isNightNow = isNight();
    const nightMult = isNightNow ? CFG.vitals.resolveNightMult : 1;
    const netNightMult = this.ctx.net?.getGameValue?.('resolveNightMult') ?? 1.0;

    // boss-near multiplier: hunting boss within resolveBossNearTiles
    let bossNearMult = 1;
    if (this.ctx.worldbosses) {
      const bosses = this.ctx.worldbosses.alive?.() ?? [];
      for (const b of bosses) {
        if (!b.hunting) continue;
        const d = Math.hypot(b.x - p.x, b.y - p.y);
        if (d < CFG.vitals.resolveBossNearTiles * 32) {
          bossNearMult = CFG.vitals.resolveBossNearMult;
          break;
        }
      }
    }

    // idle multiplier: no action in resolveIdleSec
    const idleSec = state.clock - p.lastActionT;
    const idleMult = idleSec >= CFG.vitals.resolveIdleSec ? CFG.vitals.resolveIdleMult : 1;

    const resolveDecayRate = resolveDecayBase
      * resolveDecayNetMul
      * nightMult
      * netNightMult
      * bossNearMult
      * idleMult;
    p.resolve = Math.max(0, p.resolve - resolveDecayRate * dt);

    // ---- resolve near hall: +resolveNearHallPerSec within resolveNearHallTiles ----
    const h = hall(state);
    if (h && p.resolve < CFG.vitals.resolveMax) {
      const hx = (h.tx + 0.5) * 32;
      const hy = (h.ty + 0.5) * 32;
      const d = Math.hypot(p.x - hx, p.y - hy);
      if (d < CFG.vitals.resolveNearHallTiles * 32) {
        const nearHallNetMul = this.ctx.net?.getGameValue?.('resolveNearHall') ?? 1.0;
        p.resolve = Math.min(CFG.vitals.resolveMax, p.resolve + CFG.vitals.resolveNearHallPerSec * nearHallNetMul * dt);
      }
    }

    // ---- campfire vigor: standing within 3 tiles of a lit campfire ----
    if (p.vigor < CFG.vitals.vigorMax) {
      let nearCampfire = false;
      for (const b of state.buildings) {
        if (b.type !== 'campfire') continue;
        // check if this campfire is lit (has active fire CA patch on it)
        const core = this.ctx.worldCore;
        if (core && !core.isBurning(b.tx, b.ty)) continue;
        const cx = (b.tx + 0.5) * 32;
        const cy = (b.ty + 0.5) * 32;
        const d = Math.hypot(p.x - cx, p.y - cy);
        if (d < 3 * 32) { nearCampfire = true; break; }
      }
      if (nearCampfire) {
        const campfireNetMul = this.ctx.net?.getGameValue?.('vigorPerCampfire') ?? 1.0;
        p.vigor = Math.min(CFG.vitals.vigorMax, p.vigor + CFG.vitals.vigorPerCampfireSec * campfireNetMul * dt);
      }
    }

    // ---- zero-penalties ----
    if (p.vigor <= 0) {
      this.ctx.damagePlayer?.(CFG.vitals.vigorStarveDmgPerSec * dt, 'starvation');
      if (!this.ctx._vigorStarveToasted) {
        this.ctx._vigorStarveToasted = true;
        this.ctx.toast?.("You're starving.", 'bad');
      }
    } else {
      this.ctx._vigorStarveToasted = false;
    }

    if (p.resolve <= 0) {
      this.zeroVignetteT += dt;
      if (!this.ctx._resolveZeroToasted) {
        this.ctx._resolveZeroToasted = true;
        this.ctx.toast?.('Your resolve crumbles — the dark closes in.', 'bad');
        this.ctx.log?.push('vitals', 'The Thread frays at the edges. You feel the dark pressing in.', state.clock);
      }
      // vignette pulse at resolveZeroVignetteHz
      this.updateVignette();
    } else {
      this.ctx._resolveZeroToasted = false;
      this.zeroVignetteT = 0;
      if (this.vignetteEl) {
        this.vignetteEl.style.opacity = '0';
      }
    }

    // Clamp vitals
    p.vigor = Math.max(0, Math.min(CFG.vitals.vigorMax, p.vigor));
    p.resolve = Math.max(0, Math.min(CFG.vitals.resolveMax, p.resolve));
  }

  /** Called when a mob is killed (by player swing or echo). Tower kills do NOT call this. */
  onKill(isBoss: boolean) {
    const { state } = this.ctx;
    const p = state.player;

    const vigorPerKillNetMul = this.ctx.net?.getGameValue?.('vigorPerKill') ?? 1.0;
    const resolvePerKillNetMul = this.ctx.net?.getGameValue?.('resolvePerKill') ?? 1.0;

    const vigorAmt = Math.round((isBoss ? CFG.vitals.vigorPerBossKill : CFG.vitals.vigorPerKill) * vigorPerKillNetMul);
    const resolveAmt = Math.round((isBoss ? CFG.vitals.resolvePerBossKill : CFG.vitals.resolvePerKill) * resolvePerKillNetMul);

    p.vigor = Math.min(CFG.vitals.vigorMax, p.vigor + vigorAmt);
    p.resolve = Math.min(CFG.vitals.resolveMax, p.resolve + resolveAmt);

    // floaters
    if (this.ctx.floaters) {
      this.ctx.floaters.spawnVital?.(p.x, p.y - 20, 'vigor', `+${vigorAmt}`, '#5b5', this.ctx.cam);
      this.ctx.floaters.spawnVital?.(p.x, p.y - 32, 'resolve', `+${resolveAmt}`, '#da5', this.ctx.cam);
    }
  }

  /** Called when the player finishes gathering a node. */
  onGather() {
    const { state } = this.ctx;
    const p = state.player;

    const vigorPerGatherNetMul = this.ctx.net?.getGameValue?.('vigorPerGather') ?? 1.0;
    const vigorAmt = Math.round(CFG.vitals.vigorPerGather * vigorPerGatherNetMul);
    p.vigor = Math.min(CFG.vitals.vigorMax, p.vigor + vigorAmt);

    if (this.ctx.floaters) {
      this.ctx.floaters.spawnVital?.(p.x, p.y - 26, 'vigor', `+${vigorAmt}`, '#5b5', this.ctx.cam);
    }
  }

  /** Called when a building is placed. */
  onBuild() {
    const { state } = this.ctx;
    const p = state.player;

    const resolvePerBuildNetMul = this.ctx.net?.getGameValue?.('resolvePerBuild') ?? 1.0;
    const resolveAmt = Math.round(CFG.vitals.resolvePerBuild * resolvePerBuildNetMul);
    p.resolve = Math.min(CFG.vitals.resolveMax, p.resolve + resolveAmt);

    if (this.ctx.floaters) {
      this.ctx.floaters.spawnVital?.(p.x, p.y - 32, 'resolve', `+${resolveAmt}`, '#da5', this.ctx.cam);
    }
  }

  /** Called at dawn — night survived. */
  onSurviveNight() {
    const { state } = this.ctx;
    const p = state.player;

    const resolvePerSurviveNetMul = this.ctx.net?.getGameValue?.('resolvePerSurviveNight') ?? 1.0;
    const resolveAmt = Math.round(CFG.vitals.resolvePerSurviveNight * resolvePerSurviveNetMul);
    p.resolve = Math.min(CFG.vitals.resolveMax, p.resolve + resolveAmt);

    this.ctx.log?.push('vitals', `Dawn restores ${resolveAmt} resolve`, state.clock);

    if (this.ctx.floaters) {
      this.ctx.floaters.spawnVital?.(p.x, p.y - 32, 'resolve', `+${resolveAmt}`, '#da5', this.ctx.cam);
    }
  }

  /** Called on death respawn — reset vitals to half. */
  onRespawn() {
    const p = this.ctx.state.player;
    p.vigor = CFG.vitals.respawnVigor;
    p.resolve = CFG.vitals.respawnResolve;
    this.ctx._vigorStarveToasted = false;
    this.ctx._resolveZeroToasted = false;
    this.zeroVignetteT = 0;
  }

  /** Mark a non-idle action. */
  markAction() {
    this.ctx.state.player.lastActionT = this.ctx.state.clock;
  }

  // ---- resolve-zero vignette ----
  private updateVignette() {
    if (typeof document === 'undefined') return;
    if (!this.vignetteEl) {
      this.vignetteEl = document.createElement('div');
      this.vignetteEl.style.cssText = 'position:fixed;inset:0;z-index:20;pointer-events:none;'
        + 'box-shadow:inset 0 0 80px 30px rgba(200,30,30,0.35);transition:opacity 0.3s;opacity:0;';
      document.body.appendChild(this.vignetteEl);
    }
    const hz = CFG.vitals.resolveZeroVignetteHz;
    const phase = (this.zeroVignetteT * hz) % 1;
    // pulse: 0→1→0 over the cycle
    const alpha = phase < 0.5 ? phase * 2 : (1 - phase) * 2;
    this.vignetteEl.style.opacity = String(alpha * 0.7);
  }

  /** Get resolve speed multiplier (applied in player movement). */
  getSpeedMult(): number {
    const p = this.ctx.state.player;
    return p.resolve <= 0 ? CFG.vitals.resolveZeroSpeedMult : 1.0;
  }

  /** Get resolve damage-taken multiplier. */
  getDmgTakenMult(): number {
    const p = this.ctx.state.player;
    return p.resolve <= 0 ? CFG.vitals.resolveZeroDmgTakenMult : 1.0;
  }
}
