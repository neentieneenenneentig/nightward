// Value noise + fractal brownian motion (fbm) — the bread and butter of
// procedural worlds. fbm stacks noise at several frequencies ("octaves"):
// low octaves shape continents, high octaves add coastline detail.
import { hash2 } from './rng';

const fade = (t: number) => t * t * (3 - 2 * t); // smoothstep

/** Smooth noise in [0,1] — bilinear blend between hashed lattice corners. */
export function valueNoise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const fx = x - xi, fy = y - yi;
  const a = hash2(xi, yi, seed);
  const b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed);
  const d = hash2(xi + 1, yi + 1, seed);
  const u = fade(fx), v = fade(fy);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** Fractal noise: `octaves` layers, each twice the frequency, half the weight. */
export function fbm(x: number, y: number, seed: number, octaves = 4): number {
  let sum = 0, amp = 0.5, norm = 0, f = 1;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise(x * f, y * f, seed + i * 1013);
    norm += amp;
    amp *= 0.5;
    f *= 2.03; // not exactly 2 — avoids octaves lining up on the same lattice
  }
  return sum / norm;
}
