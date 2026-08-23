// ============================================================================
// SR4 — Bloom, done on the GPU and in the right place.
//
// What it replaces, and why that was worth doing:
//
//   1. BloomPass drew radial gradients into a quarter-res <canvas>, then ran a
//      3x3 box blur THREE TIMES in JavaScript over every pixel. On a 1080p
//      screen that is ~1.5 million array operations a frame, bracketed by a
//      getImageData/putImageData pair — and getImageData is a pipeline stall,
//      the CPU waiting on the GPU. It was almost certainly the single most
//      expensive thing in the frame, and it produced a soft grey blob.
//
//   2. It was also in the WRONG COORDINATE SPACE. Callers pass world pixels
//      (`(b.tx + 0.5) * TILE`), and the pass drew them into a screen-sized
//      canvas as if they were screen pixels. The campfire glow has been landing
//      somewhere else entirely for the whole life of the feature — visible only
//      as a faint smear near the origin. Nobody filed it because a bloom that is
//      subtle by design and wrong by accident look identical from the sofa.
//
// The fix for (2) is not arithmetic, it is PARENTAGE: put the glow layer inside
// the camera container and world coordinates become correct by construction.
// There is no toScreen call to get wrong, and no resize handler to forget.
//
// The fix for (1) is that a Gaussian blur is what a GPU is for.
//
// Everything here is still 100% procedural — one 64x64 radial falloff generated
// at boot, tinted and scaled per light. Pillar 1 was never what held the look
// back; the absence of a shader pipeline was.
// ============================================================================
import { BlurFilter, Container, Sprite, Texture } from 'pixi.js';

export interface GlowSpot {
  /** WORLD pixels. The layer lives under the camera, so these are honest. */
  x: number;
  y: number;
  /** World-pixel radius of the falloff. */
  radius: number;
  /** 0..1. */
  intensity: number;
  /** RGB 0..255. */
  color: [number, number, number];
}

/** One soft dot, generated once. Squared falloff rather than linear — a linear
 *  radial gradient has a visible edge where it hits zero, and the whole job of
 *  this texture is to not have one. */
function makeFalloff(size = 64): Texture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  const r = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5 - r) / r, dy = (y + 0.5 - r) / r;
      const d = Math.hypot(dx, dy);
      const v = d >= 1 ? 0 : (1 - d) * (1 - d);
      const i = (y * size + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = Math.round(v * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = Texture.from(c);
  tex.source.scaleMode = 'linear';   // this one thing must NOT be nearest
  return tex;
}

export interface GlowOptions {
  /** Blur strength in screen pixels. */
  strength?: number;
  /** Gaussian passes. 2 is plenty for something this soft. */
  quality?: number;
  /** Render the blur at this fraction of screen. Light is low-frequency, so
   *  half costs a quarter of the fill and nobody has ever noticed. */
  resolution?: number;
  /** Overall opacity of the composite. */
  alpha?: number;
}

export class GlowLayer {
  readonly container: Container;
  private pool: Sprite[] = [];
  private tex: Texture;
  private live = 0;

  constructor(worldParent: Container, opts: GlowOptions = {}) {
    this.tex = makeFalloff();
    this.container = new Container();
    // zIndex is inside the WORLD, above ground and entities, so a torch glows
    // over the thing holding it.
    this.container.zIndex = 900;
    this.container.alpha = opts.alpha ?? 0.85;

    const blur = new BlurFilter({
      strength: opts.strength ?? 14,
      quality: opts.quality ?? 2,
      resolution: opts.resolution ?? 0.5,
    });
    // The filter carries the blend, not the container: Pixi composites a
    // filtered container through the FILTER's blend mode, so setting it on the
    // container instead is the quiet way to end up with an opaque grey rectangle
    // sitting over the world.
    blur.blendMode = 'add';
    this.container.filters = [blur];

    worldParent.addChild(this.container);
  }

  /** Sprites are pooled and hidden rather than destroyed. A run spawns and kills
   *  hundreds of light sources a minute and allocating a Sprite per fire tile
   *  per frame is how a game gets a sawtooth GC profile. */
  render(spots: GlowSpot[], max = 256) {
    const n = Math.min(spots.length, max);
    for (let i = 0; i < n; i++) {
      const s = spots[i];
      let sp = this.pool[i];
      if (!sp) {
        sp = new Sprite(this.tex);
        sp.anchor.set(0.5);
        this.pool.push(sp);
        this.container.addChild(sp);
      }
      sp.visible = true;
      sp.x = s.x;
      sp.y = s.y;
      sp.width = sp.height = s.radius * 2;
      sp.tint = (s.color[0] << 16) | (s.color[1] << 8) | s.color[2];
      sp.alpha = Math.max(0, Math.min(1, s.intensity));
    }
    for (let i = n; i < this.live; i++) this.pool[i].visible = false;
    this.live = n;
    // A container with a filter and nothing visible in it still costs a
    // render-target allocation and a full-screen blur, so switch the whole layer
    // off when the world is dark.
    this.container.visible = n > 0;
  }

  set alpha(v: number) { this.container.alpha = v; }
  get alpha() { return this.container.alpha; }
}
