// Bakes every visual variant once at boot from the data tables, then hands
// out deterministic picks per tile. All art is seeded procgen — zero assets.
import { hash2, mulberry32 } from '../../engine/rng';
import { ramp } from '../../engine/procgen/palette';
import {
  makeTileVariants, makeTreeVariants, makeRockVariants, makeHerbVariants,
  makeBushVariants, makeStump, makeBuilding, makeBlobFrames, makeWall, Pix,
} from '../../engine/procgen/sprites';
import { MATERIALS } from '../data/materials';
import { FEATURES } from '../data/features';
import { BUILDINGS } from '../data/buildings';
import { ENEMIES } from '../data/enemies';
import { TILE } from './worldgen';

const TRUNK = ramp('#382a20', '#52402f');

/** dual-grid feather: layered near-edge strips of the neighbor's own texture,
 * widest+faintest to narrowest+strongest, so the border reads as a soft
 * gradient of real neighbor pixels instead of a flat blend. */
const FEATHER_LAYERS = [{ depth: 10, alpha: 0.22 }, { depth: 6, alpha: 0.4 }, { depth: 3, alpha: 0.6 }];

/** One of 3 deterministic pale-fleck overlay frames — transparent everywhere
 * except sparse foam specks. Frame index is time-driven at display time, not
 * random; the same frame index always looks identical on every bake. */
function makeFoamFrame(seed: number, frame: number): HTMLCanvasElement {
  const p = new Pix(TILE, TILE);
  const rand = mulberry32(seed + frame * 733);
  const n = 9 + frame * 2;
  for (let i = 0; i < n; i++) {
    const x = (rand() * TILE) | 0, y = (rand() * TILE) | 0;
    p.set(x, y, [214, 232, 245], 90 + ((rand() * 100) | 0));
  }
  return p.done();
}

export class WorldArt {
  private tiles: HTMLCanvasElement[][];
  private features = new Map<string, HTMLCanvasElement[]>();
  stump: HTMLCanvasElement;
  buildings = new Map<string, HTMLCanvasElement>();
  enemies = new Map<string, HTMLCanvasElement[]>();
  private wallSeed: number;
  private wallVariants = new Map<number, HTMLCanvasElement>();
  private foamSeed: number;
  private foamFrames: HTMLCanvasElement[];

  constructor(seed: number) {
    this.wallSeed = seed ^ hashId('wall-variant');
    this.foamSeed = seed ^ hashId('foam');
    this.foamFrames = [0, 1, 2].map((f) => makeFoamFrame(this.foamSeed, f));
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

  /** Dual-grid transition: feather material `m`'s own texture (picked at the
   * neighbor's tile coords, matching what actually bakes there) across the
   * shared edge into a destination tile at pixel origin (px0,py0). `edge` is
   * the direction from the destination tile TOWARD the neighbor. */
  feather(ctx: CanvasRenderingContext2D, m: number, ntx: number, nty: number, edge: 'N' | 'E' | 'S' | 'W', px0: number, py0: number) {
    const src = this.tile(m, ntx, nty);
    for (const { depth, alpha } of FEATHER_LAYERS) {
      ctx.globalAlpha = alpha;
      switch (edge) {
        case 'S': ctx.drawImage(src, 0, 0, TILE, depth, px0, py0 + TILE - depth, TILE, depth); break;
        case 'N': ctx.drawImage(src, 0, TILE - depth, TILE, depth, px0, py0, TILE, depth); break;
        case 'E': ctx.drawImage(src, 0, 0, depth, TILE, px0 + TILE - depth, py0, depth, TILE); break;
        case 'W': ctx.drawImage(src, TILE - depth, 0, depth, TILE, px0, py0, depth, TILE); break;
      }
    }
    ctx.globalAlpha = 1;
  }

  /** Soft radial-gradient contact shadow, dark center fading to transparent. */
  shadow(ctx: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number, alpha = 0.3) {
    if (rx <= 0 || ry <= 0) return;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(1, ry / rx);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
    g.addColorStop(0, `rgba(10,8,14,${alpha})`);
    g.addColorStop(1, 'rgba(10,8,14,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, rx, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /** One of 3 deterministic shoreline-foam overlay frames (see makeFoamFrame). */
  foam(frame: 0 | 1 | 2): HTMLCanvasElement {
    return this.foamFrames[frame];
  }

  /** Warm additive glow blob — same radial-gradient shape as shadow(), fire-colored. Meant to be
   * composited with Sprite blendMode 'add' on a per-chunk fire overlay canvas (R2). */
  glow(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, alpha: number) {
    if (r <= 0) return;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, `rgba(255,170,60,${alpha})`);
    g.addColorStop(0.6, `rgba(255,90,20,${alpha * 0.5})`);
    g.addColorStop(1, 'rgba(255,60,10,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** tiny string hash so per-kind seeds differ deterministically */
function hashId(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return h;
}
