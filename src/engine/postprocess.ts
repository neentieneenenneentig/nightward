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

// ---- oil-painting filter (Kuwahara) -------------------------------------

/**
 * Kuwahara filter — the classic "oil painting" look. For each pixel, the
 * neighbourhood is split into 4 overlapping quadrants; the output is the
 * mean colour of the quadrant with the lowest variance. This flattens
 * homogeneous regions while preserving sharp edges (brush-stroke boundaries).
 *
 * Performance: processing runs on a heavily downscaled copy (1/5 by default)
 * to keep the JS inner loop tractable. Still not real-time on low-end HW —
 * treat this as a "screenshot mode" toggle, not a permanent 60-fps layer.
 * A future WGSL port (WebGPU only) would make it real-time.
 */
export class PainterlyPass {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private tex: Texture;
  private sprite: Sprite;
  private downscale = 5;   // process at 1/N screen resolution
  private _radius = 2;     // brush-stroke radius (1–4, higher = more abstract)
  private _enabled = false;
  private _strength = 0.85; // blend with original (0 = off, 1 = full oil)

  get enabled() { return this._enabled; }
  get radius() { return this._radius; }
  get strength() { return this._strength; }

  constructor(private parent: Container, screenW: number, screenH: number) {
    const cw = Math.ceil(screenW / this.downscale);
    const ch = Math.ceil(screenH / this.downscale);
    this.canvas = document.createElement('canvas');
    this.canvas.width = cw;
    this.canvas.height = ch;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true })!;

    this.tex = Texture.from(this.canvas);
    this.tex.source.scaleMode = 'linear'; // soft upscale = paint-blob look
    this.sprite = new Sprite(this.tex);
    this.sprite.setSize(screenW, screenH);
    this.sprite.zIndex = 70; // above vignette, below UI
    this.sprite.visible = false;
    parent.addChild(this.sprite);
  }

  resize(w: number, h: number) {
    const cw = Math.ceil(w / this.downscale);
    const ch = Math.ceil(h / this.downscale);
    this.canvas.width = cw;
    this.canvas.height = ch;
    this.sprite.setSize(w, h);
  }

  /**
   * Capture the PixiJS canvas, Kuwahara-filter it, and composite the result.
   * @param sourceCanvas — `app.canvas` (the live PixiJS output)
   * @param enabled — whether the effect is active
   * @param strength — blend amount 0..1 (overrides the instance default)
   * @param radius — brush radius 1..4 (overrides the instance default)
   */
  apply(
    sourceCanvas: HTMLCanvasElement,
    enabled: boolean,
    strength?: number,
    radius?: number,
  ) {
    this._enabled = enabled;
    const str = strength ?? this._strength;
    this._strength = str;
    if (radius !== undefined) this._radius = Math.max(1, Math.min(4, radius | 0));

    const active = enabled && str > 0;
    this.sprite.visible = active;
    this.sprite.alpha = str;
    if (!active) return;

    // 1. copy source → offscreen at reduced resolution
    const { ctx, canvas } = this;
    ctx.drawImage(sourceCanvas, 0, 0, canvas.width, canvas.height);

    // 2. apply Kuwahara filter
    this._kuwahara();

    // 3. push to GPU
    this.tex.source.update();
  }

  // ---- internal ----------------------------------------------------------

  private _kuwahara() {
    const { ctx, canvas } = this;
    const r = this._radius;
    const w = canvas.width;
    const h = canvas.height;
    const src = ctx.getImageData(0, 0, w, h);
    const dst = new ImageData(w, h);
    const s = src.data;
    const d = dst.data;
    const qs = r + 1; // quadrant side length

    for (let y = 0; y < h; y++) {
      const rowBase = y * w * 4;
      for (let x = 0; x < w; x++) {
        // 4 overlapping quadrants anchored at the pixel's corners
        const qx0 = [Math.max(0, x - r), Math.max(0, x), Math.max(0, x - r), Math.max(0, x)];
        const qy0 = [Math.max(0, y - r), Math.max(0, y - r), Math.max(0, y), Math.max(0, y)];
        const qx1 = [Math.min(w - 1, x), Math.min(w - 1, x + r), Math.min(w - 1, x), Math.min(w - 1, x + r)];
        const qy1 = [Math.min(h - 1, y), Math.min(h - 1, y), Math.min(h - 1, y + r), Math.min(h - 1, y + r)];

        let bestR = 0, bestG = 0, bestB = 0;
        let bestVar = 1e9;

        for (let q = 0; q < 4; q++) {
          let n = 0;
          let sr = 0, sg = 0, sb = 0;
          let sr2 = 0, sg2 = 0, sb2 = 0;

          const x0 = qx0[q], y0 = qy0[q];
          const x1 = qx1[q], y1 = qy1[q];

          for (let sy = y0; sy <= y1; sy++) {
            const rowOff = sy * w * 4;
            for (let sx = x0; sx <= x1; sx++) {
              const i = rowOff + sx * 4;
              const R = s[i], G = s[i + 1], B = s[i + 2];
              sr += R; sg += G; sb += B;
              sr2 += R * R; sg2 += G * G; sb2 += B * B;
              n++;
            }
          }

          if (n === 0) continue;
          const mr = sr / n, mg = sg / n, mb = sb / n;
          const variance = (sr2 / n - mr * mr) + (sg2 / n - mg * mg) + (sb2 / n - mb * mb);

          if (variance < bestVar) {
            bestVar = variance;
            bestR = mr; bestG = mg; bestB = mb;
          }
        }

        const di = rowBase + x * 4;
        d[di] = bestR;
        d[di + 1] = bestG;
        d[di + 2] = bestB;
        d[di + 3] = 255;
      }
    }

    ctx.putImageData(dst, 0, 0);
  }
}

// ---- combined post-processing manager -------------------------------------

export interface PostProcessConfig {
  bloomSpots: GlowSpot[];
  grade: GradeColors;
  vignetteIntensity: number;
  /** Oil-painting Kuwahara filter. `enabled` toggles it; `strength` (0–1) blends with original. */
  painterly?: { enabled: boolean; strength?: number; radius?: number };
}

export class PostProcess {
  bloom: BloomPass;
  grade: GradePass;
  vignette: VignettePass;
  painterly: PainterlyPass;

  constructor(parent: Container, w: number, h: number) {
    this.bloom = new BloomPass(parent, w, h);
    this.grade = new GradePass(parent);
    this.vignette = new VignettePass(parent);
    this.painterly = new PainterlyPass(parent, w, h);
  }

  resize(w: number, h: number) {
    this.bloom.resize(w, h);
    this.painterly.resize(w, h);
  }

  apply(w: number, h: number, cfg: PostProcessConfig, sourceCanvas?: HTMLCanvasElement) {
    this.bloom.render(cfg.bloomSpots);
    this.grade.apply(w, h, cfg.grade);
    this.vignette.apply(w, h, cfg.vignetteIntensity);
    if (cfg.painterly && sourceCanvas) {
      this.painterly.apply(sourceCanvas, cfg.painterly.enabled, cfg.painterly.strength, cfg.painterly.radius);
    }
  }
}
