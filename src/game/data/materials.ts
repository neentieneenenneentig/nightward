// THE tile table. Supersedes the old biomes.ts: a tile is now a *material* with
// first-class gameplay properties. Rows 0–8 are the original nine biomes
// verbatim (same ramps/details/passable); rows 9–15 are the new writable
// materials the god brush (R1) and later skills (R2 fire, R3 physics, R4
// farming) paint onto the world.
//
// TS is the single source of truth for ALL content. The numeric props are
// flat-packed (packMaterials) and uploaded into the Rust core; Rust never sees
// names or art. Live-edit via window.NW.MATS + __nw.core.pushMaterials().
import { type RGB, ramp } from '../../engine/procgen/palette';
import type { Detail } from '../../engine/procgen/sprites';

export interface MaterialDef {
  name: string;
  art: { ramp: RGB[]; detail: Detail; accents?: RGB[] };  // never crosses the wasm boundary
  passable: boolean;
  speedMult: number;   // movement multiplier standing on it (1 = normal; ignored if impassable)
  buildable: boolean;  // may buildings be placed on it (canPlaceAt gains this check)
  flammable: number;   // 0..1 ignition factor — stored now, used by R2
  fuel: number;        // burn-seconds — R2
  burnsTo: number;     // material id after burnout; -1 = fireproof — R2
}

/** index IS the material id (u8). Keep in sync with `M` below. */
export const MATERIALS: MaterialDef[] = [
  // ---- 0–8: the original nine biomes (art verbatim from the old biomes.ts) ----
  { name: 'deep', art: { ramp: ramp('#0a2138', '#0d2b47', '#123a5e'), detail: 'waves' },
    passable: false, speedMult: 0, buildable: false, flammable: 0, fuel: 0, burnsTo: -1 },
  { name: 'water', art: { ramp: ramp('#123a5e', '#1b4d78', '#2565a0'), detail: 'waves' },
    passable: false, speedMult: 0, buildable: false, flammable: 0, fuel: 0, burnsTo: -1 },
  { name: 'sand', art: { ramp: ramp('#c2a15f', '#d4b878', '#e6d094'), detail: 'speckle' },
    passable: true, speedMult: 0.9, buildable: true, flammable: 0, fuel: 0, burnsTo: -1 },
  { name: 'grass', art: { ramp: ramp('#2f6b3f', '#3f8148', '#569a53'), detail: 'grass' },
    passable: true, speedMult: 1.0, buildable: true, flammable: 0.15, fuel: 2, burnsTo: 10 },
  { name: 'meadow', art: { ramp: ramp('#3f8148', '#569a53', '#74b25e'), detail: 'flowers',
    accents: ramp('#e6c86e', '#d97b7b', '#c9a0dc', '#f2f2f2') },
    passable: true, speedMult: 1.0, buildable: true, flammable: 0.2, fuel: 2, burnsTo: 10 },
  { name: 'forest', art: { ramp: ramp('#24523a', '#2f6b3f', '#3f8148'), detail: 'forest' },
    passable: true, speedMult: 1.0, buildable: true, flammable: 0.45, fuel: 6, burnsTo: 10 },
  { name: 'hill', art: { ramp: ramp('#5d6b52', '#75835f', '#8f9c72'), detail: 'pebbles' },
    passable: true, speedMult: 0.85, buildable: true, flammable: 0.05, fuel: 2, burnsTo: 10 },
  { name: 'mountain', art: { ramp: ramp('#4a4f5a', '#5a5f6b', '#737887'), detail: 'cracks' },
    passable: false, speedMult: 0, buildable: false, flammable: 0, fuel: 0, burnsTo: -1 },
  { name: 'snow', art: { ramp: ramp('#c9d2e0', '#dfe6f0', '#f4f7fc'), detail: 'sparkle' },
    passable: false, speedMult: 0, buildable: false, flammable: 0, fuel: 0, burnsTo: -1 },
  // ---- 9–15: new writable materials (props are CFG-grade — tuned at the gate) ----
  { name: 'Dirt', art: { ramp: ramp('#5a4632', '#6e5740', '#84694e'), detail: 'speckle' },
    passable: true, speedMult: 1.0, buildable: true, flammable: 0, fuel: 0, burnsTo: -1 },
  { name: 'Ash', art: { ramp: ramp('#3a3a3e', '#4a4a50', '#5f5f66'), detail: 'speckle' },
    passable: true, speedMult: 1.0, buildable: true, flammable: 0, fuel: 0, burnsTo: -1 },
  { name: 'Ice', art: { ramp: ramp('#9fc4e8', '#bcd9f2', '#e0f0fb'), detail: 'cracks' },
    passable: true, speedMult: 1.15, buildable: false, flammable: 0, fuel: 0, burnsTo: -1 },
  { name: 'Mud', art: { ramp: ramp('#4b3b2a', '#5d4a35', '#6f5a41'), detail: 'speckle' },
    passable: true, speedMult: 0.55, buildable: true, flammable: 0, fuel: 0, burnsTo: -1 },
  { name: 'Gravel', art: { ramp: ramp('#6b6f77', '#7d828c', '#9198a3'), detail: 'pebbles' },
    passable: true, speedMult: 0.95, buildable: true, flammable: 0, fuel: 0, burnsTo: -1 },
  { name: 'Tilled Soil', art: { ramp: ramp('#4a3928', '#5a4632', '#6e5740'), detail: 'cracks' },
    passable: true, speedMult: 0.9, buildable: false, flammable: 0.1, fuel: 1, burnsTo: 9 },
  { name: 'Shallows', art: { ramp: ramp('#2565a0', '#3579b4', '#4a8ec9'), detail: 'waves' },
    passable: true, speedMult: 0.6, buildable: false, flammable: 0, fuel: 0, burnsTo: -1 },
];

/** Material ids by name — index into MATERIALS. */
export const M = {
  DEEP: 0, WATER: 1, SAND: 2, GRASS: 3, MEADOW: 4, FOREST: 5, HILL: 6, MOUNTAIN: 7,
  SNOW: 8, DIRT: 9, ASH: 10, ICE: 11, MUD: 12, GRAVEL: 13, TILLED: 14, SHALLOW: 15,
} as const;

/** floats per material in the packed table (see layout below). */
export const STRIDE = 6;

/** Flat-pack the numeric props for upload into the wasm core.
 * Layout per material: [passable(0|1), speedMult, buildable(0|1), flammable, fuel, burnsTo]. */
export function packMaterials(): Float32Array {
  const out = new Float32Array(MATERIALS.length * STRIDE);
  for (let i = 0; i < MATERIALS.length; i++) {
    const m = MATERIALS[i];
    const o = i * STRIDE;
    out[o + 0] = m.passable ? 1 : 0;
    out[o + 1] = m.speedMult;
    out[o + 2] = m.buildable ? 1 : 0;
    out[o + 3] = m.flammable;
    out[o + 4] = m.fuel;
    out[o + 5] = m.burnsTo;
  }
  return out;
}
