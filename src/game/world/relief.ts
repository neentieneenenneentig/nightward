// G1: relief lighting. The chunk baker paints colour and never lights it —
// which is exactly why a mountain reads as a PIT next to grass: nothing in the
// image says which way the ground is facing. This derives a continuous height
// field from the discrete material grid, differentiates it into surface
// normals once per chunk, and re-shades a small greyscale overlay whenever the
// sun moves.
//
// The overlay is multiply-blended, so it can only DARKEN. That is a real limit
// of a basic blend mode and it is the right trade: flat ground comes out at
// exactly 1.0 and keeps the palette as authored (G2's work survives intact),
// and the form is read entirely off the shadowed faces. Pixel-art terrain has
// always read from its shadows.
//
// Two things here are load-bearing and easy to get wrong:
//  * The height field is BILINEAR over tile centres. Sampling heightClass per
//    pixel would reproduce the 32px staircase as a hard shading edge — the
//    exact artifact we are trying to kill.
//  * fbm is sampled in WORLD tile coordinates, never chunk-local ones, or
//    every chunk seam grows a visible discontinuity.
import { fbm } from '../../engine/noise';
import { CFG } from '../data/config';
import { cycleLen } from '../systems/daynight';

export const RELIEF_N = 64;   // shade texels per chunk side — 8 world px each
export const RELIEF_PAD = 1;  // texels of overhang, so linear filtering has real
                              // neighbour data to interpolate toward at the seam
const SOBEL_PAD = RELIEF_PAD + 1;         // the extra ring the 3×3 kernel reads
export const RELIEF_DIM = RELIEF_N + 2 * RELIEF_PAD;   // 66 — the overlay texture side

const HEIGHT_STEP = 0.65;   // tiles of rise per heightClass step (~33° terrace face)
const DETAIL_AMP = 0.55;    // tiles of rise from micro-relief noise
const DETAIL_FREQ = 0.22;   // noise cycles per tile — 3 octaves lands the finest
                            // detail near 20 px, which is the scale the terrain
                            // was missing entirely (structure at 1 px and 32 px,
                            // nothing between)
const RELIEF_GAIN = 0.85;   // how hard a slope is pushed away from flat
const RELIEF_FLOOR = 0.55;  // darkest a shadowed face may go (0 = black)
const SUN_ALT_MIN = 0.40;   // the sun NEVER goes overhead: at 90° altitude every
const SUN_ALT_SWING = 0.30; // normal returns ~cos(slope) and relief flattens out.
                            // Hillshade has used a ~45° sun for fifty years.
const SUN_NORTH = 0.72;     // constant screen-north bias, so shadows fall toward
                            // the camera the way the cliff pass already assumes

export interface ReliefField {
  nx: Float32Array;
  ny: Float32Array;
  nz: Float32Array;
}

export interface SunDir { x: number; y: number; z: number; gain: number }

/** Where the light is coming from at a moment on the world clock. The azimuth
 *  sweeps a shallow arc across the top of the screen (east at dawn → west at
 *  dusk) and the altitude peaks mid-phase, so shadows are long at the edges of
 *  the day and short at noon. Night keeps the same shape at half strength —
 *  moonlight, not a second sun. */
export function sunAt(clock: number): SunDir {
  const cy = cycleLen();
  const D = CFG.time.daySec;
  const tc = ((clock % cy) + cy) % cy;
  const day = tc < D;
  const p = day ? tc / D : (tc - D) / (cy - D);
  const alt = Math.sin(Math.PI * p);
  const x = Math.cos(Math.PI * (0.15 + 0.7 * p)) * 0.85 * (day ? 1 : -1);
  const y = -SUN_NORTH;
  const z = SUN_ALT_MIN + SUN_ALT_SWING * alt;
  const len = Math.hypot(x, y, z);
  return { x: x / len, y: y / len, z: z / len, gain: RELIEF_GAIN * (day ? 1 : 0.55) };
}

/** Build the cached normal field for one chunk. Runs once per bake and is
 *  never recomputed — only the cheap dot-product pass reruns when the sun
 *  moves. `heightAt` returns a tile's heightClass (0–3). */
export function buildReliefField(
  originTx: number,
  originTy: number,
  tiles: number,
  seed: number,
  heightAt: (tx: number, ty: number) => number,
): ReliefField {
  const step = tiles / RELIEF_N;              // tiles per texel (0.25)
  const HD = RELIEF_N + 2 * SOBEL_PAD;        // height buffer side (68)
  const h = new Float32Array(HD * HD);

  // one heightClass lookup per tile, padded by a ring — the bilinear taps
  // below never reach further than one tile outside the chunk
  const G = tiles + 2;
  const grid = new Float32Array(G * G);
  for (let j = 0; j < G; j++) {
    for (let i = 0; i < G; i++) grid[j * G + i] = heightAt(originTx + i - 1, originTy + j - 1);
  }
  const cell = (gx: number, gy: number) =>
    grid[Math.min(G - 1, Math.max(0, gy)) * G + Math.min(G - 1, Math.max(0, gx))];

  for (let j = 0; j < HD; j++) {
    // tile-space coordinate of this texel's centre; the −0.5 puts tile CENTRES
    // on integers so the bilinear blend ramps across a whole tile, not a corner
    const py = originTy + (j - SOBEL_PAD + 0.5) * step - 0.5;
    const gy = Math.floor(py - originTy) + 1;
    const fy = py - Math.floor(py);
    for (let i = 0; i < HD; i++) {
      const px = originTx + (i - SOBEL_PAD + 0.5) * step - 0.5;
      const gx = Math.floor(px - originTx) + 1;
      const fx = px - Math.floor(px);
      const a = cell(gx, gy), b = cell(gx + 1, gy), c = cell(gx, gy + 1), d = cell(gx + 1, gy + 1);
      const top = a + (b - a) * fx;
      const bot = c + (d - c) * fx;
      const hc = top + (bot - top) * fy;
      // water is a surface, not terrain — fade micro-relief out as heightClass
      // falls to 0 so the sea never grows dunes
      const wet = hc < 1 ? hc : 1;
      h[j * HD + i] =
        hc * HEIGHT_STEP +
        (fbm(px * DETAIL_FREQ, py * DETAIL_FREQ, seed, 3) - 0.5) * DETAIL_AMP * wet;
    }
  }

  // 3×3 Sobel, not a 2-tap forward difference: a forward difference is
  // one-sided, so it paints a directional seam along every heightClass step.
  const n = RELIEF_DIM * RELIEF_DIM;
  const nx = new Float32Array(n), ny = new Float32Array(n), nz = new Float32Array(n);
  const inv = 1 / (8 * step);
  for (let j = 0; j < RELIEF_DIM; j++) {
    for (let i = 0; i < RELIEF_DIM; i++) {
      const o = (j + 1) * HD + (i + 1);       // centre in the padded buffer
      const gxv =
        (h[o - HD + 1] + 2 * h[o + 1] + h[o + HD + 1]) -
        (h[o - HD - 1] + 2 * h[o - 1] + h[o + HD - 1]);
      const gyv =
        (h[o + HD - 1] + 2 * h[o + HD] + h[o + HD + 1]) -
        (h[o - HD - 1] + 2 * h[o - HD] + h[o - HD + 1]);
      const dx = -gxv * inv, dy = -gyv * inv;
      const len = Math.hypot(dx, dy, 1);
      const k = j * RELIEF_DIM + i;
      nx[k] = dx / len; ny[k] = dy / len; nz[k] = 1 / len;
    }
  }
  return { nx, ny, nz };
}

/** Re-shade an overlay's pixels for a new sun. The only per-relight work.
 *  `sun.z` is what a perfectly flat surface returns, so subtracting it pins
 *  flat ground at exactly 1.0 — the authored palette passes through untouched
 *  and only genuine slopes move. */
export function shadeInto(img: ImageData, f: ReliefField, sun: SunDir) {
  const d = img.data;
  const flat = sun.z;
  for (let i = 0; i < f.nx.length; i++) {
    const ndl = f.nx[i] * sun.x + f.ny[i] * sun.y + f.nz[i] * sun.z;
    let s = 1 + (ndl - flat) * sun.gain;
    if (s > 1) s = 1; else if (s < RELIEF_FLOOR) s = RELIEF_FLOOR;
    const v = (s * 255) | 0;
    const o = i * 4;
    d[o] = v; d[o + 1] = v; d[o + 2] = v; d[o + 3] = 255;
  }
}
