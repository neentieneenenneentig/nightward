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
    this.ctx.state.player.gold += pop * CFG.economy.goldPerPop;
    this.ctx.onGold?.();
  }
}
