// World = pure terrain (WorldGen) + game-state overlays (depleted nodes,
// buildings). All walkability questions go through here.
import { CFG } from '../data/config';
import type { FeatureDef } from '../data/features';
import { BIOMES } from '../data/biomes';
import { tileKey, type Building, type GameState } from '../state';
import { TILE, WorldGen } from './worldgen';

export class World {
  private buildingIndex = new Map<string, Building>();

  constructor(readonly gen: WorldGen, readonly state: GameState) {
    this.reindexBuildings();
  }

  /** Call after any building is added or destroyed. */
  reindexBuildings() {
    this.buildingIndex.clear();
    for (const b of this.state.buildings) this.buildingIndex.set(tileKey(b.tx, b.ty), b);
  }

  buildingAt(tx: number, ty: number): Building | null {
    return this.buildingIndex.get(tileKey(tx, ty)) ?? null;
  }

  featureAt(tx: number, ty: number): FeatureDef | null {
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
    if (!BIOMES[this.gen.tileAt(tx, ty)].passable) return false;
    if (this.buildingAt(tx, ty)) return false;
    const f = this.featureAt(tx, ty);
    return !(f && f.blocking && !this.isDepleted(tx, ty));
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
    const h = this.state.buildings.find((b) => b.type === 'hall');
    if (isHall) return true;         // the first hall roots wherever you like
    if (!h) return false;            // everything else needs a hall first
    const d = Math.max(Math.abs(tx - h.tx), Math.abs(ty - h.ty));
    return d <= CFG.build.maxDistFromHall;
  }
}
