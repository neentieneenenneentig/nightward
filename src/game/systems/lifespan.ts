// L1: The Lifespan — a hard, run-length clock the player cannot out-turtle.
// Ages the character via REAL wall-clock time (like ScoreboardSystem.updateReal),
// not sim time — the ~15-minute cap must hold regardless of network jank, and
// must never fire mid-test during a synchronous __nw.step() Gauntlet run (real
// time barely advances inside a tight step loop). At the target age the run
// ends in a second, distinct terminal condition — death of natural causes —
// alongside the existing hall-destroyed game over.
import { CFG } from '../data/config';

export class LifespanSystem {
  private realLastMs = 0;
  private warned = false;
  private critical = false;
  private vignetteEl: HTMLElement | null = null;

  constructor(private ctx: any) {}

  /** Age this run is targeting death at (years). Seeded per-run in newState(). */
  deathAtAge(): number {
    return CFG.lifespan.startAge + CFG.lifespan.yearsPerRealMinute * this.ctx.state.lifespanTargetMin;
  }

  /** Fraction of lifespan remaining, [0,1] — drives the HUD bar. */
  fracRemaining(): number {
    const { state } = this.ctx;
    const total = this.deathAtAge() - CFG.lifespan.startAge;
    const left = this.deathAtAge() - state.player.age;
    return total > 0 ? Math.max(0, Math.min(1, left / total)) : 0;
  }

  /** Real minutes remaining at the CURRENT aging pace — a live estimate, not
   *  a fixed countdown (neglecting vigor/resolve shortens it as you go). */
  minutesRemaining(): number {
    const { state } = this.ctx;
    const yearsLeft = Math.max(0, this.deathAtAge() - state.player.age);
    return yearsLeft / CFG.lifespan.yearsPerRealMinute;
  }

  isWarning(): boolean {
    return this.minutesRemaining() <= CFG.lifespan.warnMinutesRemaining;
  }

  isCritical(): boolean {
    return this.minutesRemaining() <= CFG.lifespan.criticalMinutesRemaining;
  }

  /** Pure: the current aging-rate multiplier from vigor/resolve neglect.
   *  Split out from updateReal() so it's directly testable — updateReal's
   *  `realLastMs` is fed real performance.now() values by the live render
   *  loop every frame, so a test can never safely inject a synthetic
   *  timestamp into it without racing the live ticker. */
  agingMul(): number {
    const p = this.ctx.state.player;
    const neglectFrac = 1 - ((p.vigor ?? 100) / 100 + (p.resolve ?? 100) / 100) / 2;
    return 1 + (CFG.lifespan.vitalsSwingPct / 100) * Math.max(0, Math.min(1, neglectFrac));
  }

  /** Warn/critical/death checks against the CURRENT state.player.age. Split
   *  out from updateReal() for the same reason as agingMul() — a test can
   *  set state.player.age directly and call this without touching realLastMs
   *  at all. */
  checkThresholds() {
    const { state } = this.ctx;
    const p = state.player;
    const deathAge = this.deathAtAge();

    if (!this.warned && this.isWarning()) {
      this.warned = true;
      this.ctx.toast?.('The years weigh heavy on you now…', 'bad');
      this.ctx.log?.push('vitals', `The years weigh heavy — age ${Math.floor(p.age)}`, state.clock);
    }
    if (!this.critical && this.isCritical()) {
      this.critical = true;
      this.ctx.toast?.('Your breath grows short. The dream is ending.', 'bad');
    }
    if (this.critical) this.updateVignette(performance.now());
    else if (this.vignetteEl) this.vignetteEl.style.opacity = '0';

    if (p.age >= deathAge) {
      p.age = deathAge;
      this.ctx.onOldAgeDeath?.();
    }
  }

  /** Called every rendered frame with real elapsed ms (performance.now()-based,
   *  same pacing source as ScoreboardSystem.updateReal). */
  updateReal(realMs: number) {
    if (this.realLastMs === 0) { this.realLastMs = realMs; return; }
    const dtSec = (realMs - this.realLastMs) / 1000;
    this.realLastMs = realMs;
    const { state } = this.ctx;
    if (state.gameOver) return;

    // Aging only ever speeds up, never slows below 1× — neglecting vigor/
    // resolve (S1 survival vitals) can cut a run short; nothing extends it
    // past the seeded target.
    const ageRatePerSec = CFG.lifespan.yearsPerRealMinute / 60;
    state.player.age += ageRatePerSec * this.agingMul() * dtSec;

    this.checkThresholds();
  }

  // ---- heartbeat vignette during the final stretch ----
  private updateVignette(realMs: number) {
    if (typeof document === 'undefined') return;
    if (!this.vignetteEl) {
      this.vignetteEl = document.createElement('div');
      this.vignetteEl.style.cssText = 'position:fixed;inset:0;z-index:19;pointer-events:none;'
        + 'box-shadow:inset 0 0 120px 40px rgba(160,120,20,0.35);transition:opacity 0.4s;opacity:0;';
      document.body.appendChild(this.vignetteEl);
    }
    // slow heartbeat: two quick pulses then a rest, like a failing pulse
    const t = (realMs / 1000) % 2.2;
    const beat = t < 0.18 ? t / 0.18 : t < 0.36 ? 1 - (t - 0.18) / 0.18
      : t < 0.5 ? (t - 0.36) / 0.14 : t < 0.68 ? 1 - (t - 0.5) / 0.18 : 0;
    this.vignetteEl.style.opacity = String(0.15 + beat * 0.55);
  }
}
