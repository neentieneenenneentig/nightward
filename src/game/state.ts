// The single source of truth. Everything that must survive a reload lives in
// this plain-JSON-able object; systems are functions that mutate it.
import { CFG } from './data/config';

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
  animT: number;
  hunting: boolean;
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
  };
  /** tileKey "tx,ty" → clock time when the node respawns */
  depleted: Record<string, number>;
  buildings: Building[];
  worldBosses: WorldBoss[];
  region: string;                      // region key the player is currently in
  explored: Record<string, number>;    // region key → 1 (for fog / future minimap)
  nightsSurvived: number;
  gameOver: boolean;
}

/** Worn gear, one item id per slot (undefined = empty). */
export interface Equip {
  weapon?: string;
  armor?: string;
}

export const tileKey = (tx: number, ty: number) => tx + ',' + ty;

export function newState(seed: number, spawn: { x: number; y: number }): GameState {
  const inv: Record<string, number> = {};
  for (const s of CFG.player.startingItems) inv[s.id] = (inv[s.id] ?? 0) + s.n;
  return {
    v: 1,
    seed,
    clock: 0,
    nextUid: 1,
    player: { x: spawn.x, y: spawn.y, hp: CFG.player.maxHp, gold: 0, inv, xp: {}, equip: {} },
    depleted: {},
    buildings: [],
    worldBosses: [],
    region: '',
    explored: {},
    nightsSurvived: 0,
    gameOver: false,
  };
}
