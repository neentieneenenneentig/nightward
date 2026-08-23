// ============================================================================
// G1 -> SR4 — Post-processing.
//
// The header of this file used to say "zero shaders" as a FEATURE. That
// sentence is why the game looked like 1993, and it is now false on purpose.
//
// What went, and what took its place:
//
//   BloomPass      Canvas2D radial gradients + a THREE-PASS 3x3 box blur run in
//                  JavaScript over every pixel, bracketed by a getImageData
//                  stall     ->  shaders/glow.ts, a pooled sprite layer under
//                  the camera with a real Gaussian on it. Also fixes a
//                  coordinate bug that had the campfire glow landing nowhere
//                  near the campfire — see that file.
//
//   GradePass      a multiply-blended full-screen Graphics rect, rebuilt every
//                  frame                     ->  one stage of shaders/grade.ts
//
//   VignettePass   TWELVE concentric filled circles, rebuilt every frame,
//                  approximating a radial falloff the GPU evaluates exactly in
//                  one instruction              ->  one stage of the same pass
//
// Three per-frame CPU passes became one fragment shader that also does
// exposure, contrast, saturation, split-tone, a filmic roll-off and a dithered
// posterise — none of which were affordable before, and all of which are what
// separates a 2025 pixel game from a 1993 one.
//
// PainterlyPass survives untouched. It is a deliberate screenshot mode, it is
// honest in its own docstring about not being real-time, and porting it is
// SR8's problem, not SR4's.
// ============================================================================
import { Application, Container, Filter, RenderTexture } from 'pixi.js';
import { Sprite, Texture } from 'pixi.js';
import { GlowLayer, type GlowSpot } from './shaders/glow';
import { applyGrade, makeGradeFilter, NEUTRAL_GRADE, type GradeSettings } from './shaders/grade';

export type { GlowSpot, GradeSettings };
export { NEUTRAL_GRADE };

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
  /** WORLD-space glow sources. See shaders/glow.ts on why that word matters. */
  bloomSpots: GlowSpot[];
  grade: GradeSettings;
  /** Oil-painting Kuwahara filter. `enabled` toggles it; `strength` (0-1) blends with original. */
  painterly?: { enabled: boolean; strength?: number; radius?: number };
}

export class PostProcess {
  glow: GlowLayer;
  gradeFilter: Filter;
  painterly: PainterlyPass;
  /** SR5 — "darkness with pools of light" without normal maps: the SAME glow
   *  sprites that composite additively into the world (see GlowLayer) are ALSO
   *  rendered, unmodified, into this small offscreen target. The grade shader
   *  samples it as a mask — bright where a light sits, black in open dark — and
   *  uses it to pull a night-dimmed pixel back up toward full brightness. One
   *  set of light sources, two consumers: the visible glow and the exposure
   *  mask, so there is no second light list to keep in sync with the first. */
  private lightMask: RenderTexture;
  private maskScale = 0.5;
  lightsEnabled = true;
  /** Set false to take the grade off the stage entirely — CFG.gfx.palette is a
   *  real revert, so it removes the filter rather than feeding it neutral
   *  numbers. A neutral shader still costs a full-screen render target. */
  private graded = false;
  tier: 'low' | 'mid' | 'high' = 'mid';
  /** The glow layer's per-frame budget. A boss arena on fire can hand us four
   *  hundred lights and the last three hundred are behind the first hundred. */
  maxSpots = 128;

  constructor(
    private app: Application,
    /** The CAMERA container. The glow layer goes inside it, which is the whole
     *  reason world coordinates work without arithmetic. */
    worldParent: Container,
    w: number, h: number,
    opts: { glowStrength?: number; glowQuality?: number; glowResolution?: number; lightBufferScale?: number } = {},
  ) {
    this.glow = new GlowLayer(worldParent, {
      strength: opts.glowStrength,
      quality: opts.glowQuality,
      resolution: opts.glowResolution,
    });
    this.maskScale = opts.lightBufferScale ?? 0.5;
    // width/height stay in the SAME logical space as the screen — `resolution`
    // is what shrinks the backing texture. Get this backwards (pre-scale the
    // width/height instead) and glow.container's worldTransform, which maps
    // world space to full-screen pixels, draws everything past the target's
    // top-left quadrant off the edge of a texture that never got told to scale.
    this.lightMask = RenderTexture.create({ width: w, height: h, resolution: this.maskScale });
    this.gradeFilter = makeGradeFilter(this.lightMask.source);
    this.painterly = new PainterlyPass(app.stage, w, h);
  }

  /** The grade filter sits on the stage, so it colours the world, the glow and
   *  the grain together — which is the point; a grade that misses half the
   *  frame is a tint, not a grade. The HUD is DOM and is never touched. */
  setGraded(on: boolean) {
    if (on === this.graded) return;
    this.graded = on;
    const s = this.app.stage;
    const cur = (s.filters as Filter[] | null) ?? [];
    s.filters = on
      ? [...cur.filter((f) => f !== this.gradeFilter), this.gradeFilter]
      : cur.filter((f) => f !== this.gradeFilter);
  }

  /** SR4: quality follows the vessel, and the vessel is a reading the game
   *  already takes for `mercy` — see vessel.ts `gfxTier`. Called once when the
   *  vessel finishes describing itself, so a slow machine spends its first two
   *  seconds on the mid path and then steps down, rather than the game blocking
   *  the boot on a benchmark nobody asked for. */
  applyTier(tier: 'low' | 'mid' | 'high') {
    this.tier = tier;
    const blur = (this.glow.container.filters as any[])?.[0];
    if (blur) {
      // Low does not turn glow OFF. A world with no light in it is not a
      // cheaper-looking world, it is a broken one — so low gets a smaller,
      // coarser, quarter-res glow and keeps every light source it had.
      blur.strength = tier === 'low' ? 8 : tier === 'high' ? 18 : 14;
      blur.quality = tier === 'low' ? 1 : tier === 'high' ? 3 : 2;
      blur.resolution = tier === 'low' ? 0.3 : 0.5;
    }
    this.glow.alpha = tier === 'low' ? 0.7 : 0.85;
    this.maxSpots = tier === 'low' ? 48 : tier === 'high' ? 256 : 128;
  }

  resize(w: number, h: number) {
    this.painterly.resize(w, h);
    this.lightMask.resize(w, h);
  }

  apply(w: number, h: number, cfg: PostProcessConfig, sourceCanvas?: HTMLCanvasElement) {
    this.glow.render(cfg.bloomSpots, this.maxSpots);
    // SR5: re-render the same sprites the glow layer just positioned into the
    // mask target. Skipped when lights are off — look.ts already forces
    // nightAmbient to 1 in that case, so an unlit mask would be pure waste.
    if (this.lightsEnabled) {
      this.app.renderer.render({ container: this.glow.container, target: this.lightMask, clear: true });
    }
    if (this.graded) applyGrade(this.gradeFilter, cfg.grade);
    if (cfg.painterly && sourceCanvas) {
      this.painterly.apply(sourceCanvas, cfg.painterly.enabled, cfg.painterly.strength, cfg.painterly.radius);
    }
  }
}
