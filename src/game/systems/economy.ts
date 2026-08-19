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
    // C3: Loom territory income + Night Market keystone.
    // B3.a: the 1.4 used to be a literal here; it is CFG.loom.nightMarketGoldMul now.
    const loomGoldMul = this.ctx.loom?.getGoldMul?.() ?? 1.0;
    const gain = Math.round(pop * CFG.economy.goldPerPop * goldMul * loomGoldMul);
    this.ctx.state.player.gold += gain;
    this.ctx.onGold?.();
    const s = this.ctx.net?.snap;
    this.ctx.log?.push('economy', `Tribute collected: +${gain} gold (pop ${pop} · ${goldMul.toFixed(2)}×)`, this.ctx.state.clock);

    // M3.5: Action-gated network probe — gold trade routes through southern exchanges
    // (cooldown-throttled inside probeAction, so calling every tick is fine)
    this.ctx.net?.probeAction?.('economy');
    // M3.6: Passive metric snapshot for economy — informational only, zero HTTP
    this.ctx.net?.samplePassive?.('economy');

    // flux surges cough up bonus gold (keyed to echoJitter — same-beacon echo variance,
    // NOT the near-constant connection.rtt jitter; threshold rebalanced per N1.5-F1)
    const echoJitter = this.ctx.net?.snap?.echoJitter ?? 5;
    if (echoJitter > 50) {
      const bonusGold = Math.round(echoJitter * 0.3);
      this.ctx.state.player.gold += bonusGold;
      this.ctx.toast(`Flux surge! +${bonusGold} gold`, 'good');
      this.ctx.log?.push('economy', `Flux surge → +${bonusGold} bonus gold`, this.ctx.state.clock);
    }
    // N2a: raw numbers moved to the Lens feed; if a floater is wanted, it speaks fiction
    if (gain > 0 && this.ctx.floaters && this.ctx.net) {
      const goldMul = this.ctx.net.getGameValue?.('goldRate') ?? 1.0;
      const px = this.ctx.state.player.x, py = this.ctx.state.player.y;
      if (goldMul !== 1.0) {
        this.ctx.floaters.spawn(px, py - 30, 'current', goldMul, '', this.ctx.cam);
      }
    }
  }
}
