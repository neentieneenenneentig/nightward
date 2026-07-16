// The racket's income: every tick, population collects tribute — during
// daylight only, by default. All rates in config.economy.
import { CFG } from '../data/config';
import { population } from '../rules';

export class EconomySystem {
  private t = 0;

  constructor(private ctx: any) {}

  update(dt: number) {
    this.t += dt;
    if (this.t < CFG.economy.tickSec) return;
    this.t = 0;
    if (CFG.economy.dayOnly && this.ctx.isNight()) return;
    const pop = population(this.ctx.state);
    if (pop <= 0) return;
    // N1: network gold rate multiplier (bandwidth → gold)
    const goldMul = this.ctx.net?.getGameValue?.('goldRate') ?? 1.0;
    const gain = Math.round(pop * CFG.economy.goldPerPop * goldMul);
    this.ctx.state.player.gold += gain;
    this.ctx.onGold?.();
    const s = this.ctx.net?.snap;
    this.ctx.log?.push('economy', `Tribute collected: +${gain} gold (pop ${pop} · ${goldMul.toFixed(2)}×)`, this.ctx.state.clock);

    // M3.5: Action-gated network probe — gold trade routes through southern exchanges
    // (cooldown-throttled inside probeAction, so calling every tick is fine)
    this.ctx.net?.probeAction?.('economy');
    // M3.6: Passive metric snapshot for economy — informational only, zero HTTP
    this.ctx.net?.samplePassive?.('economy');

    // flux surges cough up bonus gold
    const jitter = this.ctx.net?.snap?.jitter ?? 5;
    if (jitter > 25) {
      const bonusGold = Math.round(jitter * 0.6);
      this.ctx.state.player.gold += bonusGold;
      this.ctx.toast(`Flux surge! +${bonusGold} gold`, 'good');
      this.ctx.log?.push('economy', `Flux surge → +${bonusGold} bonus gold`, this.ctx.state.clock);
    }
    // N1: spawn network floater showing bandwidth→gold rate
    if (gain > 0 && this.ctx.floaters && this.ctx.net) {
      const dl = this.ctx.net.snap?.downlink ?? 10;
      const goldMul = this.ctx.net.getGameValue?.('goldRate') ?? 1.0;
      const px = this.ctx.state.player.x, py = this.ctx.state.player.y;
      this.ctx.floaters.spawn(px, py - 30, 'downlink', dl, 'Mbps', this.ctx.cam);
      if (goldMul !== 1.0) {
        this.ctx.floaters.spawn(px + 8, py - 42, 'goldRate', goldMul, '', this.ctx.cam);
      }
    }
  }
}
