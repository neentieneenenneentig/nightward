// The sprite "factory". Nothing here is drawn by hand — every tile, tree and
// character frame is pixels placed by seeded math onto a small canvas, then
// upscaled crisp by the renderer. This file IS the game's art department.
import { valueNoise } from '../noise';
import { hash2, mulberry32 } from '../rng';
import { type RGB, lighten, darken } from './palette';

/** Detail styles a tile recipe can ask for (game data picks one per biome). */
export type Detail =
  | 'none' | 'grass' | 'flowers' | 'speckle' | 'waves'
  | 'forest' | 'cracks' | 'pebbles' | 'sparkle';

export interface TileRecipe {
  ramp: RGB[];          // dark → mid → light
  detail: Detail;
  accents?: RGB[];      // e.g. flower colors
}

/** Tiny pixel-plotting surface backed by ImageData. */
export class Pix {
  canvas = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D;
  private img: ImageData;
  constructor(readonly w: number, readonly h: number) {
    this.canvas.width = w;
    this.canvas.height = h;
    this.ctx = this.canvas.getContext('2d')!;
    this.img = this.ctx.createImageData(w, h);
  }
  set(x: number, y: number, c: RGB, a = 255) {
    x |= 0; y |= 0;
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 4, d = this.img.data;
    d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = a;
  }
  rect(x0: number, y0: number, x1: number, y1: number, c: RGB) {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this.set(x, y, c);
  }
  /** 1px silhouette outline — makes small sprites readable on any ground. */
  outline(c: RGB) {
    const d = this.img.data;
    const solid = (x: number, y: number) =>
      x >= 0 && y >= 0 && x < this.w && y < this.h && d[(y * this.w + x) * 4 + 3] === 255;
    const marks: [number, number][] = [];
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (d[(y * this.w + x) * 4 + 3] !== 0) continue;
        if (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1)) marks.push([x, y]);
      }
    }
    for (const [x, y] of marks) this.set(x, y, c, 220);
  }
  done() {
    this.ctx.putImageData(this.img, 0, 0);
    return this.canvas;
  }
}

// ---------------------------------------------------------------- tiles ----

export function makeTileVariants(recipe: TileRecipe, seed: number, biomeId: number, count = 4): HTMLCanvasElement[] {
  const out: HTMLCanvasElement[] = [];
  for (let v = 0; v < count; v++) {
    const p = new Pix(32, 32);

    // base: low-freq noise gives soft blotches, per-pixel hash adds dither grain
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) {
        const n = valueNoise(x * 0.14 + v * 41.7, y * 0.14 + biomeId * 13.9, seed ^ 0xba5e);
        const dith = hash2(x + v * 101, y + biomeId * 57, seed ^ 0xd17);
        const t = n * 0.65 + dith * 0.35;
        p.set(x, y, recipe.ramp[t < 0.4 ? 0 : t < 0.74 ? 1 : 2]);
      }
    }

    // detail pass: little seeded flourishes per biome
    const rand = mulberry32((seed ^ Math.imul(biomeId + 1, 2654435761)) + v * 7919);
    const R = () => (rand() * 32) | 0;
    const [dark, , light] = [recipe.ramp[0], recipe.ramp[1], recipe.ramp[2]];

    switch (recipe.detail) {
      case 'grass':
        for (let i = 0; i < 24; i++) {
          const x = R(), y = R();
          p.set(x, y, lighten(light, 14));
          p.set(x, y - 1, light);
        }
        break;
      case 'flowers': {
        for (let i = 0; i < 12; i++) p.set(R(), R(), lighten(light, 10));
        const fl = recipe.accents ?? [light];
        for (let i = 0; i < 3; i++) {
          const x = R(), y = R();
          const c = fl[(rand() * fl.length) | 0];
          p.set(x, y, lighten(c, 25));
          p.set(x - 1, y, c); p.set(x + 1, y, c);
          p.set(x, y - 1, c); p.set(x, y + 1, c);
        }
        break;
      }
      case 'speckle':
        for (let i = 0; i < 16; i++) p.set(R(), R(), darken(dark, 8));
        break;
      case 'waves':
        for (let i = 0; i < 4; i++) {
          const y = R(), x0 = (rand() * 22) | 0, len = 5 + ((rand() * 8) | 0);
          for (let j = 0; j < len; j++) p.set(x0 + j, y, lighten(light, 10));
        }
        break;
      case 'forest':
        for (let i = 0; i < 14; i++) p.set(R(), R(), darken(dark, 10));
        for (let i = 0; i < 6; i++) p.set(R(), R(), light);
        break;
      case 'cracks':
        for (let i = 0; i < 3; i++) {
          let x = R(), y = (rand() * 20) | 0;
          for (let s = 0; s < 9; s++) {
            p.set(x, y, darken(dark, 14));
            x += ((rand() * 3) | 0) - 1;
            y += 1;
          }
        }
        break;
      case 'pebbles':
        for (let i = 0; i < 5; i++) {
          const x = (rand() * 30) | 0, y = (rand() * 30) | 0;
          p.rect(x, y, x + 1, y + 1, darken(dark, 6));
          p.set(x, y, light);
        }
        break;
      case 'sparkle':
        for (let i = 0; i < 6; i++) {
          const x = R(), y = R();
          p.set(x, y, lighten(light, 20));
          if (i < 2) {
            p.set(x - 1, y, light); p.set(x + 1, y, light);
            p.set(x, y - 1, light); p.set(x, y + 1, light);
          }
        }
        break;
    }
    out.push(p.done());
  }
  return out;
}

// ---------------------------------------------------------------- trees ----

export interface TreeRecipe {
  canopy: RGB[]; // 4 shades dark → light
  trunk: RGB[];  // [dark, mid]
}

/** 26×36 tree; the canopy pokes a few px above its tile for cheap depth. */
export function makeTreeVariants(t: TreeRecipe, seed: number, count = 6): HTMLCanvasElement[] {
  const out: HTMLCanvasElement[] = [];
  for (let v = 0; v < count; v++) {
    const p = new Pix(26, 36);

    // trunk first so canopy overlaps it
    p.rect(11, 24, 14, 33, t.trunk[1]);
    for (let y = 24; y <= 33; y++) p.set(14, y, t.trunk[0]); // shaded side
    p.rect(9, 32, 16, 33, t.trunk[0]);                       // root flare

    // canopy: a noisy-edged blob, lit from the upper left
    const cx = 13, cy = 13;
    for (let y = 1; y <= 27; y++) {
      for (let x = 1; x <= 24; x++) {
        const dx = x - cx, dy = (y - cy) * 1.15;
        const d = Math.hypot(dx, dy) + (hash2(x + v * 53, y, seed ^ 0x7e31) - 0.5) * 4.5;
        if (d < 12) {
          const shade =
            -dx * 0.35 - (y - cy) * 0.55 +
            (hash2(x, y + v * 29, seed ^ 0xf01) - 0.5) * 5;
          const idx = shade > 3 ? 3 : shade > 0.5 ? 2 : shade > -3 ? 1 : 0;
          p.set(x, y, t.canopy[idx]);
        }
      }
    }
    out.push(p.done());
  }
  return out;
}

// ------------------------------------------------------- world features ----

/** 22×16 boulder, noisy edge, lit top-left; accent = ore flecks. */
export function makeRockVariants(rampArr: RGB[], accent: RGB | undefined, seed: number, count = 4): HTMLCanvasElement[] {
  const out: HTMLCanvasElement[] = [];
  for (let v = 0; v < count; v++) {
    const p = new Pix(22, 16);
    const cx = 11, cy = 9;
    for (let y = 1; y < 16; y++) {
      for (let x = 1; x < 21; x++) {
        const d = Math.hypot((x - cx) * 0.9, (y - cy) * 1.5) + (hash2(x + v * 71, y, seed ^ 0x40c4) - 0.5) * 3;
        if (d < 8) {
          const shade = -(x - cx) * 0.4 - (y - cy) * 0.9 + (hash2(x, y + v * 31, seed ^ 0x40c5) - 0.5) * 3;
          p.set(x, y, rampArr[shade > 2 ? 2 : shade > -1.5 ? 1 : 0]);
        }
      }
    }
    if (accent) {
      const rand = mulberry32(seed + v * 977);
      for (let i = 0; i < 6; i++) {
        const x = 4 + ((rand() * 14) | 0), y = 4 + ((rand() * 9) | 0);
        p.set(x, y, accent);
        if (i < 3) p.set(x + 1, y, lighten(accent, 25));
      }
    }
    p.outline([20, 18, 28]);
    out.push(p.done());
  }
  return out;
}

/** 14×15 sprig of leaves; accent = flower dots. */
export function makeHerbVariants(rampArr: RGB[], accent: RGB | undefined, seed: number, count = 4): HTMLCanvasElement[] {
  const out: HTMLCanvasElement[] = [];
  for (let v = 0; v < count; v++) {
    const p = new Pix(14, 15);
    const rand = mulberry32(seed ^ (0x4e26 + v * 331));
    for (let y = 6; y <= 13; y++) p.set(7, y, rampArr[0]); // stem
    for (let i = 0; i < 9; i++) {                          // leaves
      const x = 3 + ((rand() * 8) | 0), y = 4 + ((rand() * 8) | 0);
      p.set(x, y, rampArr[1 + ((rand() * 2) | 0)]);
      p.set(x + (rand() < 0.5 ? 1 : -1), y, rampArr[1]);
    }
    if (accent) {
      p.set(7, 3, accent);
      p.set(6, 2, lighten(accent, 20));
      p.set(8, 2, accent);
    }
    out.push(p.done());
  }
  return out;
}

/** 20×15 round bush; accent = berry dots. */
export function makeBushVariants(rampArr: RGB[], accent: RGB | undefined, seed: number, count = 4): HTMLCanvasElement[] {
  const out: HTMLCanvasElement[] = [];
  for (let v = 0; v < count; v++) {
    const p = new Pix(20, 15);
    const cx = 10, cy = 9;
    for (let y = 1; y < 15; y++) {
      for (let x = 1; x < 19; x++) {
        const d = Math.hypot((x - cx) * 0.85, (y - cy) * 1.4) + (hash2(x + v * 37, y, seed ^ 0xb054) - 0.5) * 3;
        if (d < 7.5) {
          const shade = -(x - cx) * 0.3 - (y - cy) * 0.8 + (hash2(x, y + v * 17, seed ^ 0xb055) - 0.5) * 3;
          p.set(x, y, rampArr[shade > 1.5 ? 2 : shade > -1.5 ? 1 : 0]);
        }
      }
    }
    if (accent) {
      const rand = mulberry32(seed + v * 411);
      for (let i = 0; i < 5; i++) {
        p.set(3 + ((rand() * 14) | 0), 4 + ((rand() * 8) | 0), accent);
      }
    }
    out.push(p.done());
  }
  return out;
}

/** What's left after chopping a tree. */
export function makeStump(trunk: RGB[], seed: number): HTMLCanvasElement {
  const p = new Pix(14, 11);
  p.rect(3, 3, 10, 9, trunk[1]);
  p.rect(2, 8, 11, 10, trunk[0]);          // base flare
  p.rect(4, 2, 9, 3, lighten(trunk[1], 24)); // cut face
  p.set(6, 3, trunk[0]); p.set(8, 3, trunk[0]); // rings
  p.outline([20, 18, 28]);
  void seed;
  return p.done();
}

// ------------------------------------------------------------ buildings ----

const WOOD: RGB[] = [[56, 42, 32], [82, 64, 47], [122, 92, 62]];
const STONE: RGB[] = [[74, 79, 90], [90, 95, 107], [115, 120, 135]];
const THATCH: RGB[] = [[122, 107, 59], [160, 138, 74], [194, 161, 95]];
const BANNER: RGB = [179, 64, 46];
const GLOW: RGB = [255, 217, 176];

function blocks(p: Pix, x0: number, y0: number, x1: number, y1: number, rampArr: RGB[], seed: number) {
  // stone-block pattern: 4px courses, staggered 8px blocks, per-block shade
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const row = ((y - y0) / 4) | 0;
      const col = (((x - x0) + (row % 2) * 4) / 8) | 0;
      const h = hash2(col, row, seed);
      const edge = (y - y0) % 4 === 3 || ((x - x0) + (row % 2) * 4) % 8 === 7;
      p.set(x, y, edge ? rampArr[0] : rampArr[h < 0.2 ? 0 : h < 0.75 ? 1 : 2]);
    }
  }
}

function roof(p: Pix, apexX: number, apexY: number, baseY: number, x0: number, x1: number, seed: number) {
  for (let y = apexY; y <= baseY; y++) {
    const t = (y - apexY) / (baseY - apexY);
    const half = t * ((x1 - x0) / 2);
    for (let x = Math.round(apexX - half); x <= Math.round(apexX + half); x++) {
      const h = hash2(x, y, seed);
      p.set(x, y, THATCH[y === apexY || h < 0.15 ? 2 : h < 0.8 ? 1 : 0]);
    }
  }
}

export function makeBuilding(kind: 'hall' | 'hut' | 'wall' | 'tower', seed: number): HTMLCanvasElement {
  let p: Pix;
  switch (kind) {
    case 'wall': {
      p = new Pix(32, 26);
      blocks(p, 0, 6, 31, 25, STONE, seed ^ 0xa11);
      p.rect(0, 4, 31, 5, STONE[2]); // cap
      break;
    }
    case 'tower': {
      p = new Pix(26, 46);
      blocks(p, 4, 12, 21, 45, STONE, seed ^ 0x707);
      p.rect(2, 8, 23, 12, STONE[2]);          // platform
      for (let x = 2; x <= 23; x += 4) p.rect(x, 5, x + 1, 8, STONE[1]); // crenellations
      p.rect(11, 22, 14, 27, [20, 18, 28]);    // arrow slit
      p.rect(2, 44, 23, 45, STONE[0]);         // base
      break;
    }
    case 'hut': {
      p = new Pix(30, 32);
      for (let x = 4; x <= 25; x++) {
        const shade = WOOD[x % 4 === 0 ? 0 : x % 4 < 3 ? 1 : 2];
        for (let y = 16; y <= 31; y++) p.set(x, y, shade);
      }
      roof(p, 15, 3, 17, 1, 28, seed ^ 0x447);
      p.rect(12, 22, 17, 31, [43, 32, 24]);    // door
      p.set(16, 26, GLOW);                     // handle
      break;
    }
    case 'hall': {
      p = new Pix(44, 48);
      for (let y = 22; y <= 47; y++) {
        for (let x = 4; x <= 39; x++) {
          p.set(x, y, WOOD[y % 5 === 0 ? 0 : x < 6 || x > 37 ? 0 : 1]);
        }
      }
      roof(p, 21, 2, 23, 0, 43, seed ^ 0xa77);
      p.rect(18, 34, 25, 47, [43, 32, 24]);    // big door
      p.rect(17, 33, 26, 34, WOOD[2]);         // door frame
      p.rect(8, 27, 11, 30, GLOW);             // windows
      p.rect(32, 27, 35, 30, GLOW);
      for (let y = 8, i = 0; y <= 22; y++, i++) p.set(38, y, WOOD[0]); // banner pole
      p.rect(33, 9, 37, 15, BANNER);           // the racket's colors
      p.set(35, 11, lighten(BANNER, 40));
      break;
    }
  }
  p.outline([20, 18, 28]);
  return p.done();
}

/**
 * Auto-connecting palisade segment. `mask` is a 4-bit neighbor bitmask
 * (N=1, E=2, S=4, W=8): a central post is always drawn, plus a rail toward
 * each connected side, so runs/corners/T-junctions/crosses all read distinctly.
 */
export function makeWall(mask: number, seed: number): HTMLCanvasElement {
  const p = new Pix(32, 26);
  const N = (mask & 1) !== 0, E = (mask & 2) !== 0, S = (mask & 4) !== 0, W = (mask & 8) !== 0;
  const cx0 = 11, cx1 = 20; // central post columns

  blocks(p, cx0, 4, cx1, 25, STONE, seed ^ 0xa11);
  p.rect(cx0, 4, cx1, 5, STONE[2]); // cap

  if (E) blocks(p, cx1 + 1, 10, 31, 17, STONE, seed ^ 0xa12);
  if (W) blocks(p, 0, 10, cx0 - 1, 17, STONE, seed ^ 0xa13);
  // N/S connections run "into the screen" in this pseudo-top-down view — a
  // taller cap extension is enough to read as a continuous line of posts.
  if (N) p.rect(cx0, 2, cx1, 3, STONE[1]);
  if (S) p.rect(cx0, 24, cx1, 25, STONE[1]);

  p.outline([20, 18, 28]);
  return p.done();
}

// -------------------------------------------------------------- enemies ----

export interface BlobArt { size: number; body: RGB[]; eye: RGB }

/** 2-frame wobbling horror. Size sets the canvas; bigger = scarier. */
export function makeBlobFrames(art: BlobArt, seed: number): HTMLCanvasElement[] {
  const frames: HTMLCanvasElement[] = [];
  const S = art.size;
  for (let f = 0; f < 2; f++) {
    const W = S + 6, H = S + 6;
    const p = new Pix(W, H);
    const cx = W / 2, cy = H / 2 + 1;
    const rx = (S / 2) * (f ? 1.12 : 1);      // squash & stretch
    const ry = (S / 2) * (f ? 0.88 : 1);
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        const d = Math.hypot((x - cx) / rx, (y - cy) / ry) + (hash2(x + f * 61, y, seed ^ 0xb10b) - 0.5) * 0.28;
        if (d < 1) {
          const shade = -(x - cx) * 0.3 - (y - cy) * 0.6 + (hash2(x, y + f * 43, seed ^ 0xb10c) - 0.5) * 2.5;
          p.set(x, y, art.body[shade > 1.5 ? 2 : shade > -1.5 ? 1 : 0]);
        }
      }
    }
    // eyes
    const ey = Math.round(cy - ry * 0.25) + (f ? 1 : 0);
    p.set(Math.round(cx - rx * 0.35), ey, art.eye);
    p.set(Math.round(cx + rx * 0.35), ey, art.eye);
    p.outline([15, 13, 22]);
    frames.push(p.done());
  }
  return frames;
}
