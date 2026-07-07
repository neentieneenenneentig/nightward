// Curated color ramps are the artsy backbone: procgen picks WHERE pixels go,
// palettes decide what it feels like. A "ramp" is dark→light shades of one
// material; shading = picking an index along the ramp.

export type RGB = [number, number, number];

export function hex(s: string): RGB {
  return [
    parseInt(s.slice(1, 3), 16),
    parseInt(s.slice(3, 5), 16),
    parseInt(s.slice(5, 7), 16),
  ];
}

export const ramp = (...cols: string[]): RGB[] => cols.map(hex);

const clamp = (n: number) => Math.max(0, Math.min(255, n));
export const lighten = (c: RGB, n: number): RGB => [clamp(c[0] + n), clamp(c[1] + n), clamp(c[2] + n)];
export const darken = (c: RGB, n: number): RGB => lighten(c, -n);

// Pools the character generator draws from — every seed rolls a different hero.
export const PLAYER_POOL = {
  skin: ramp('#e8b98a', '#d19a6b', '#b07a4f', '#8a5a38'),
  hair: ramp('#2b2233', '#5a3825', '#8a5a38', '#c2a15f', '#b3402e', '#dfe6f0', '#3b82c4'),
  cloth: ramp('#7a3b3b', '#3b5e7a', '#4a7a3b', '#6b4a7a', '#7a6b3b', '#37474f', '#8a4a2e'),
  pants: ramp('#37474f', '#4a3b2e', '#2b3a2e', '#3a2b3a'),
  boots: ramp('#2e2620', '#3a3230'),
};
