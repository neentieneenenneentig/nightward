// The single source of truth. Everything that must survive a reload lives in
// this plain-JSON-able object; systems are functions that mutate it.
import { CFG } from './data/config';
import { ITEMS } from './data/items';
import type { SoulSlot } from './data/soulgear';

export interface Building {
  uid: number;
  type: string; // id in buildings.ts
  tx: number;
  ty: number;
  hp: number;
}

/** A roaming domain lord on the overworld (see systems/worldbosses.ts). */
export interface WorldBoss {
  uid: number;
  defId: string;      // enemy id (a boss)
  lordId: string;
  name: string;
  x: number; y: number;
  px: number; py: number;
  hp: number; maxHp: number;
  dmg: number;
  level: number;      // scales up each time it's slain and re-forms
  atkT: number;
  telegraphT: number; // >0 while committed to a telegraphed hit landing
  animT: number;
  hunting: boolean;
  provokedUntil: number; // clock time until which a landed hit forces hunting=true
  reviveAt: number;   // 0 = alive; else clock time it rises again
  homeGx: number; homeGy: number;
}

export interface GameState {
  v: 1;
  seed: number;
  clock: number;                      // game seconds since world start
  nextUid: number;
  player: {
    x: number; y: number;
    hp: number;
    gold: number;
    inv: Record<string, number>;      // itemId → count
    xp: Record<string, number>;       // skillId → total xp
    equip: Equip;                     // gear worn in each slot
    soulItems: Partial<Record<SoulSlot, SoulItem>>; // per-slot soul-bound leveling
    echoes: Record<string, number>;   // C1: echoId → level (Echoes of the Slain)
    vigor: number;                    // S1: survival vital (0-100)
    resolve: number;                  // S1: survival vital (0-100)
    lastActionT: number;              // S1: clock time of last non-idle action
  };
  /** tileKey "tx,ty" → clock time when the node respawns */
  depleted: Record<string, number>;
  buildings: Building[];
  worldBosses: WorldBoss[];
  region: string;                      // region key the player is currently in
  explored: Record<string, number>;    // region key → 1 (for fog / future minimap)
  nightsSurvived: number;
  gameOver: boolean;
  god: boolean;                        // debug/test mode: immortal, everything unlocked
}

/** Worn gear, one item id per slot (undefined = empty). */
export interface Equip {
  weapon?: string;
  armor?: string;
  ring?: string;
  amulet?: string;
  charm?: string;
}

/** A slot's soul-bound tool: `templateId` is whichever physical item currently
 * fills the slot (its base stat); `level`/`xp` are the tool's own cultivated
 * power, which persists across every upgrade — see data/soulgear.ts. */
export interface SoulItem {
  slot: SoulSlot;
  templateId: string;
  level: number;
  xp: number;
}

export const tileKey = (tx: number, ty: number) => tx + ',' + ty;

export function newState(seed: number, spawn: { x: number; y: number }): GameState {
  const inv: Record<string, number> = {};
  const soulItems: Partial<Record<SoulSlot, SoulItem>> = {};
  for (const s of CFG.player.startingItems) {
    inv[s.id] = (inv[s.id] ?? 0) + s.n;
    // starting tools are soul-bound from the first swing too, at level 1
    const cls = ITEMS[s.id]?.toolClass;
    if (cls) {
      const slot: SoulSlot = cls === 'axe' ? 'tool_axe' : 'tool_pick';
      soulItems[slot] = { slot, templateId: s.id, level: 1, xp: 0 };
    }
  }
  return {
    v: 1,
    seed,
    clock: 0,
    nextUid: 1,
    player: { x: spawn.x, y: spawn.y, hp: CFG.player.maxHp, gold: 0, inv, xp: {}, equip: {}, soulItems, echoes: {}, vigor: CFG.vitals.vigorMax, resolve: CFG.vitals.resolveMax, lastActionT: 0 },
    depleted: {},
    buildings: [],
    worldBosses: [],
    region: '',
    explored: {},
    nightsSurvived: 0,
    gameOver: false,
    god: false,
  };
}
