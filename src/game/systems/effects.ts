// C4: The Armory — Item Effect Hooks. Data-driven behavior keys that
// systems consult. Each effect is a small function registered here;
// items declare which effects they carry via ItemDef.effects[].
// Boss relics use the same system — they're just items with effect keys.
import { CFG } from '../data/config';
import { AFFIX_POWER } from '../data/elites';
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

// ---- A2: Venom on the player ----------------------------------------------
//
// The Venomous affix. Lives here, beside the move-burst window, for exactly the
// same reason: the arming site (combat.damagePlayer) and the ticking site
// (combat.update) are the same system today, but the poison-tower DoT proved
// this shape gets a second caller eventually, and a timer on `state` is
// findable while a private field on CombatSystem is not.
//
// **Stacks, and stacks are what make it a mechanic.** One venom tick is a
// rounding error against regen; four is a decision about whether to keep
// fighting. Each application refreshes the whole duration AND adds a stack, so
// the way out is disengagement — the same counterplay the affix's blurb
// promises ("what it opens does not close") and the same one Kindled asks for.

/** Land one application. Refreshes the window and adds a stack, to a ceiling. */
export function applyVenom(state: any) {
  const P = CFG.a2;
  if (!P.enabled) return;
  const now = state.clock ?? 0;
  // A window that has already lapsed starts the count over rather than
  // resuming it. Otherwise a foe that poisoned you two minutes ago is still
  // contributing to a stack you took in a different fight.
  const live = now < (state._venomUntil ?? 0);
  state._venomStacks = Math.min(VENOM.maxStacks, (live ? (state._venomStacks ?? 0) : 0) + 1);
  state._venomUntil = now + VENOM.sec;
}

/** Damage owed this tick, and 0 when nothing is running — so the caller adds it
 *  unconditionally rather than branching. Accumulates fractional damage in
 *  `_venomAcc` and pays out whole points, the same discipline the enemy-side
 *  poison DoT uses: a health bar that ticks down by 0.032 is a bar that looks
 *  broken. */
export function tickVenom(state: any, dt: number): number {
  const now = state.clock ?? 0;
  if (now >= (state._venomUntil ?? 0) || !(state._venomStacks > 0)) {
    state._venomStacks = 0;
    state._venomAcc = 0;
    return 0;
  }
  state._venomAcc = (state._venomAcc ?? 0) + VENOM.dps * state._venomStacks * dt;
  const whole = Math.floor(state._venomAcc);
  if (whole <= 0) return 0;
  state._venomAcc -= whole;
  return whole;
}

/** How many stacks are riding right now — for the HUD, which has to say so.
 *  An invisible DoT is a health bar that empties for no reason. */
export function venomStacks(state: any): number {
  return (state.clock ?? 0) < (state._venomUntil ?? 0) ? (state._venomStacks ?? 0) : 0;
}

// Read from the affix table rather than duplicated into CFG: the numbers belong
// beside the affix that spends them, and a second copy here is a second thing
// to forget during a retune.
const VENOM = {
  get dps() { return AFFIX_POWER.venomDps; },
  get sec() { return AFFIX_POWER.venomSec; },
  get maxStacks() { return AFFIX_POWER.venomMaxStacks; },
};

// ---- A8: Boons ------------------------------------------------------------
//
// The move-burst window above is one hard-coded timer over one hard-coded
// effect. A Boon is the same idea with the effect and the duration pulled out
// into a data row (data/boons.ts), which is why this lives here rather than in
// a system of its own: it is not new machinery, it is the machinery that was
// already here, generalised.
//
// The payoff is that boons need NO new consumption wiring. activeEffects()
// folds live ones in below, so all ~20 sites that ask
// `activeEffects(state).has('fire_aura')` light up for a Wardstone blessing
// without knowing one exists. The constraint that buys that is stated in
// data/boons.ts: a boon may only name an effect that is already consumed.

export interface ActiveBoon {
  id: string;
  name: string;
  blurb: string;
  color: string;
  effects: string[];
  /** World clock at expiry. There is deliberately no `t0` to go with it: the
   *  Omens carry one because the Lens plots when they started, and nothing
   *  plots a boon. A field that is written and never read is the dormant-row
   *  sin in a struct, and this milestone claims not to add any. */
  until: number;
}

export interface BoonGrant {
  boon: ActiveBoon;
  /** 'new' | 'refreshed' | 'displaced' — what the grant actually did, so the
   *  caller can say the right sentence instead of guessing. */
  how: 'new' | 'refreshed' | 'displaced';
  /** The boon that was pushed out to make room, when `how` is 'displaced'. */
  displaced?: ActiveBoon;
}

/** Grant a boon. Never refuses.
 *
 *  Re-granting a boon that is already up REFRESHES it rather than stacking a
 *  second copy, for the same reason the Omens refresh: two Ember Wards is not a
 *  hotter fire, it is a bookkeeping error with a longer duration.
 *
 *  At CFG.a8.maxBoons the OLDEST boon is displaced and the caller is handed it
 *  so it can be named out loud. Displacing loudly beats refusing, because a
 *  refusal at a Wardstone means the player either wastes the stone or has to
 *  stand around waiting for a timer they cannot see the end of. */
export function grantBoon(state: any, def: {
  id: string; name: string; blurb: string; color: string; effects: string[]; sec: number;
}): BoonGrant {
  const now = state.clock ?? 0;
  const sec = def.sec * (CFG.a8.boonSecMul ?? 1);
  if (!Array.isArray(state.boons)) state.boons = [];
  const list: ActiveBoon[] = state.boons;

  const existing = list.find((b) => b.id === def.id && b.until > now);
  if (existing) {
    existing.until = now + sec;
    return { boon: existing, how: 'refreshed' };
  }

  // Drop anything that has quietly run out before measuring against the cap,
  // so an expired boon nobody has ticked away cannot cost the player a slot.
  for (let i = list.length - 1; i >= 0; i--) if (list[i].until <= now) list.splice(i, 1);

  let displaced: ActiveBoon | undefined;
  while (list.length >= Math.max(1, CFG.a8.maxBoons)) displaced = list.shift();

  const boon: ActiveBoon = {
    id: def.id, name: def.name, blurb: def.blurb, color: def.color,
    effects: [...def.effects], until: now + sec,
  };
  list.push(boon);
  return { boon, how: displaced ? 'displaced' : 'new', displaced };
}

/** Live boons, newest last. Non-mutating — safe to call from a render path. */
export function activeBoons(state: any): ActiveBoon[] {
  const list: ActiveBoon[] | undefined = state.boons;
  if (!list?.length) return [];
  const now = state.clock ?? 0;
  return list.filter((b) => b.until > now);
}

/** Sweep expired boons out and return them, so the caller can log what lifted.
 *
 *  Cosmetic, not load-bearing: every reader above filters on the clock anyway,
 *  so a tick that never runs costs a Feed line and an array that grows by one
 *  entry per Wardstone — it can never leave a dead boon multiplying the game.
 *  That is deliberate. The alternative, where expiry only happens on the tick,
 *  makes a missed call into a permanent buff. */
export function tickBoons(state: any): ActiveBoon[] {
  const list: ActiveBoon[] | undefined = state.boons;
  if (!list?.length) return [];
  const now = state.clock ?? 0;
  const gone: ActiveBoon[] = [];
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i].until <= now) gone.push(...list.splice(i, 1));
  }
  return gone;
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
  // A8: a live Boon is worn the way an affix is worn. Looped rather than
  // filtered because this function is on the hot path — views.syncFoes, the fog
  // update and every swing call it — and there are at most CFG.a8.maxBoons
  // entries, so the allocation a filter() would make is pure waste.
  const boons: ActiveBoon[] | undefined = state.boons;
  if (boons?.length) {
    const now = state.clock ?? 0;
    for (const b of boons) if (b.until > now) for (const e of b.effects) effects.add(e);
  }
  return effects;
}
