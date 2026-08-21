// Item database. `icon` is a procgen recipe (shape kind + colors) — icons are
// drawn at runtime like everything else. Add a row = new item exists.
import { type RGB, hex } from '../../engine/procgen/palette';
import type { RarityId } from './rarity';
import type { GearMod } from './affixes';
import type { ThreadId } from './weaves';

export type IconKind =
  | 'log' | 'plank' | 'stone' | 'ore' | 'bar'
  | 'herb' | 'berry' | 'axe' | 'pick' | 'sword' | 'potion' | 'armor'
  | 'ring' | 'amulet' | 'charm' | 'torch' | 'charcoal' | 'thread';

export interface ItemDef {
  id: string;
  name: string;
  icon: { kind: IconKind; color: RGB; accent?: RGB };
  /** tools: which node class they work and how strongly (speeds gathering) */
  toolClass?: 'axe' | 'pick';
  toolPower?: number;
  /** weapons: added to the player's base damage when equipped */
  weaponDmg?: number;
  /** armor: flat damage reduction on each hit taken when equipped */
  armor?: number;
  /** potions: hp restored on use */
  heal?: number;
  /** trinkets get their own equip slot; the stat field still says what they do
   * (ring→weaponDmg, amulet→armor, charm→regen) */
  trinket?: 'ring' | 'amulet' | 'charm';
  /** charms: bonus hp/s added to daytime regen when worn */
  regen?: number;
  /** C4: item effect hooks — data-driven behavior keys */
  effects?: string[];
  /** C4: boss relic — unique drop from a specific lord (6th equip slot) */
  relic?: string;
  /** A5: this item is a thread that sockets into rolled gear. */
  thread?: ThreadId;
  /** W7: soul XP granted when fed to a soul-gear slot. Materials use MaterialDef.xpValue instead. */
  soulXp?: number;
}

const I = (
  id: string, name: string, kind: IconKind, color: string, accent?: string,
  extra: Partial<ItemDef> = {},
): ItemDef => ({
  id, name,
  icon: { kind, color: hex(color), accent: accent ? hex(accent) : undefined },
  ...extra,
});

export const ITEMS: Record<string, ItemDef> = Object.fromEntries([
  // materials
  I('log', 'Timber', 'log', '#6b4a38', undefined, { soulXp: 2 }),
  I('fine_log', 'Fine Timber', 'log', '#8a5a38', '#c2a15f', { soulXp: 4 }),
  I('plank', 'Plank', 'plank', '#a3794f', undefined, { soulXp: 3 }),
  I('stone', 'Runestone', 'stone', '#737887', undefined, { soulXp: 2 }),
  I('copper_ore', 'Copper Ore', 'ore', '#5a5f6b', '#c47b3b', { soulXp: 6 }),
  I('iron_ore', 'Iron Ore', 'ore', '#5a5f6b', '#9aa7b8', { soulXp: 10 }),
  I('copper_bar', 'Copper Bar', 'bar', '#c47b3b', undefined, { soulXp: 12 }),
  I('iron_bar', 'Iron Bar', 'bar', '#9aa7b8', undefined, { soulXp: 20 }),
  // herbs & food
  I('sunleaf', 'Sunleaf', 'herb', '#569a53', '#e6c86e', { soulXp: 5 }),
  I('moonbell', 'Moonbell', 'herb', '#3f8148', '#c9a0dc', { soulXp: 7 }),
  I('berry', 'Wild Berries', 'berry', '#b3402e', '#569a53', { soulXp: 3 }),
  // tools
  I('axe_flint', 'Flint Axe', 'axe', '#737887', '#6b4a38', { toolClass: 'axe', toolPower: 1 }),
  I('axe_copper', 'Copper Axe', 'axe', '#c47b3b', '#6b4a38', { toolClass: 'axe', toolPower: 2 }),
  I('axe_iron', 'Iron Axe', 'axe', '#9aa7b8', '#6b4a38', { toolClass: 'axe', toolPower: 3 }),
  I('pick_flint', 'Flint Pick', 'pick', '#737887', '#6b4a38', { toolClass: 'pick', toolPower: 1 }),
  I('pick_copper', 'Copper Pick', 'pick', '#c47b3b', '#6b4a38', { toolClass: 'pick', toolPower: 2 }),
  I('pick_iron', 'Iron Pick', 'pick', '#9aa7b8', '#6b4a38', { toolClass: 'pick', toolPower: 3 }),
  // weapons
  I('sword_copper', 'Copper Blade', 'sword', '#c47b3b', '#52402f', { weaponDmg: 6 }),
  I('sword_iron', 'Iron Blade', 'sword', '#c9d2e0', '#52402f', { weaponDmg: 9 }),
  // armor
  I('vest_bark', 'Bark Shield', 'armor', '#6b4a38', '#569a53', { armor: 2 }),
  I('armor_copper', 'Copper Armor', 'armor', '#c47b3b', '#52402f', { armor: 4 }),
  I('armor_iron', 'Iron Armor', 'armor', '#aab4c4', '#52402f', { armor: 8 }),
  // potions
  I('tonic_minor', 'Minor Tonic', 'potion', '#d97b7b', '#f2f2f2', { heal: 30 }),
  I('tonic_major', 'Major Tonic', 'potion', '#c9a0dc', '#f2f2f2', { heal: 75 }),
  // trinkets
  I('ring_copper', 'Copper Ring', 'ring', '#c47b3b', '#e6c86e', { trinket: 'ring', weaponDmg: 1 }),
  I('ring_iron', 'Iron Ring', 'ring', '#9aa7b8', '#7fb8e6', { trinket: 'ring', weaponDmg: 2 }),
  I('amulet_stone', 'Stone Amulet', 'amulet', '#737887', '#569a53', { trinket: 'amulet', armor: 1 }),
  I('amulet_iron', 'Iron Amulet', 'amulet', '#9aa7b8', '#c9a0dc', { trinket: 'amulet', armor: 2 }),
  I('charm_ember', 'Ember Charm', 'charm', '#c85a2e', '#ffd27a', { trinket: 'charm', regen: 0.5 }),
  I('charm_moon', 'Moon Charm', 'charm', '#4a6ea8', '#c9a0dc', { trinket: 'charm', regen: 1 }),
  // firemaking
  I('torch', 'Torch', 'torch', '#c47b3b', '#ffd27a', { soulXp: 2 }),
  I('charcoal', 'Charcoal', 'charcoal', '#232023', '#3a3a3e', { soulXp: 4 }),

  // C4: Boss relics — unique drops from domain lords (6th equip slot)
  I('relic_thorn', "Thornwarden's Bramble Heart", 'charm', '#3a6b2f', '#ff6b6b',
    { effects: ['thorns_reflect'], relic: 'thornwarden' }),
  I('relic_cinder', "Cindermaw's Ember Core", 'charm', '#c85a2e', '#ffd27a',
    { effects: ['fire_aura'], relic: 'cindermaw' }),
  I('relic_rime', "Rimewraith's Frost Shard", 'charm', '#4a6ea8', '#ffffff',
    { effects: ['chill_aura'], relic: 'rimewraith' }),
  I('relic_tide', "Tideculler's Ebb Pendant", 'charm', '#1b6f80', '#eaffff',
    { effects: ['regen_boost', 'move_burst_on_kill'], relic: 'tideculler' }),
  I('relic_null', "Nullmaw's Hollow Eye", 'charm', '#4a2170', '#ffb0ff',
    { effects: ['see_foe_hp', 'resonance_boost'], relic: 'nullmaw' }),

  // C4: New material tiers
  I('silver_ore', 'Silver Ore', 'ore', '#7a8a9a', '#d0d8e0', { soulXp: 18 }),
  I('silver_bar', 'Silver Bar', 'bar', '#d0d8e0', undefined, { soulXp: 35 }),
  I('star_ore', 'Star-Metal Ore', 'ore', '#1a2a4a', '#aaccff', { soulXp: 30 }),
  I('star_bar', 'Star-Metal Bar', 'bar', '#aaccff', undefined, { soulXp: 60 }),

  // C4: Silver/star-tier gear
  I('sword_silver', 'Silver Blade', 'sword', '#d0d8e0', '#52402f', { weaponDmg: 13 }),
  I('sword_star', 'Star-Metal Sword', 'sword', '#aaccff', '#1a2a4a', { weaponDmg: 18 }),
  I('armor_silver', 'Silver Armor', 'armor', '#d0d8e0', '#52402f', { armor: 12 }),
  I('armor_star', 'Star-Metal Armor', 'armor', '#aaccff', '#1a2a4a', { armor: 18 }),
  I('ring_silver', 'Silver Ring', 'ring', '#d0d8e0', '#e6c86e', { trinket: 'ring', weaponDmg: 3 }),
  I('ring_star', 'Star Ring', 'ring', '#aaccff', '#e6c86e', { trinket: 'ring', weaponDmg: 5 }),
  I('amulet_silver', 'Silver Amulet', 'amulet', '#d0d8e0', '#c9a0dc', { trinket: 'amulet', armor: 3 }),
  I('amulet_star', 'Star Amulet', 'amulet', '#aaccff', '#c9a0dc', { trinket: 'amulet', armor: 5 }),
  I('charm_silver', 'Silver Charm', 'charm', '#d0d8e0', '#7fb8e6', { trinket: 'charm', regen: 1.5 }),
  I('charm_star', 'Star Charm', 'charm', '#aaccff', '#ffd27a', { trinket: 'charm', regen: 2.5 }),

  // ---- X1: Elemental weapons (sidegrades, not linear upgrades) -------------
  I('sword_fire', 'Fire Brand', 'sword', '#ff4422', '#ffaa00', { weaponDmg: 11, effects: ['fire_on_hit'] }),
  I('sword_frost', 'Frost Edge', 'sword', '#4488ff', '#ccddff', { weaponDmg: 10, effects: ['chill_on_hit'] }),
  I('sword_void', 'Void Blade', 'sword', '#8844cc', '#220044', { weaponDmg: 8, effects: ['lifesteal'] }),
  I('sword_storm', 'Storm Caller', 'sword', '#ffcc00', '#4488ff', { weaponDmg: 9, effects: ['chain_on_kill'] }),

  // ---- X1: New trinkets with unique effects --------------------------------
  I('ring_fire', 'Ember Band', 'ring', '#ff4422', '#ffaa00', { trinket: 'ring', weaponDmg: 2, effects: ['fire_on_hit'] }),
  I('ring_void', 'Void Band', 'ring', '#8844cc', '#220044', { trinket: 'ring', weaponDmg: 2, effects: ['lifesteal'] }),
  I('amulet_ward', 'Warding Amulet', 'amulet', '#44cc88', '#ffffff', { trinket: 'amulet', armor: 2, effects: ['dodge'] }),
  I('charm_gold', "Miser's Charm", 'charm', '#ffcc00', '#886600', { trinket: 'charm', regen: 0.5, effects: ['gold_find'] }),
  I('charm_xp', "Sage's Charm", 'charm', '#44aaff', '#ffffff', { trinket: 'charm', regen: 0.5, effects: ['xp_boost'] }),
  I('charm_night', 'Nightseer Charm', 'charm', '#222244', '#8888cc', { trinket: 'charm', regen: 0.3, effects: ['night_vision'] }),

  // ---- X1: New materials ---------------------------------------------------
  // (the plan's bomb/repair-kit/war-horn consumables were cut: the use-item
  // path has no targeting/aoe hooks yet — items that do nothing are worse
  // than no items. Revisit when a consumable system exists.)
  I('void_shard', 'Void Shard', 'ore', '#442288', '#aa66ff'),
  I('storm_crystal', 'Storm Crystal', 'ore', '#ffcc00', '#4488ff'),
  I('scorchberry', 'Scorchberry', 'berry', '#ff4422', '#ff8800'),
  I('wispflower', 'Wispflower', 'herb', '#6644cc', '#aaddff'),
  I('ancient_oak', 'Ancient Oak', 'log', '#3a2a10', '#88aa44'),
  I('echo_dust', 'Echo Dust', 'ore', '#aaaacc', '#ffffff'),

  // ---- A5: Threads — the echo's residue, socketed into rolled gear ---------
  // Not gear: they carry no stat column, so they never roll and never equip.
  I('thread_rime', 'Rime Thread', 'thread', '#a9c8ea', '#ffffff', { thread: 'rime' }),
  I('thread_ember', 'Ember Thread', 'thread', '#e8844a', '#ffd27a', { thread: 'ember' }),
  I('thread_null', 'Null Thread', 'thread', '#8a4fc4', '#ffb0ff', { thread: 'null' }),
  I('thread_tide', 'Tide Thread', 'thread', '#3fb0bd', '#eaffff', { thread: 'tide' }),
  I('thread_thorn', 'Thorn Thread', 'thread', '#5aa24a', '#c9e6b0', { thread: 'thorn' }),
].map((d) => [d.id, d]));

// ---------------------------------------------------------------------------
// A1 — rolled items.
//
// The whole game is id-keyed: `inv` is Record<itemId, count>, `equip` is
// Record<slot, itemId>, soul items bind by id, `bestTool` scans inventory keys.
// A rolled item is UNIQUE, and forcing uniqueness into that shape by hand would
// have meant touching every one of those structures.
//
// So a rolled item gets a SYNTHETIC ID — `iron_blade#7f3a` — and the inventory,
// the equip map, the soul bindings, the ground drops and the merge logic all
// keep working completely untouched. Exactly one thing breaks: `ITEMS[id]`
// returns undefined for a synthetic id. That is what `itemDef()` below is for,
// and it is the ONLY change the other 33 lookup sites needed.
//
// `itemDef()` returns the base def with the affixes ALREADY MERGED into the
// stat columns, which is the load-bearing decision in this file: it means
// `bestWeaponDmg`, `baseStatFor`, `wornStat`, `armorDef`, `charmRegen`,
// `activeEffects` and every other existing stat reader picks up affixes for
// free, with no knowledge that rarity exists. Affixes are invisible everywhere
// except where we deliberately want to show them.

/** One affix as it actually landed on one item. The RANGES live in
 *  data/affixes.ts; the resolved ROLL lives here, which is what makes two Keen
 *  blades genuinely different blades rather than two copies of one blade. */
export interface RolledAffix {
  id: string;
  name: string;
  kind: 'prefix' | 'suffix';
  /** Which stat column it wrote to, and what it contributed. */
  stat?: 'weaponDmg' | 'armor' | 'regen' | 'toolPower';
  add?: number;
  mul?: number;
  /** A named multiplier read through gearMod(). */
  mod?: GearMod;
  modVal?: number;
  /** One of the fifteen registered effect hooks. */
  effect?: string;
  cursed?: boolean;
}

export interface RolledItem {
  /** The synthetic inventory id: `${base}#${n}`. */
  uid: string;
  /** The authored row this was rolled from. */
  base: string;
  rarity: RarityId;
  /** "Keen Iron Blade of the Ember" — prefix + base name + suffix. */
  name: string;
  affixes: RolledAffix[];
  /** A5: how many threads this piece can hold (0–3, by rarity). */
  sockets: number;
  /** state.clock at the moment it was rolled, for the run trophy. */
  bornT: number;
}

/** uid → the merged def handed to every existing consumer. */
const ROLLED_DEFS = new Map<string, ItemDef>();
/** uid → the roll itself, for the tooltip, the Bag and the scorecard trophy. */
const ROLLED = new Map<string, RolledItem>();

/** Strip the roll suffix. A base id passes through unchanged, so this is safe
 *  to call on anything. */
export function baseIdOf(id: string): string {
  const i = id.indexOf('#');
  return i < 0 ? id : id.slice(0, i);
}

export function isRolledId(id: string): boolean {
  return id.indexOf('#') >= 0;
}

/** THE resolver. Use this instead of `ITEMS[id]` everywhere — it is correct for
 *  base ids and rolled ids alike. */
export function itemDef(id: string): ItemDef | undefined {
  const d = ITEMS[id];
  if (d) return d;
  return ROLLED_DEFS.get(id) ?? ITEMS[baseIdOf(id)];
}

/** Display name, never undefined. Several call sites used to do
 *  `ITEMS[id].name` unguarded and would throw on an unknown id; this is a
 *  straight upgrade over that as well as being rarity-aware. */
export function itemName(id: string): string {
  return ROLLED.get(id)?.name ?? ITEMS[id]?.name ?? ITEMS[baseIdOf(id)]?.name ?? id;
}

/** The roll behind a uid, or undefined for an ordinary authored item. */
export function rolledOf(id: string): RolledItem | undefined {
  return ROLLED.get(id);
}

/** A5: the thread an item carries, or undefined. Authored thread items are the
 *  only carriers; nothing rolled ever has a `thread` column. */
export function threadOf(id: string): ThreadId | undefined {
  return ITEMS[id]?.thread;
}

export function registerRolled(r: RolledItem, merged: ItemDef) {
  ROLLED.set(r.uid, r);
  ROLLED_DEFS.set(r.uid, merged);
}

export function allRolled(): RolledItem[] {
  return [...ROLLED.values()];
}

/** A run is the lifetime of the registry. Called from newWorld() — without it
 *  a long session leaks every item every previous run ever dropped. */
export function resetRolled() {
  ROLLED.clear();
  ROLLED_DEFS.clear();
}
