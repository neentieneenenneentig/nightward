// Deterministic randomness. Every visual in the game derives from these two
// functions + a world seed, so the same seed always rebuilds the same world,
// sprites and character — that's what lets us ship zero image assets.

/** Seeded stream of floats in [0,1). Use when you need a *sequence* of randoms. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Stateless 2D hash → [0,1). Ask "what's the random value AT this tile?"
 * without generating anything in between — the whole infinite world is
 * queryable in any order because of this.
 */
export function hash2(x: number, y: number, seed: number): number {
  let h = (seed | 0) ^ 0x9e3779b9;
  h = Math.imul(h ^ Math.imul(x | 0, 0x27d4eb2d), 0x85ebca6b);
  h = Math.imul(h ^ Math.imul(y | 0, 0x165667b1), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
