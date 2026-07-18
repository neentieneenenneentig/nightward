// The terrain is a pure function of (seed, tileX, tileY) — nothing stored,
// any tile queryable at any time, so the map is infinite. Feature placement
// (trees/rocks/herbs) is one more hash roll against data-driven densities.
import { fbm } from '../../engine/noise';
import { hash2 } from '../../engine/rng';
import { M, MATERIALS } from '../data/materials';
import { FEATURES, type FeatureDef } from '../data/features';
import { lordAt } from './domains';

export const TILE = 32; // world pixels per tile

/** A mega-feature: one BIG resource occupying a square of size×size tiles,
 *  drawn as a single chunky nearest-neighbor-scaled sprite (you can see the
 *  pixel squares — that's the point). Pure function of (seed, root coords),
 *  so it agrees across chunk borders with no stored state. */
export interface MegaCluster {
  def: FeatureDef;     // the feature type (tree/rock/bush)
  rootTx: number;      // top-left tile of the square
  rootTy: number;
  size: number;        // side length in tiles, 2..def.mega.maxSize
}

/** Largest mega size any feature can roll — chunk bakes scan this margin. */
export const MEGA_SCAN = Math.max(2, ...FEATURES.map((f) => f.mega?.maxSize ?? 0));
/** Cheap pre-filter: no root lottery can win above this. */
const MEGA_MAX_CHANCE = Math.max(0.001, ...FEATURES.map((f) => f.mega?.chance ?? 0));

/** Push values away from 0.5 to get bolder continents/oceans out of fbm. */
const spread = (v: number, k: number) => Math.min(1, Math.max(0, 0.5 + (v - 0.5) * k));

/** Pack tile coords into one number key (collision-free for |ty| < 2^20). */
const key2 = (tx: number, ty: number) => tx * 2097152 + ty;

export class WorldGen {
  /** per-biome cumulative feature table, precomputed from FEATURES densities */
  private featTable: { def: FeatureDef; cum: number }[][];
  // tileAt runs 4 fbm stacks — memoize it, it's pure. megaClusterAt scans up
  // to MEGA_SCAN² root candidates per query, so it gets its own memo. Both
  // are on the hot path of every passability check.
  private tileCache = new Map<number, number>();
  private megaCache = new Map<number, MegaCluster | null>();

  constructor(readonly seed: number) {
    // one cumulative feature table per material id; new materials (9–15) have no
    // feature densities, so their rows are simply empty.
    this.featTable = MATERIALS.map((m) => {
      let cum = 0;
      const rows: { def: FeatureDef; cum: number }[] = [];
      for (const f of FEATURES) {
        const d = f.density[m.name];
        if (d) {
          cum += d;
          rows.push({ def: f, cum });
        }
      }
      return rows;
    });
  }

  tileAt(tx: number, ty: number): number {
    const k = key2(tx, ty);
    const hit = this.tileCache.get(k);
    if (hit !== undefined) return hit;

    // domain warp: sample elevation at a noise-shifted position → organic coasts
    const wx = tx + 14 * (fbm(tx * 0.03, ty * 0.03, this.seed ^ 0x5eed1, 3) - 0.5);
    const wy = ty + 14 * (fbm(tx * 0.03 + 97, ty * 0.03 - 131, this.seed ^ 0x5eed2, 3) - 0.5);
    // the ruling network lord bends the land: its biases shift elevation & moisture,
    // so each region reads as a distinct place shaped by its governing entity.
    const lord = lordAt(tx, ty, this.seed);
    const e = spread(fbm(wx * 0.018, wy * 0.018, this.seed, 5) + lord.elevBias, 1.35); // elevation
    const m = fbm(tx * 0.03 + 511, ty * 0.03 + 287, this.seed ^ 0x0157, 4) + lord.moistureBias; // moisture

    let v: number;
    if (e < 0.34) v = M.DEEP;
    else if (e < 0.42) v = M.WATER;
    else if (e < 0.455) v = M.SAND;
    else if (e > 0.82) v = M.SNOW;
    else if (e > 0.74) v = M.MOUNTAIN;
    else if (e > 0.66) v = M.HILL;
    else if (m > 0.58) v = M.FOREST;
    else if (m > 0.47) v = M.MEADOW;
    else v = M.GRASS;

    if (this.tileCache.size > 262144) this.tileCache.clear();
    this.tileCache.set(k, v);
    return v;
  }

  featureAt(tx: number, ty: number): FeatureDef | null {
    const rows = this.featTable[this.tileAt(tx, ty)];
    if (!rows.length) return null;
    const r = hash2(tx, ty, this.seed ^ 0xfea7);
    for (const row of rows) if (r < row.cum) return row.def;
    return null;
  }

  /** Terrain-only walkability (features included, but no game-state overrides). */
  staticPassable(tx: number, ty: number): boolean {
    if (!MATERIALS[this.tileAt(tx, ty)].passable) return false;
    if (this.megaClusterAt(tx, ty)) return false; // mega features always block
    const f = this.featureAt(tx, ty);
    return !(f && f.blocking);
  }

  /** Spiral out from origin to find a comfy open grass/meadow spot. */
  findSpawn(): { x: number; y: number } {
    const open = (tx: number, ty: number) => {
      const b = this.tileAt(tx, ty);
      if (b !== M.GRASS && b !== M.MEADOW) return false;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!this.staticPassable(tx + dx, ty + dy)) return false;
        }
      }
      return true;
    };
    const pos = (tx: number, ty: number) => ({ x: (tx + 0.5) * TILE, y: (ty + 0.9) * TILE });

    if (open(0, 0)) return pos(0, 0);
    for (let r = 1; r < 400; r++) {
      for (let i = -r; i <= r; i++) {
        for (const [tx, ty] of [[i, -r], [i, r], [-r, i], [r, i]] as const) {
          if (open(tx, ty)) return pos(tx, ty);
        }
      }
    }
    return pos(0, 0);
  }

  /** The mega-cluster covering a tile, or null. Scans nearby tiles for a root
   *  that claims this one. Deterministic — a pure function of (tx, ty, seed) —
   *  and memoized, since passability checks land here every frame.
   *
   *  A root forms where (a) the root lottery hash wins against def.mega.chance,
   *  (b) the tile itself rolled that feature, and (c) the whole size×size
   *  square sits on the root's material (no trees wading into the sea). */
  megaClusterAt(tx: number, ty: number): MegaCluster | null {
    const k = key2(tx, ty);
    const hit = this.megaCache.get(k);
    if (hit !== undefined) return hit;

    let found: MegaCluster | null = null;
    outer:
    for (let dy = -(MEGA_SCAN - 1); dy <= 0; dy++) {
      for (let dx = -(MEGA_SCAN - 1); dx <= 0; dx++) {
        const rtx = tx + dx, rty = ty + dy;
        // cheap lottery first — rejects ~97% of candidates on a single hash
        const rootHash = hash2(rtx, rty, this.seed ^ 0xfea9);
        if (rootHash >= MEGA_MAX_CHANCE) continue;
        const feat = this.featureAt(rtx, rty);
        if (!feat?.mega?.enabled || rootHash >= feat.mega.chance) continue;
        const sizeHash = hash2(rtx, rty, this.seed ^ 0xfeaa);
        const size = 2 + Math.floor(sizeHash * (feat.mega.maxSize - 1)); // 2..maxSize
        if (tx < rtx || tx >= rtx + size || ty < rty || ty >= rty + size) continue;
        const rootMat = this.tileAt(rtx, rty);
        let uniform = true;
        scan:
        for (let sy = 0; sy < size; sy++) {
          for (let sx = 0; sx < size; sx++) {
            if (this.tileAt(rtx + sx, rty + sy) !== rootMat) { uniform = false; break scan; }
          }
        }
        if (!uniform) continue;
        found = { def: feat, rootTx: rtx, rootTy: rty, size };
        break outer;
      }
    }

    if (this.megaCache.size > 262144) this.megaCache.clear();
    this.megaCache.set(k, found);
    return found;
  }
}
