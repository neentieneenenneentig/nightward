// Crafting: consume inputs, produce output, grant xp. Pure over state + a
// toast callback. Station gating (needs a furnace, etc.) hooks in later.
import { RECIPES } from '../data/recipes';
import { ITEMS } from '../data/items';
import { addXp, autoEquip, invAdd, invHasAll, invTakeAll, skillLevel } from '../rules';
import type { GameState } from '../state';
import { Sound } from '../../engine/audio';

export function craft(state: GameState, recipeId: string, toast: (m: string, k?: any) => void): boolean {
  const r = RECIPES.find((x) => x.id === recipeId);
  if (!r) return false;
  if (skillLevel(state, r.skill) < r.levelReq) {
    toast(`Requires ${r.skill} level ${r.levelReq}`, 'bad');
    return false;
  }
  if (!invHasAll(state, r.in)) { toast('Missing materials', 'bad'); return false; }
  invTakeAll(state, r.in);
  invAdd(state, r.out.id, r.out.n);
  autoEquip(state, r.out.id); // wear a freshly-forged weapon/armor if the slot is free
  const lvl = addXp(state, r.skill, r.xp);
  Sound.play('craft');
  toast(`Crafted ${ITEMS[r.out.id].name}${r.out.n > 1 ? ' ×' + r.out.n : ''} (+${r.xp}xp)`, 'good');
  if (lvl) { Sound.play('levelup'); toast(`${cap(r.skill)} reached level ${lvl}!`, 'good'); }
  return true;
}
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
