// The terrain is a pure function of (seed, tileX, tileY) — nothing stored,
// any tile queryable at any time, so the map is infinite. Feature placement
// (trees/rocks/herbs) is one more hash roll against data-driven densities.
import { fbm } from '../../engine/noise';
import { hash2 } from '../../engine/rng';
import { M, MATERIALS } from '../data/materials';
import { FEATURES, type FeatureDef } from '../data/features';
import { lordAt } from './domains';

export const TILE = 32; // world pixels per tile

/** Push values away from 0.5 to get bolder continents/oceans out of fbm. */
const spread = (v: number, k: number) => Math.min(1, Math.max(0, 0.5 + (v - 0.5) * k));

export class WorldGen {
  /** per-biome cumulative feature table, precomputed from FEATURES densities */
  private featTable: { def: FeatureDef; cum: number }[][];

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
    // domain warp: sample elevation at a noise-shifted position → organic coasts
    const wx = tx + 14 * (fbm(tx * 0.03, ty * 0.03, this.seed ^ 0x5eed1, 3) - 0.5);
    const wy = ty + 14 * (fbm(tx * 0.03 + 97, ty * 0.03 - 131, this.seed ^ 0x5eed2, 3) - 0.5);
    // the ruling dream bends the land: its lord biases elevation & moisture, so
    // each region reads as a distinct place shaped by whoever imagines it.
    const lord = lordAt(tx, ty, this.seed);
    const e = spread(fbm(wx * 0.018, wy * 0.018, this.seed, 5) + lord.elevBias, 1.35); // elevation
    const m = fbm(tx * 0.03 + 511, ty * 0.03 + 287, this.seed ^ 0x0157, 4) + lord.moistureBias; // moisture

    if (e < 0.34) return M.DEEP;
    if (e < 0.42) return M.WATER;
    if (e < 0.455) return M.SAND;
    if (e > 0.82) return M.SNOW;
    if (e > 0.74) return M.MOUNTAIN;
    if (e > 0.66) return M.HILL;
    if (m > 0.58) return M.FOREST;
    if (m > 0.47) return M.MEADOW;
    return M.GRASS;
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
}
