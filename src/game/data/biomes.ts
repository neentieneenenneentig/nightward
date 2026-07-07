// Biome definitions as plain data. Tile art recipes live here; what GROWS on
// each biome (trees, rocks, herbs) is defined in features.ts via densities.
import { type RGB, ramp } from '../../engine/procgen/palette';
import type { Detail } from '../../engine/procgen/sprites';

export const T = {
  DEEP: 0, WATER: 1, SAND: 2, GRASS: 3, MEADOW: 4,
  FOREST: 5, HILL: 6, MOUNTAIN: 7, SNOW: 8,
} as const;

export interface BiomeDef {
  name: string;
  ramp: RGB[];        // dark → mid → light
  detail: Detail;
  accents?: RGB[];
  passable: boolean;
}

export const BIOMES: BiomeDef[] = [
  { name: 'deep',     ramp: ramp('#0a2138', '#0d2b47', '#123a5e'), detail: 'waves',   passable: false },
  { name: 'water',    ramp: ramp('#123a5e', '#1b4d78', '#2565a0'), detail: 'waves',   passable: false },
  { name: 'sand',     ramp: ramp('#c2a15f', '#d4b878', '#e6d094'), detail: 'speckle', passable: true },
  { name: 'grass',    ramp: ramp('#2f6b3f', '#3f8148', '#569a53'), detail: 'grass',   passable: true },
  { name: 'meadow',   ramp: ramp('#3f8148', '#569a53', '#74b25e'), detail: 'flowers', passable: true,
    accents: ramp('#e6c86e', '#d97b7b', '#c9a0dc', '#f2f2f2') },
  { name: 'forest',   ramp: ramp('#24523a', '#2f6b3f', '#3f8148'), detail: 'forest',  passable: true },
  { name: 'hill',     ramp: ramp('#5d6b52', '#75835f', '#8f9c72'), detail: 'pebbles', passable: true },
  { name: 'mountain', ramp: ramp('#4a4f5a', '#5a5f6b', '#737887'), detail: 'cracks',  passable: false },
  { name: 'snow',     ramp: ramp('#c9d2e0', '#dfe6f0', '#f4f7fc'), detail: 'sparkle', passable: false },
];
