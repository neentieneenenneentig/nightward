// Bakes every visual variant once at boot from the data tables, then hands
// out deterministic picks per tile. All art is seeded procgen — zero assets.
import { hash2, mulberry32 } from '../../engine/rng';
import { ramp, scale } from '../../engine/procgen/palette';
import {
  makeTileVariants, makeTreeVariants, makeRockVariants, makeHerbVariants,
  makeBushVariants, makeStump, makeBuilding, makeBlobFrames, makeWall, makeSpireVariants, Pix,
} from '../../engine/procgen/sprites';
import { M, MATERIALS } from '../data/materials';
import { FEATURES } from '../data/features';
import { BUILDINGS } from '../data/buildings';
import { ENEMIES } from '../data/enemies';
import { itemDef } from '../data/items';
import { makeIcon } from '../../engine/procgen/icons';
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
  private megaCache = new Map<string, HTMLCanvasElement>();
  private spires: HTMLCanvasElement[][];   // [0] rock, [1] snow
  private itemIcons = new Map<string, HTMLCanvasElement>();   // B5: ground-drop sprites, per item id

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
        a.kind === 'tree' ? makeTreeVariants({ canopy: a.ramp, trunk: TRUNK }, seed, 10)
        : a.kind === 'rock' ? makeRockVariants(a.ramp, a.accent, seed ^ hashId(f.id), 8)
        : a.kind === 'herb' ? makeHerbVariants(a.ramp, a.accent, seed ^ hashId(f.id), 6)
        : makeBushVariants(a.ramp, a.accent, seed ^ hashId(f.id), 6),
      );
    }
    this.stump = makeStump(TRUNK, seed);
    // G5: spires are ALWAYS cut from rock, on snow too — a snow-coloured spire
    // on a snowfield is an outline with nothing inside it. Bare crag punching
    // up through the snowpack is both readable and what a peak actually does.
    // The body is the mountain ramp SHADED DOWN. At full brightness a spire is
    // the same value as the rock it stands on and reads as an empty outline;
    // dark crag against light peak is what makes it a silhouette at all.
    const crag = MATERIALS[M.MOUNTAIN].art.ramp.map((c) => scale(c, 0.66));
    this.spires = [
      makeSpireVariants(crag, seed ^ hashId('spire'), 7),
      makeSpireVariants(crag, seed ^ hashId('spire-snow'), 7, MATERIALS[M.SNOW].art.ramp),
    ];

    for (const b of BUILDINGS) this.buildings.set(b.id, makeBuilding(b.art, seed ^ hashId(b.id)));
    for (const e of ENEMIES) this.enemies.set(e.id, makeBlobFrames(e.art, seed ^ hashId(e.id)));
  }

  tile(biome: number, tx: number, ty: number): HTMLCanvasElement {
    const v = this.tiles[biome];
    return v[(hash2(tx, ty, 0x7a11e ^ biome) * v.length) | 0];
  }

  /** G5: one of the rock spires that stand on mountain and snow. */
  spire(snow: boolean, tx: number, ty: number): HTMLCanvasElement {
    const v = this.spires[snow ? 1 : 0];
    return v[(hash2(tx, ty, 0x5919) * v.length) | 0];
  }

  /** B5: the 16×16 item icon, as a world sprite. At a 32 px tile that is exactly
   *  half a tile — the right size for an object lying on the ground, and zero new
   *  art. Cached per ITEM ID, never per drop: a night wave can have 200 drops on
   *  the floor sharing a dozen distinct textures. */
  itemIcon(id: string): HTMLCanvasElement {
    let c = this.itemIcons.get(id);
    if (!c) {
      const spec = itemDef(id)?.icon;
      c = makeIcon(spec ?? { kind: 'stone', color: [140, 140, 150] });
      this.itemIcons.set(id, c);
    }
    return c;
  }

  feature(id: string, tx: number, ty: number): HTMLCanvasElement {
    const v = this.features.get(id)!;
    return v[(hash2(tx, ty, 0xf3a7) * v.length) | 0];
  }

  /** Mega feature sprite: the tile's base variant nearest-neighbor upscaled so
   *  its width roughly covers a size×size-tile footprint. Integer scale keeps
   *  the pixels as big crisp squares — that chunky look is the point. Cached
   *  per (variant, scale) since bakes re-request the same sprites. */
  megaFeature(id: string, tx: number, ty: number, sizeTiles: number): HTMLCanvasElement {
    const variants = this.features.get(id)!;
    const vi = (hash2(tx, ty, 0xf3a7) * variants.length) | 0;
    const base = variants[vi];
    const scale = Math.max(2, Math.round((sizeTiles * TILE) / base.width));
    const key = `${id}:${vi}:${scale}`;
    let c = this.megaCache.get(key);
    if (!c) { c = scaleNearest(base, scale); this.megaCache.set(key, c); }
    return c;
  }

  /** Mega stump — the ordinary stump scaled to sit where a felled mega feature
   *  stood. Same integer nearest-neighbor treatment as megaFeature. */
  megaStump(sizeTiles: number): HTMLCanvasElement {
    const scale = Math.max(2, Math.round((sizeTiles * TILE * 0.5) / this.stump.width));
    const key = `stump:${scale}`;
    let c = this.megaCache.get(key);
    if (!c) { c = scaleNearest(this.stump, scale); this.megaCache.set(key, c); }
    return c;
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

/** Integer nearest-neighbor upscale — pixel squares stay square. */
function scaleNearest(base: HTMLCanvasElement, scale: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = base.width * scale;
  c.height = base.height * scale;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(base, 0, 0, c.width, c.height);
  return c;
}

/** tiny string hash so per-kind seeds differ deterministically */
function hashId(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return h;
}
