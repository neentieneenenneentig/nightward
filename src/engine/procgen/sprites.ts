// The sprite "factory". Nothing here is drawn by hand — every tile, tree and
// character frame is pixels placed by seeded math onto a small canvas, then
// upscaled crisp by the renderer. This file IS the game's art department.
import { valueNoise } from '../noise';
import { hash2, mulberry32 } from '../rng';
import { type RGB, PLAYER_POOL, lighten, darken } from './palette';

/** Detail styles a tile recipe can ask for (game data picks one per biome). */
export type Detail =
  | 'none' | 'grass' | 'flowers' | 'speckle' | 'waves'
  | 'forest' | 'cracks' | 'pebbles' | 'sparkle' | 'wet' | 'furrows';

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
      case 'wet':
        for (let i = 0; i < 3; i++) {
          const x = R(), y = R(), len = 3 + ((rand() * 3) | 0);
          for (let j = 0; j < len; j++) p.set(x + j, y, lighten(light, 22));
        }
        for (let i = 0; i < 2; i++) {
          const x = R(), y = R();
          p.set(x, y, darken(dark, 18));
          p.set(x + 1, y, lighten(light, 16));
        }
        break;
      case 'furrows':
        for (let row = 3; row < 32; row += 7) {
          for (let x = 0; x < 32; x++) {
            const jy = ((hash2(x, row, seed ^ biomeId) - 0.5) * 1.6) | 0;
            p.set(x, row + jy, darken(dark, 16));
            p.set(x, row + jy - 1, lighten(light, 10));
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

// ------------------------------------------------------------- character ----

export interface PlayerFrames {
  down: HTMLCanvasElement[];
  up: HTMLCanvasElement[];
  side: HTMLCanvasElement[]; // drawn facing right; renderer flips for left
}

/** 20×26 hero, 2 walk frames per direction, outfit rolled from the seed. */
export function makePlayerFrames(seed: number): PlayerFrames {
  const rand = mulberry32(seed ^ 0x4e40);
  const pick = (a: RGB[]) => a[(rand() * a.length) | 0];
  const skin = pick(PLAYER_POOL.skin);
  const hair = pick(PLAYER_POOL.hair);
  const tunic = pick(PLAYER_POOL.cloth);
  const pants = pick(PLAYER_POOL.pants);
  const boots = pick(PLAYER_POOL.boots);
  const eye: RGB = [26, 26, 36];
  const belt = darken(tunic, 20);

  // leg with optional 1px lift (the walk cycle is legs alternating lifts)
  const leg = (p: Pix, x: number, lift: number) => {
    p.rect(x, 19, x + 1, 23 - lift, pants);
    p.rect(x, 24 - lift, x + 1, 25 - lift, boots);
  };

  const frame = (dir: 'down' | 'up' | 'side', step: 0 | 1): HTMLCanvasElement => {
    const p = new Pix(20, 26);
    const o = step === 1 ? -1 : 0; // torso bob on the off-step

    if (dir === 'side') {
      if (step === 0) { leg(p, 7, 0); leg(p, 11, 1); }
      else { leg(p, 7, 1); leg(p, 11, 0); }
      p.rect(6, 10 + o, 13, 17 + o, tunic);
      p.rect(6, 18 + o, 13, 18 + o, belt);
      p.rect(7, 5 + o, 12, 9 + o, skin);            // head
      p.rect(6, 2 + o, 13, 4 + o, hair);            // top
      p.rect(6, 5 + o, 8, 7 + o, hair);             // back of head
      p.set(11, 7 + o, eye);
      p.rect(12, 11 + o + step, 13, 15 + o + step, tunic); // swinging arm
      p.set(12, 16 + o + step, skin);                      // hand
    } else {
      if (step === 0) { leg(p, 7, 0); leg(p, 11, 1); }
      else { leg(p, 7, 1); leg(p, 11, 0); }
      p.rect(5, 10 + o, 14, 17 + o, tunic);
      p.rect(5, 18 + o, 14, 18 + o, belt);
      // arms swing opposite each other
      const aL = step ? 2 : 0, aR = step ? 0 : 2;
      p.rect(4, 11 + o + aL, 4, 15 + o + aL, skin);
      p.rect(15, 11 + o + aR, 15, 15 + o + aR, skin);
      p.rect(6, 5 + o, 13, 9 + o, skin);            // head
      if (dir === 'down') {
        p.rect(5, 2 + o, 14, 4 + o, hair);
        p.rect(6, 5 + o, 13, 5 + o, hair);          // fringe
        p.set(8, 7 + o, eye);
        p.set(11, 7 + o, eye);
      } else {
        p.rect(5, 2 + o, 14, 7 + o, hair);          // hair covers the back
      }
    }
    p.outline([20, 18, 28]);
    return p.done();
  };

  return {
    down: [frame('down', 0), frame('down', 1)],
    up: [frame('up', 0), frame('up', 1)],
    side: [frame('side', 0), frame('side', 1)],
  };
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

const WOOD: RGB[] = [[56, 42, 32], [82, 64, 47], [122, 92, 62], [145, 110, 75]];
const STONE: RGB[] = [[60, 65, 78], [80, 85, 98], [105, 110, 125], [130, 135, 148]];
const THATCH: RGB[] = [[102, 87, 49], [140, 118, 64], [175, 148, 85], [198, 170, 110]];
const BANNER: RGB = [179, 64, 46];
const GLOW: RGB = [255, 217, 176];
const MORTAR: RGB = [48, 52, 62];

function blocks(p: Pix, x0: number, y0: number, x1: number, y1: number, rampArr: RGB[], seed: number) {
  // stone-block pattern: 4px courses, staggered 8px blocks, per-block shade, mortar lines
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const row = ((y - y0) / 4) | 0;
      const col = (((x - x0) + (row % 2) * 4) / 8) | 0;
      const h = hash2(col, row, seed);
      const isMortar = (y - y0) % 4 === 3 || ((x - x0) + (row % 2) * 4) % 8 === 7;
      if (isMortar) {
        p.set(x, y, MORTAR);
      } else {
        const corner = ((x - x0) % 8 < 2 && (y - y0) % 4 < 2);
        p.set(x, y, corner ? rampArr[3] : rampArr[h < 0.2 ? 0 : h < 0.7 ? 1 : h < 0.9 ? 2 : 3]);
      }
    }
  }
  // random moss/weathering dots
  const rand = mulberry32(seed ^ 0xa1);
  for (let i = 0; i < ((x1 - x0) * (y1 - y0)) / 20; i++) {
    const mx = x0 + ((rand() * (x1 - x0 + 1)) | 0);
    const my = y0 + ((rand() * (y1 - y0 + 1)) | 0);
    p.set(mx, my, rampArr[0]);
    if (rand() < 0.3) p.set(mx + 1, my, rampArr[1]);
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

export function makeBuilding(kind: 'hall' | 'hut' | 'wall' | 'tower' | 'campfire', seed: number): HTMLCanvasElement {
  const rand = mulberry32(seed ^ 0xb1d);
  let p: Pix;
  switch (kind) {
    case 'wall': {
      p = new Pix(32, 26);
      blocks(p, 2, 6, 29, 24, STONE, seed ^ 0xa11);
      // crenellated cap
      for (let x = 2; x <= 29; x += 4) p.rect(x, 3, x + 2, 5, STONE[2]);
      p.rect(2, 4, 29, 4, STONE[3]); // cap highlight
      break;
    }
    case 'tower': {
      p = new Pix(28, 50);
      blocks(p, 3, 12, 24, 48, STONE, seed ^ 0x707);
      // platform + crenellations
      p.rect(1, 8, 26, 12, STONE[2]);
      for (let x = 1; x <= 23; x += 3) {
        p.rect(x, 4, x + 2, 8, STONE[2]);
        p.set(x + 1, 4, STONE[3]);
      }
      // arrow slit
      p.rect(12, 20, 15, 30, [15, 13, 22]);
      p.set(13, 20, STONE[3]);
      // base flare
      p.rect(1, 47, 26, 49, STONE[0]);
      p.set(13, 49, STONE[3]);
      break;
    }
    case 'hut': {
      p = new Pix(30, 34);
      // wood planks with grain
      for (let y = 15; y <= 33; y++) {
        for (let x = 5; x <= 24; x++) {
          const plank = ((x - 5) / 5) | 0;
          const grain = (y + plank * 3) % 5 < 2 ? WOOD[1] : WOOD[2];
          p.set(x, y, x < 6 || x > 23 ? WOOD[0] : grain);
        }
      }
      // vertical plank seams
      for (let x = 10; x <= 19; x += 5) {
        for (let y = 15; y <= 33; y++) p.set(x, y, WOOD[0]);
      }
      // thatched roof with texture
      roof(p, 15, 2, 16, 2, 27, seed ^ 0x447);
      // roof edge highlight
      for (let x = 3; x <= 26; x++) p.set(x, 16, THATCH[3]);
      // door with frame
      p.rect(12, 21, 17, 33, [38, 28, 20]);
      p.rect(11, 20, 18, 21, WOOD[0]);  // lintel
      p.set(16, 28, GLOW);               // handle glow
      // small window
      p.rect(20, 23, 23, 26, GLOW);
      p.set(20, 24, [255, 230, 200]);    // warm highlight
      break;
    }
    case 'hall': {
      p = new Pix(48, 52);
      // grand timber frame
      for (let y = 22; y <= 51; y++) {
        for (let x = 5; x <= 42; x++) {
          const plank = ((x - 5) / 6) | 0;
          const grain = (y + plank * 2) % 6 < 2 ? WOOD[2] : WOOD[1];
          const beam = (x >= 8 && x <= 10) || (x >= 37 && x <= 39) || (y >= 22 && y <= 24);
          p.set(x, y, beam ? WOOD[0] : grain);
        }
      }
      // corner posts
      for (let y = 22; y <= 51; y++) { p.set(5, y, WOOD[0]); p.set(42, y, WOOD[0]); }
      // steep thatched roof
      roof(p, 24, 1, 23, 2, 45, seed ^ 0xa77);
      for (let x = 4; x <= 43; x++) p.set(x, 23, THATCH[3]); // eave highlight
      // grand double door
      p.rect(18, 34, 29, 51, [42, 30, 22]);
      p.rect(17, 33, 30, 34, WOOD[2]);   // stone lintel
      // door handles
      p.set(20, 42, GLOW); p.set(27, 42, GLOW);
      // stained-glass windows
      for (let wy = 26; wy <= 30; wy++) {
        p.set(9, wy, GLOW); p.set(10, wy, [130, 180, 255]);
        p.set(37, wy, GLOW); p.set(38, wy, [130, 180, 255]);
      }
      // banner pole + banner
      for (let y = 7; y <= 24; y++) p.set(41, y, WOOD[0]);
      p.rect(36, 8, 40, 16, BANNER);
      p.set(38, 10, lighten(BANNER, 45)); // banner highlight
      p.set(38, 12, [220, 90, 70]);       // emblem dot
      break;
    }
    case 'campfire': {
      p = new Pix(22, 16);
      const stones: [number, number][] = [[2,13],[4,14],[7,14],[11,14],[15,14],[18,13],[19,11],[17,10],[14,10],[10,10],[6,10],[3,11]];
      for (let i = 0; i < stones.length; i++) {
        const [x, y] = stones[i];
        const sc = STONE[1 + (i % 3)];
        p.rect(x, y, x + 1, y + 1, sc);
        p.set(x, y - 1, STONE[2]); // top highlight
      }
      // crossed logs
      for (let i = 0; i < 10; i++) { p.set(6 + i, 12 - ((i / 3) | 0), WOOD[2]); p.set(7 + i, 12 - ((i / 3) | 0), WOOD[1]); }
      for (let i = 0; i < 10; i++) { p.set(15 - i, 12 - ((i / 3) | 0), WOOD[1]); p.set(14 - i, 12 - ((i / 3) | 0), WOOD[0]); }
      // ember core
      p.set(10, 9, [255, 160, 60]); p.set(11, 8, [255, 210, 130]); p.set(11, 10, [255, 100, 30]);
      p.set(9, 9, [200, 80, 20]);
      break;
    }
  }
  p.outline([18, 16, 26]);
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
