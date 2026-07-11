// World = pure terrain (WorldGen) + the writable override layer (WorldCore) +
// game-state overlays (depleted nodes, buildings). All walkability, movement
// speed, and effective-material questions go through here.
import { CFG } from '../data/config';
import type { FeatureDef } from '../data/features';
import { MATERIALS } from '../data/materials';
import { tileKey, type Building, type GameState } from '../state';
import { TILE, WorldGen } from './worldgen';
import type { WorldCore } from './core';

const CHUNK = 16; // keep in sync with chunkmap.ts / WorldCore

export class World {
  private buildingIndex = new Map<string, Building>();

  constructor(readonly gen: WorldGen, readonly state: GameState, readonly core: WorldCore) {
    this.reindexBuildings();
  }

  /** Call after any building is added or destroyed. Also re-pins the chunks that
   * contain buildings so owned territory stays authoritative off-screen. */
  reindexBuildings() {
    this.buildingIndex.clear();
    const pins = new Set<string>();
    for (const b of this.state.buildings) {
      this.buildingIndex.set(tileKey(b.tx, b.ty), b);
      pins.add(Math.floor(b.tx / CHUNK) + ',' + Math.floor(b.ty / CHUNK));
    }
    this.core.pin(pins);
  }

  buildingAt(tx: number, ty: number): Building | null {
    return this.buildingIndex.get(tileKey(tx, ty)) ?? null;
  }

  /** Effective material id at a tile (procgen base + any override). */
  materialAt(tx: number, ty: number): number {
    return this.core.materialAt(tx, ty);
  }

  /** A painted-over tile has lost its procgen feature — the world remembers your
   * touch (paint DIRT on a tree tile → the tree is gone until you repaint base). */
  featureAt(tx: number, ty: number): FeatureDef | null {
    if (this.core.overrideAt(tx, ty) >= 0) return null;
    return this.gen.featureAt(tx, ty);
  }

  isDepleted(tx: number, ty: number): boolean {
    const until = this.state.depleted[tileKey(tx, ty)];
    return until !== undefined && until > this.state.clock;
  }

  /** The feature if it's currently harvestable (exists and not depleted). */
  activeFeatureAt(tx: number, ty: number): FeatureDef | null {
    const f = this.featureAt(tx, ty);
    return f && !this.isDepleted(tx, ty) ? f : null;
  }

  passable(tx: number, ty: number): boolean {
    if (!MATERIALS[this.materialAt(tx, ty)].passable) return false;
    if (this.buildingAt(tx, ty)) return false;
    const f = this.featureAt(tx, ty);
    return !(f && f.blocking && !this.isDepleted(tx, ty));
  }

  /** Movement multiplier for the material under a tile (1 = normal). */
  speedAt(tx: number, ty: number): number {
    return MATERIALS[this.materialAt(tx, ty)].speedMult;
  }

  /** Character standing at world-pixel (px, py) — samples a feet box. */
  canStand(px: number, py: number, halfW = 6): boolean {
    for (const dx of [-halfW, halfW]) {
      for (const dy of [0, -8]) {
        if (!this.passable(Math.floor((px + dx) / TILE), Math.floor((py + dy) / TILE))) return false;
      }
    }
    return true;
  }

  /** Mark a node gathered; caller is responsible for the chunk rebake. */
  deplete(tx: number, ty: number, respawnSec: number) {
    this.state.depleted[tileKey(tx, ty)] = this.state.clock + respawnSec;
  }

  /** Building placement rule (see config.build). */
  canPlaceAt(tx: number, ty: number, isHall: boolean): boolean {
    if (!this.passable(tx, ty)) return false;
    if (!MATERIALS[this.materialAt(tx, ty)].buildable) return false;
    const h = this.state.buildings.find((b) => b.type === 'hall');
    if (isHall) return true;         // the first hall roots wherever you like
    if (!h) return false;            // everything else needs a hall first
    const d = Math.max(Math.abs(tx - h.tx), Math.abs(ty - h.ty));
    return d <= CFG.build.maxDistFromHall;
  }
}
