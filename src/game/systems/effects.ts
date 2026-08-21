// C4: The Armory — Item Effect Hooks. Data-driven behavior keys that
// systems consult. Each effect is a small function registered here;
// items declare which effects they carry via ItemDef.effects[].
// Boss relics use the same system — they're just items with effect keys.
import { CFG } from '../data/config';
import type { Foe } from './hordes';

export interface EffectContext {
  state: any;
  player: any;
  foe?: Foe;
  damage?: number;
  killCount?: number;
}

type EffectFn = (ctx: EffectContext) => number | void;

const registry = new Map<string, EffectFn>();

// ---- Registration ----

export function registerEffect(key: string, fn: EffectFn) {
  registry.set(key, fn);
}

export function hasEffect(key: string): boolean {
  return registry.has(key);
}

/** Dispatch a registered handler.
 *
 *  NOTE, because this misled a milestone: the game does not consume effects
 *  through this function and never has. Every live hook is read as
 *  `activeEffects(state).has('key')` at the site that cares, with the behaviour
 *  written inline there, because the behaviours need that site's locals (the
 *  swing's arc, the foe's march multiplier, the fog's alpha) and an
 *  EffectContext big enough to carry all of them would be the whole game.
 *
 *  The registry is therefore a DECLARATION of the vocabulary, not a dispatch
 *  table: `hasEffect()` proving a key is spelled correctly is what it is for.
 *  Seven handlers once carried real logic here and were never called, which is
 *  precisely how they went unnoticed -- the code existed, so a reader checking
 *  "is thorns implemented?" found a function and stopped. Handlers are now
 *  empty flags to a fault, each naming the site that actually implements it. */
export function applyEffect(key: string, ctx: EffectContext): number | void {
  const fn = registry.get(key);
  return fn ? fn(ctx) : undefined;
}

// ---- C4: Built-in effects ------------------------------------------------

/** Thorns reflect: a melee attacker takes CFG.itemEffects.thornsPct of its own
 *  hit back (combat.damagePlayer, beside the A5 Ironwake reflect). */
registerEffect('thorns_reflect', () => {});

/** Fire aura: every CFG.itemEffects.fireAuraSec, foes within fireAuraTiles take
 *  fireAuraDmg (combat.updateAuras). */
registerEffect('fire_aura', () => {});

/** Chill aura: foes within CFG.itemEffects.chillAuraTiles of you march at
 *  chillAuraMult (hordes march step, beside the Rime Nova chill). */
registerEffect('chill_aura', () => {});

/** Regen boost: daytime regen scaled by 1 + CFG.itemEffects.regenBoostPct
 *  (combat.update, in the same product as the Loom's regenPct). */
registerEffect('regen_boost', () => {});

/** Move burst on kill: a kill opens a CFG.itemEffects.moveBurstSec window at
 *  moveBurstMul speed (hordes.hurt arms it, main.ts reads moveBurstMul()). */
registerEffect('move_burst_on_kill', () => {});

/** See foe HP: every foe shows its bar even at full health, with a numeral
 *  (views.syncFoes -> FoeView.sync). */
registerEffect('see_foe_hp', () => {});

/** Resonance boost: everything the Echoes of the Slain do hits for
 *  1 + CFG.itemEffects.resonancePct (echoes.roll, so autofire AND actives). */
registerEffect('resonance_boost', () => {});

// ---- X1: elemental weapon / trinket effects --------------------------------
// All flags — consumed at the named wire points.

/** Fire on hit: 30% chance a struck foe's tile ignites (combat.resolveHit → worldCore.ignite). */
registerEffect('fire_on_hit', () => {});
/** Chill on hit: struck foes move at 0.65× for 2s (combat.resolveHit stamps chillUntil/chillMult). */
registerEffect('chill_on_hit', () => {});
/** Lifesteal: heal 12% of swing damage dealt (combat.resolveHit). */
registerEffect('lifesteal', () => {});
/** Chain on kill: killing blows arc 50% damage to the nearest foe within 3 tiles (combat.resolveHit). */
registerEffect('chain_on_kill', () => {});
/** Dodge: 12% chance to slip a hit entirely (combat.damagePlayer). */
registerEffect('dodge', () => {});
/** Gold find: +25% gold from player kills (hordes.hurt). */
registerEffect('gold_find', () => {});
/** XP boost: +20% to all skill xp (rules.addXp). */
registerEffect('xp_boost', () => {});
/** Night vision: the fog presses 35% less (main.ts fog update). */
registerEffect('night_vision', () => {});

// ---- The move-burst window ------------------------------------------------
//
// A timer, not a flag, so it needs somewhere to live. It goes on `state` rather
// than on a system because the arming site (hordes.hurt) and the reading site
// (main's movement product) are in different systems that do not otherwise know
// about each other, and routing it through a third would be more wiring than the
// feature is worth.

/** Arm the window. Called from the kill path when the player holds the effect. */
export function armMoveBurst(state: any) {
  state._moveBurstUntil = (state.clock ?? 0) + CFG.itemEffects.moveBurstSec;
}

/** The movement multiplier the window is currently worth: 1.0 when closed, so
 *  this drops into main's product of multipliers without a branch. */
export function moveBurstMul(state: any): number {
  return (state.clock ?? 0) < (state._moveBurstUntil ?? 0) ? CFG.itemEffects.moveBurstMul : 1;
}

// ---- Helpers --------------------------------------------------------------

import { itemDef } from '../data/items';

/** Get all active effects from the player's equipped items.
 *
 *  A1: `itemDef()` returns a ROLLED item's def with its affixes already merged
 *  in, so an "of the Ember" suffix arrives here as an ordinary `fire_aura`
 *  entry in `def.effects` and every downstream consumer of that hook works
 *  with no knowledge that rarity exists.
 *
 *  Tools are included for the reason given on carriedGearIds() in rules.ts:
 *  they are carried rather than worn, and an affix nothing reads is a dead
 *  affix. Imported lazily to keep this module's existing import shape — it is
 *  imported by rules.ts itself. */
export function activeEffects(state: any): Set<string> {
  const effects = new Set<string>();
  const ids: string[] = [];
  for (const slot of ['weapon', 'armor', 'ring', 'amulet', 'charm'] as const) {
    const itemId = state.player.equip?.[slot];
    if (itemId) ids.push(itemId);
  }
  // C4: relic slot
  if (state.player.relic) ids.push(state.player.relic);
  // A1: the axe and pick actually in hand
  const inv = state.player.inv ?? {};
  for (const cls of ['axe', 'pick'] as const) {
    let best: string | null = null, power = -1;
    for (const id of Object.keys(inv)) {
      const d = itemDef(id);
      if (d?.toolClass === cls && (d.toolPower ?? 0) > power) { best = id; power = d.toolPower ?? 0; }
    }
    if (best) ids.push(best);
  }
  for (const id of ids) {
    const def = itemDef(id);
    if (def?.effects) for (const e of def.effects) effects.add(e);
  }
  return effects;
}
