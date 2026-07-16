// ============================================================================
// G1 — Post-Processing Pipeline. Bloom (additive glow layer), color grading
// (tinted overlay driven by biome + time-of-day), and vignette (screen-edge
// darkening). All effects sit between the world and the UI — the HUD stays
// crisp. WebGPU + WebGL compatible: zero shaders, pure Canvas2D + PixiJS
// blend-mode compositing.
// ============================================================================
import { Container, Graphics, Sprite, Texture, BLEND_MODES } from 'pixi.js';

// ---- bloom ----------------------------------------------------------------

interface GlowSpot {
  x: number;
  y: number;
  radius: number;
  intensity: number; // 0..1
  color: [number, number, number]; // RGB 0..255
}

/**
 * Manages a full-screen additive-blend glow layer for bloom.
 * Systems register glow spots each frame (fire tiles, beacon buildings,
 * rift particles, crit effects) and the bloom pass blurs + composites them.
 *
 * Approach: render glow spots to a small offscreen canvas (1/4 res), apply a
 * cheap two-pass box blur, then overlay at full res with additive blending.
 * This is the same pattern the fire glow in chunkmap.ts already uses, just
 * centralized and blitted once per frame instead of per-chunk.
 */
export class BloomPass {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private tex: Texture;
  private sprite: Sprite;
  private downscale = 4; // render glow at 1/4 resolution
  private blurPasses = 3;

  constructor(private parent: Container, screenW: number, screenH: number) {
    const cw = Math.ceil(screenW / this.downscale);
    const ch = Math.ceil(screenH / this.downscale);
    this.canvas = document.createElement('canvas');
    this.canvas.width = cw;
    this.canvas.height = ch;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true })!;
    this.tex = Texture.from(this.canvas);
    this.tex.source.scaleMode = 'linear'; // bloom should be soft
    this.sprite = new Sprite(this.tex);
    this.sprite.blendMode = 'add';
    this.sprite.setSize(screenW, screenH); // stretch back to full res
    this.sprite.zIndex = 60; // above entities, below UI
    this.sprite.alpha = 0.4; // subtle — per the G1 spec
    parent.addChild(this.sprite);
  }

  resize(w: number, h: number) {
    const cw = Math.ceil(w / this.downscale);
    const ch = Math.ceil(h / this.downscale);
    this.canvas.width = cw;
    this.canvas.height = ch;
    this.sprite.setSize(w, h);
  }

  /** Render a list of glow spots into the bloom texture and composite. */
  render(spots: GlowSpot[]) {
    const { ctx, canvas, downscale } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw each spot as a radial gradient
    for (const s of spots) {
      const sx = s.x / downscale;
      const sy = s.y / downscale;
      const sr = Math.max(1, s.radius / downscale);
      const [r, g, b] = s.color;
      const alpha = s.intensity;
      const grad = ctx.createRadialGradient(sx, sy, sr * 0.1, sx, sy, sr);
      grad.addColorStop(0, `rgba(${r},${g},${b},${alpha})`);
      grad.addColorStop(0.5, `rgba(${r},${g},${b},${alpha * 0.4})`);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(sx - sr, sy - sr, sr * 2, sr * 2);
    }

    // Cheap box blur (multiple passes) for a soft bloom
    this.boxBlur(this.blurPasses);

    this.tex.source.update();
  }

  /** Simple 3×3 box blur — repeated passes approximate Gaussian. */
  private boxBlur(passes: number) {
    const { ctx, canvas } = this;
    const w = canvas.width, h = canvas.height;
    const src = ctx.getImageData(0, 0, w, h);
    const dst = new ImageData(w, h);
    for (let p = 0; p < passes; p++) {
      const data = src.data;
      const out = dst.data;
      const stride = w * 4;
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          const i = (y * w + x) * 4;
          for (let c = 0; c < 4; c++) {
            out[i + c] = (
              data[i + c - 4] + data[i + c + 4] +
              data[i + c - stride] + data[i + c + stride] +
              data[i + c] * 4
            ) / 8;
          }
        }
      }
      src.data.set(out);
    }
    ctx.putImageData(src, 0, 0);
  }
}

// ---- color grading --------------------------------------------------------

export interface GradeColors {
  /** Tint color as [r, g, b] 0..255. */
  tint: [number, number, number];
  /** Strength of the tint, 0..1. */
  strength: number;
}

/**
 * Color grading via a full-screen multiply-blend overlay. The existing
 * day/night tint in main.ts already does this — GradePass extends the concept
 * with biome-specific color shifts (warm amber for Ethernet, cool blue for
 * WiFi, harsh red for Cellular).
 */
export class GradePass {
  private gfx: Graphics;

  constructor(private parent: Container) {
    this.gfx = new Graphics();
    this.gfx.blendMode = 'multiply';
    this.gfx.zIndex = 55; // above entities, below bloom
    parent.addChild(this.gfx);
  }

  /** Apply color grading. Called every frame with the current grade config. */
  apply(w: number, h: number, grade: GradeColors) {
    const { gfx } = this;
    gfx.clear();
    if (grade.strength <= 0) return;
    const [r, g, b] = grade.tint;
    // Multiply-blend: a white rect has no effect, a tinted rect shifts colors.
    // We use the tint color at (1 - strength) so full white = no change.
    const inv = 1 - grade.strength;
    gfx.rect(0, 0, w, h).fill({
      r: r * inv + 255 * grade.strength,
      g: g * inv + 255 * grade.strength,
      b: b * inv + 255 * grade.strength,
      a: 255,
    });
  }
}

// ---- vignette -------------------------------------------------------------

/**
 * Vignette: darkens screen edges. Intensifies at night, during offline mode,
 * and during data storms. Implemented as a full-screen Graphics with a
 * radial alpha gradient (approximated with concentric rings).
 */
export class VignettePass {
  private gfx: Graphics;

  constructor(private parent: Container) {
    this.gfx = new Graphics();
    this.gfx.blendMode = 'multiply';
    this.gfx.zIndex = 65; // above bloom, below UI
    parent.addChild(this.gfx);
  }

  /** intensity: 0 = none, 1 = full black edges. */
  apply(w: number, h: number, intensity: number) {
    const { gfx } = this;
    gfx.clear();
    if (intensity <= 0) return;

    const cx = w / 2, cy = h / 2;
    const maxR = Math.sqrt(cx * cx + cy * cy);
    const rings = 12;
    const smoothStart = 0.35; // fraction of maxR where darkening begins

    for (let i = rings; i >= 1; i--) {
      const t = i / rings;
      const r = maxR * (smoothStart + (1 - smoothStart) * t);
      // alpha peaks at the corners, zero in the center
      const alpha = intensity * (1 - smoothStart) * (t * t) * (i / rings);
      gfx.circle(cx, cy, r).fill({ color: 0x000000, alpha: Math.min(alpha, intensity) });
    }
  }
}

// ---- combined post-processing manager -------------------------------------

export interface PostProcessConfig {
  bloomSpots: GlowSpot[];
  grade: GradeColors;
  vignetteIntensity: number;
}

export class PostProcess {
  bloom: BloomPass;
  grade: GradePass;
  vignette: VignettePass;

  constructor(parent: Container, w: number, h: number) {
    this.bloom = new BloomPass(parent, w, h);
    this.grade = new GradePass(parent);
    this.vignette = new VignettePass(parent);
  }

  resize(w: number, h: number) {
    this.bloom.resize(w, h);
  }

  apply(w: number, h: number, cfg: PostProcessConfig) {
    this.bloom.render(cfg.bloomSpots);
    this.grade.apply(w, h, cfg.grade);
    this.vignette.apply(w, h, cfg.vignetteIntensity);
  }
}
