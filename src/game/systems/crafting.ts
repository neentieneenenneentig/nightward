// Crafting: consume inputs, produce output, grant xp. Pure over state + a
// toast callback. Station gating (needs a furnace, etc.) hooks in later.
import { RECIPES } from '../data/recipes';
import { CFG } from '../data/config';
import { itemName } from '../data/items';
import { BUILDINGS } from '../data/buildings';
import { TILE } from '../world/worldgen';
import { acquireGear, addXp, invAdd, invHasAll, invTakeAll, skillLevel } from '../rules';
import { fortuneFrom, isRollable, rollItem } from './loot';
import type { GameState } from '../state';
import { Sound } from '../../engine/audio';
import { levelUpFlourish } from './flourish';
import type { GameLog } from './log';
import type { Stack } from '../types';

/** B3.a: `loom` is optional and last so existing callers keep working, but a caller
 *  that omits it silently charges full price — the two call sites in main.ts both
 *  pass it. If a third appears, it wants the Loom too. */
export function craft(state: GameState, recipeId: string, toast: (m: string, k?: any) => void, log?: GameLog, net?: any, loom?: any, ctx?: any): boolean {
  const r = RECIPES.find((x) => x.id === recipeId);
  if (!r) return false;
  if (skillLevel(state, r.skill) < r.levelReq) {
    toast(`Requires ${r.skill} level ${r.levelReq}`, 'bad');
    return false;
  }
  // B3.a: craftCostReduction had no consumer, so every rank of Efficiency and
  // Master Crafter did nothing. Ingredients round UP and floor at 1, so no amount
  // of investment makes a recipe free.
  const cost = scaleCost(r.in, loom?.getCraftCostMul?.() ?? 1);
  if (!invHasAll(state, cost)) { toast('Missing materials', 'bad'); return false; }
  invTakeAll(state, cost);
  // A1: a forge produces sound work, not miracles — the `forge` band tops out
  // at Touched. Crafting has to stay worth doing once loot exists, and a smith
  // who can never produce anything interesting is a smith the player abandons
  // the moment the first blue drops.
  //
  // Each unit rolls SEPARATELY: a recipe that outputs two blades outputs two
  // different blades, which is the same rule the ground drops follow.
  const rollOut = CFG.loot.craftRolls && isRollable(r.out.id);
  const madeIds: string[] = [];
  for (let i = 0; i < (rollOut ? r.out.n : 1); i++) {
    const id = rollOut
      ? rollItem(r.out.id, { band: 'forge', fortune: fortuneFrom(net), clock: state.clock })
      : r.out.id;
    madeIds.push(id);
    invAdd(state, id, rollOut ? 1 : r.out.n);
    acquireGear(state, id); // wear a freshly-forged weapon/armor if the slot is free; keep soul items bound
  }
  const outId = madeIds[0];
  // X1: Workshop — crafting done within its radius grants bonus xp
  let xpAmt = r.xp;
  const wsDef = BUILDINGS.find((d) => d.id === 'workshop');
  if (wsDef?.workshop) {
    const px = state.player.x / TILE - 0.5, py = state.player.y / TILE - 0.5;
    const near = state.buildings.some((b) =>
      b.type === 'workshop' && Math.hypot(b.tx - px, b.ty - py) <= wsDef.workshop!.radiusTiles);
    if (near) xpAmt = Math.round(xpAmt * wsDef.workshop.craftSpeedMul);
  }
  const lvl = addXp(state, r.skill, xpAmt);
  Sound.play('craft');
  toast(`Crafted ${itemName(outId)}${r.out.n > 1 ? ' ×' + r.out.n : ''} (+${r.xp}xp)`, 'good');
  log?.push('craft', `Crafted ${itemName(outId)}${r.out.n > 1 ? ' ×' + r.out.n : ''}`, state.clock);
  ctx?.scoreboard?.onCraft?.(); // M2: first-craft-time instrumentation
  // M3.5: Action-gated beacon echo — crafting pings artisan beacons
  net?.probeAction?.('craft');
  // M3.6: Passive flux snapshot — connection stability at craft time, zero HTTP
  net?.samplePassive?.('craft');
  // B6: ctx is optional — the Gauntlet calls craft() headless with no views,
  // and levelUpFlourish() is a no-op without one rather than a crash.
  if (lvl) { if (ctx) levelUpFlourish(ctx); else Sound.play('levelup'); toast(`${cap(r.skill)} reached level ${lvl}!`, 'good'); log?.push('level', `${cap(r.skill)} reached level ${lvl}`, state.clock); }
  return true;
}
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

/** Scale a recipe's inputs by the Loom's craft-cost multiplier. Returns the input
 *  array unchanged when there is no discount, so the common path allocates nothing. */
function scaleCost(inputs: Stack[], mul: number): Stack[] {
  if (mul >= 1) return inputs;
  return inputs.map((s) => ({ ...s, n: Math.max(1, Math.ceil(s.n * mul)) }));
}
