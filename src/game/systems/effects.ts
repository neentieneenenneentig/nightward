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

export function applyEffect(key: string, ctx: EffectContext): number | void {
  const fn = registry.get(key);
  return fn ? fn(ctx) : undefined;
}

// ---- C4: Built-in effects ------------------------------------------------

/** Thorns reflect: take damage → reflect % back to attacker. */
registerEffect('thorns_reflect', (ctx) => {
  if (!ctx.foe || !ctx.damage) return;
  // Reflect 30% of damage taken back at the attacker
  const reflect = Math.round(ctx.damage * 0.3);
  ctx.foe.hp -= reflect;
  return reflect;
});

/** Fire aura: every 2s, deal small AoE damage to nearby foes. */
registerEffect('fire_aura', (ctx) => {
  // Handled by combat system on kill/tick — this is just a flag
  return;
});

/** Chill aura: nearby foes move 20% slower. */
registerEffect('chill_aura', (ctx) => {
  // Handled by hordes system when checking foe speed
  return;
});

/** Regen boost: +50% HP regen. */
registerEffect('regen_boost', (ctx) => {
  return CFG.player.regenPerSec * 0.5; // extra regen
});

/** Move burst on kill: killing a foe grants +30% move speed for 3s. */
registerEffect('move_burst_on_kill', (ctx) => {
  // Handled by combat system on kill
  return;
});

/** See foe HP: foes within range show their HP bar. */
registerEffect('see_foe_hp', (ctx) => {
  // Handled by views/rendering system
  return;
});

/** Resonance boost: resonance crit window is 50% wider. */
registerEffect('resonance_boost', (ctx) => {
  // Handled by network system when computing resonance
  return;
});

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
