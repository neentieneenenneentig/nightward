// Item database. `icon` is a procgen recipe (shape kind + colors) — icons are
// drawn at runtime like everything else. Add a row = new item exists.
import { type RGB, hex } from '../../engine/procgen/palette';

export type IconKind =
  | 'log' | 'plank' | 'stone' | 'ore' | 'bar'
  | 'herb' | 'berry' | 'axe' | 'pick' | 'sword' | 'potion' | 'armor'
  | 'ring' | 'amulet' | 'charm' | 'torch' | 'charcoal';

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
  I('log', 'Timber', 'log', '#6b4a38'),
  I('fine_log', 'Fine Timber', 'log', '#8a5a38', '#c2a15f'),
  I('plank', 'Plank', 'plank', '#a3794f'),
  I('stone', 'Runestone', 'stone', '#737887'),
  I('copper_ore', 'Copper Ore', 'ore', '#5a5f6b', '#c47b3b'),
  I('iron_ore', 'Iron Ore', 'ore', '#5a5f6b', '#9aa7b8'),
  I('copper_bar', 'Copper Bar', 'bar', '#c47b3b'),
  I('iron_bar', 'Iron Bar', 'bar', '#9aa7b8'),
  // herbs & food
  I('sunleaf', 'Sunleaf', 'herb', '#569a53', '#e6c86e'),
  I('moonbell', 'Moonbell', 'herb', '#3f8148', '#c9a0dc'),
  I('berry', 'Wild Berries', 'berry', '#b3402e', '#569a53'),
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
  I('torch', 'Torch', 'torch', '#c47b3b', '#ffd27a'),
  I('charcoal', 'Charcoal', 'charcoal', '#232023', '#3a3a3e'),
].map((d) => [d.id, d]));
