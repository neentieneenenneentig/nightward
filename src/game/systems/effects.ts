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

// ---- Helpers --------------------------------------------------------------

import { ITEMS } from '../data/items';

/** Get all active effects from the player's equipped items. */
export function activeEffects(state: any): Set<string> {
  const effects = new Set<string>();
  for (const slot of ['weapon', 'armor', 'ring', 'amulet', 'charm'] as const) {
    const itemId = state.player.equip?.[slot];
    if (!itemId) continue;
    const def = ITEMS[itemId];
    if (def?.effects) {
      for (const e of def.effects) effects.add(e);
    }
  }
  // C4: relic slot
  const relicId = state.player.relic;
  if (relicId) {
    const def = ITEMS[relicId];
    if (def?.effects) {
      for (const e of def.effects) effects.add(e);
    }
  }
  return effects;
}
