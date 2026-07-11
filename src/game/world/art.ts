// Bakes every visual variant once at boot from the data tables, then hands
// out deterministic picks per tile. All art is seeded procgen — zero assets.
import { hash2 } from '../../engine/rng';
import { ramp } from '../../engine/procgen/palette';
import {
  makeTileVariants, makeTreeVariants, makeRockVariants, makeHerbVariants,
  makeBushVariants, makeStump, makeBuilding, makeBlobFrames, makeWall,
} from '../../engine/procgen/sprites';
import { MATERIALS } from '../data/materials';
import { FEATURES } from '../data/features';
import { BUILDINGS } from '../data/buildings';
import { ENEMIES } from '../data/enemies';

const TRUNK = ramp('#382a20', '#52402f');

export class WorldArt {
  private tiles: HTMLCanvasElement[][];
  private features = new Map<string, HTMLCanvasElement[]>();
  stump: HTMLCanvasElement;
  buildings = new Map<string, HTMLCanvasElement>();
  enemies = new Map<string, HTMLCanvasElement[]>();
  private wallSeed: number;
  private wallVariants = new Map<number, HTMLCanvasElement>();

  constructor(seed: number) {
    this.wallSeed = seed ^ hashId('wall-variant');
    // one variant set per material id; makeTileVariants reads the art recipe
    // (ramp/detail/accents), which every MaterialDef carries under `.art`.
    this.tiles = MATERIALS.map((m, i) => makeTileVariants(m.art, seed, i, 4));

    for (const f of FEATURES) {
      const a = f.art;
      this.features.set(
        f.id,
        a.kind === 'tree' ? makeTreeVariants({ canopy: a.ramp, trunk: TRUNK }, seed, 6)
        : a.kind === 'rock' ? makeRockVariants(a.ramp, a.accent, seed ^ hashId(f.id), 4)
        : a.kind === 'herb' ? makeHerbVariants(a.ramp, a.accent, seed ^ hashId(f.id), 4)
        : makeBushVariants(a.ramp, a.accent, seed ^ hashId(f.id), 4),
      );
    }
    this.stump = makeStump(TRUNK, seed);

    for (const b of BUILDINGS) this.buildings.set(b.id, makeBuilding(b.art, seed ^ hashId(b.id)));
    for (const e of ENEMIES) this.enemies.set(e.id, makeBlobFrames(e.art, seed ^ hashId(e.id)));
  }

  tile(biome: number, tx: number, ty: number): HTMLCanvasElement {
    const v = this.tiles[biome];
    return v[(hash2(tx, ty, 0x7a11e ^ biome) * v.length) | 0];
  }

  feature(id: string, tx: number, ty: number): HTMLCanvasElement {
    const v = this.features.get(id)!;
    return v[(hash2(tx, ty, 0xf3a7) * v.length) | 0];
  }

  /** Auto-connecting palisade art for a given N/E/S/W neighbor bitmask, cached. */
  wall(mask: number): HTMLCanvasElement {
    let t = this.wallVariants.get(mask);
    if (!t) { t = makeWall(mask, this.wallSeed); this.wallVariants.set(mask, t); }
    return t;
  }
}

/** tiny string hash so per-kind seeds differ deterministically */
function hashId(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return h;
}
