// A8 — Boons: the Wardstone's blessing.
//
// A boon is a TIMED ENTRY INTO THE EFFECT VOCABULARY. That sentence is the
// whole design, and it is the reason this milestone is a data file rather than
// a system.
//
// The A8 brief said shrines were "a data row plus a toast" because
// "effects.ts already has the timed buff machinery (Nightseer Charm)". Half of
// that was wrong: the Nightseer Charm is a permanently equipped item, not a
// timed anything. What effects.ts actually has is `armMoveBurst()` — a window
// stamped on `state`, read through a helper, expiring on the world clock — and
// that IS the machinery, generalised here from one hard-coded window to a
// table.
//
// So a boon does not introduce a second vocabulary of temporary multipliers
// alongside the Omens. It borrows the FIFTEEN EFFECT KEYS the game already
// consumes, which means every boon below reaches the world through a consumer
// that C4 built, A1 proved out, and the C4 repair audited. There is no new
// wire to forget: `activeEffects(state)` folds live boons in, and the ~20 sites
// that ask `activeEffects(state).has('fire_aura')` cannot tell — and must not
// care — whether the fire came from a relic, an affix, a socketed weave, or a
// stone you touched ninety seconds ago.
//
// The corollary is the constraint: **a boon may only name an effect that is
// already registered and already consumed.** A boon inventing a new key would
// be a dormant row wearing a costume. testWardstoneBoons asserts exactly that.

export interface BoonDef {
  id: string;
  /** Veil-legal (pillar 7). No network jargon — a Wardstone is not a readout. */
  name: string;
  /** Shown in the toast and on the HUD chip. Says what it DOES, in fiction. */
  blurb: string;
  /** Effect keys from systems/effects.ts. Every one must already have a live
   *  consumer somewhere in the game; see the file header. */
  effects: string[];
  /** WORLD seconds. Night is 100 s, a run is ~900 s, so a 120 s boon is a real
   *  slice of a run and a 60 s one is a fight, not a lifestyle. */
  sec: number;
  /** Relative draw weight. The loud ones are rarer, so touching a Wardstone
   *  stays a gamble rather than a vending machine. */
  weight: number;
  /** Tint for the HUD chip and the grant toast. */
  color: string;
}

export const BOONS: BoonDef[] = [
  {
    id: 'ember_ward', name: 'Ember Ward',
    blurb: 'the stone breathes fire — it clings to you',
    effects: ['fire_aura'], sec: 75, weight: 8, color: '#e8844a',
  },
  {
    id: 'rime_ward', name: 'Rime Ward',
    blurb: 'the cold pours off you — what comes near slows',
    effects: ['chill_aura'], sec: 75, weight: 8, color: '#a9c8ea',
  },
  {
    id: 'bramblehide', name: 'Bramblehide',
    blurb: 'thorns under the skin — what bites you bleeds',
    effects: ['thorns_reflect'], sec: 90, weight: 10, color: '#5aa24a',
  },
  {
    id: 'bloodbind', name: 'Bloodbind',
    blurb: 'the wound feeds you — your strikes drink',
    effects: ['lifesteal'], sec: 60, weight: 6, color: '#8844cc',
  },
  {
    id: 'coinsight', name: 'Coinsight',
    blurb: 'every corpse rings — the dead pay better',
    effects: ['gold_find'], sec: 120, weight: 10, color: '#ffcc00',
  },
  {
    id: 'clear_sight', name: 'Clear Sight',
    blurb: 'the work teaches faster — everything you do sticks',
    effects: ['xp_boost'], sec: 120, weight: 10, color: '#44aaff',
  },
  {
    id: 'farsight', name: 'Farsight',
    blurb: 'the dark thins, and you can read what stands in it',
    effects: ['night_vision', 'see_foe_hp'], sec: 120, weight: 9, color: '#8888cc',
  },
  {
    id: 'windstep', name: 'Windstep',
    blurb: 'you are half elsewhere — some blows find nothing',
    effects: ['dodge'], sec: 60, weight: 6, color: '#44cc88',
  },
  {
    id: 'quickstep', name: 'Quickstep',
    blurb: 'each kill throws you forward',
    effects: ['move_burst_on_kill'], sec: 90, weight: 9, color: '#eaffff',
  },
  {
    id: 'deep_resonance', name: 'Deep Resonance',
    blurb: 'the slain sing louder — your echoes strike harder',
    effects: ['resonance_boost'], sec: 60, weight: 5, color: '#ffb0ff',
  },
  {
    id: 'mending', name: 'Mending',
    blurb: 'the daylight knits you faster',
    effects: ['regen_boost'], sec: 90, weight: 10, color: '#3fb0bd',
  },
  {
    id: 'arcing', name: 'Arcing',
    blurb: 'a killing blow leaps to the next throat',
    effects: ['chain_on_kill'], sec: 60, weight: 7, color: '#ffcc00',
  },
];

export function boonDef(id: string): BoonDef | undefined {
  return BOONS.find((b) => b.id === id);
}

/** Draw one boon. Weighted, because the table's weights are the balance knob —
 *  a uniform draw would make Deep Resonance as common as Mending and there
 *  would be no reason to write a weight column at all. */
export function rollBoon(): BoonDef {
  let total = 0;
  for (const b of BOONS) total += b.weight;
  let x = Math.random() * total;
  for (const b of BOONS) { x -= b.weight; if (x <= 0) return b; }
  return BOONS[BOONS.length - 1];
}
