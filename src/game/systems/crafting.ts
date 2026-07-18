// Crafting: consume inputs, produce output, grant xp. Pure over state + a
// toast callback. Station gating (needs a furnace, etc.) hooks in later.
import { RECIPES } from '../data/recipes';
import { ITEMS } from '../data/items';
import { BUILDINGS } from '../data/buildings';
import { TILE } from '../world/worldgen';
import { acquireGear, addXp, invAdd, invHasAll, invTakeAll, skillLevel } from '../rules';
import type { GameState } from '../state';
import { Sound } from '../../engine/audio';
import type { GameLog } from './log';

export function craft(state: GameState, recipeId: string, toast: (m: string, k?: any) => void, log?: GameLog, net?: any): boolean {
  const r = RECIPES.find((x) => x.id === recipeId);
  if (!r) return false;
  if (skillLevel(state, r.skill) < r.levelReq) {
    toast(`Requires ${r.skill} level ${r.levelReq}`, 'bad');
    return false;
  }
  if (!invHasAll(state, r.in)) { toast('Missing materials', 'bad'); return false; }
  invTakeAll(state, r.in);
  invAdd(state, r.out.id, r.out.n);
  acquireGear(state, r.out.id); // wear a freshly-forged weapon/armor if the slot is free; keep soul items bound
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
  toast(`Crafted ${ITEMS[r.out.id].name}${r.out.n > 1 ? ' ×' + r.out.n : ''} (+${r.xp}xp)`, 'good');
  log?.push('craft', `Crafted ${ITEMS[r.out.id].name}${r.out.n > 1 ? ' ×' + r.out.n : ''}`, state.clock);
  // M3.5: Action-gated beacon echo — crafting pings artisan beacons
  net?.probeAction?.('craft');
  // M3.6: Passive flux snapshot — connection stability at craft time, zero HTTP
  net?.samplePassive?.('craft');
  if (lvl) { Sound.play('levelup'); toast(`${cap(r.skill)} reached level ${lvl}!`, 'good'); log?.push('level', `${cap(r.skill)} reached level ${lvl}`, state.clock); }
  return true;
}
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
