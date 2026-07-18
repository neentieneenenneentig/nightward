// World = pure terrain (WorldGen) + the writable override layer (WorldCore) +
// game-state overlays (depleted nodes, buildings). All walkability, movement
// speed, and effective-material questions go through here.
import { CFG } from '../data/config';
import { BUILDINGS } from '../data/buildings';
import type { FeatureDef } from '../data/features';
import { MATERIALS } from '../data/materials';
import { tileKey, type Building, type GameState } from '../state';
import { TILE, WorldGen, type MegaCluster } from './worldgen';
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
   * touch (paint DIRT on a tree tile → the tree is gone until you repaint base).
   * Tiles inside a mega-cluster report the cluster's feature. */
  featureAt(tx: number, ty: number): FeatureDef | null {
    if (this.core.overrideAt(tx, ty) >= 0) return null;
    const mega = this.megaClusterAt(tx, ty);
    if (mega) return mega.def;
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
    if (this.isDepleted(tx, ty)) return true; // gathered = clear ground
    // mega features block every tile of their square, even bush-type ones —
    // a four-tile bush is a solid mass, not shrubbery you stroll through
    if (this.megaClusterAt(tx, ty)) return false;
    const f = this.featureAt(tx, ty);
    return !(f && f.blocking);
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

  /** The mega-cluster covering a tile, or null. Painting the ROOT tile kills
   * the whole cluster (the world remembers); painting a non-root tile only
   * frees that tile — the big sprite still stands over it. */
  megaClusterAt(tx: number, ty: number): MegaCluster | null {
    if (this.core.overrideAt(tx, ty) >= 0) return null;
    const mega = this.gen.megaClusterAt(tx, ty);
    if (!mega) return null;
    if (this.core.overrideAt(mega.rootTx, mega.rootTy) >= 0) return null;
    return mega;
  }

  /** Mark a node gathered; caller is responsible for the chunk rebake. */
  deplete(tx: number, ty: number, respawnSec: number) {
    this.state.depleted[tileKey(tx, ty)] = this.state.clock + respawnSec;
  }

  /** Deplete every tile of a mega-cluster at once (one harvest fells it all). */
  depleteMega(cluster: MegaCluster, respawnSec: number) {
    for (let dy = 0; dy < cluster.size; dy++) {
      for (let dx = 0; dx < cluster.size; dx++) {
        this.deplete(cluster.rootTx + dx, cluster.rootTy + dy, respawnSec);
      }
    }
  }

  /** Building placement rule (see config.build). Also prevents placing on the player.
   *  C2: buildings can be placed within maxDistFromHall of the hall OR any waystone.
   *  Waystones themselves must be within range of the hall or another waystone. */
  canPlaceAt(tx: number, ty: number, isHall: boolean): boolean {
    if (!this.passable(tx, ty)) return false;
    if (!MATERIALS[this.materialAt(tx, ty)].buildable) return false;
    // don't let the player box themselves in
    const px = Math.floor(this.state.player.x / TILE);
    const py = Math.floor(this.state.player.y / TILE);
    if (tx === px && ty === py) return false;
    const h = this.state.buildings.find((b) => b.type === 'hall');
    if (isHall) return true;         // the first hall roots wherever you like
    if (!h) return false;            // everything else needs a hall first

    // C2: check distance to hall OR any waystone (including other waystones for new waystones)
    const maxDist = CFG.build.maxDistFromHall;
    if (this.inRangeOfAnchor(tx, ty, maxDist)) return true;
    return false;
  }

  /** C2: true if (tx,ty) is within `range` tiles of the hall or any waystone.
   *  X1: buildings with `anchorRange` (Signal Beacon) are lesser anchors with
   *  their own, smaller radius. */
  inRangeOfAnchor(tx: number, ty: number, range: number): boolean {
    for (const b of this.state.buildings) {
      // C2: decaying buildings don't count as anchors
      if ((b as any)._decaying) continue;
      let r: number;
      if (b.type === 'hall' || b.type === 'waystone') r = range;
      else {
        const ar = BUILDINGS.find((d) => d.id === b.type)?.anchorRange;
        if (!ar) continue;
        r = ar;
      }
      const d = Math.max(Math.abs(tx - b.tx), Math.abs(ty - b.ty));
      if (d <= r) return true;
    }
    return false;
  }

  /** C2: find all buildings that lose anchor connectivity when a set of anchors
   *  is removed. Returns the UIDs of disconnected buildings. */
  findDisconnected(removedAnchors: Building[]): number[] {
    const remaining = this.state.buildings.filter(
      (b) => !removedAnchors.some((r) => r.uid === b.uid),
    );
    // BFS from all remaining anchors (hall + non-decaying waystones)
    const connected = new Set<number>();
    const queue: Building[] = [];
    for (const b of remaining) {
      if (b.type === 'hall' || (b.type === 'waystone' && !(b as any)._decaying)) {
        connected.add(b.uid);
        queue.push(b);
      }
    }
    const maxDist = CFG.build.maxDistFromHall;
    while (queue.length > 0) {
      const a = queue.shift()!;
      for (const b of remaining) {
        if (connected.has(b.uid)) continue;
        const d = Math.max(Math.abs(b.tx - a.tx), Math.abs(b.ty - a.ty));
        if (d <= maxDist) {
          connected.add(b.uid);
          queue.push(b);
        }
      }
    }
    const disconnected: number[] = [];
    for (const b of remaining) {
      if (!connected.has(b.uid)) disconnected.push(b.uid);
    }
    return disconnected;
  }
}
