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
import type { SoulSlot } from './soulgear';

/** N2b: per-tile gameplay effects applied while the player stands on this material.
 *  All fields are optional — most materials have no effects. Effects are data rows,
 *  not engine code: adding a new material with effects is just a row edit. */
export interface MaterialEffects {
  /** HP damage per sim-second while standing on this tile. */
  damagePerSec?: number;
  /** Multiplier on natural HP regen (1.0 = normal). */
  regenMult?: number;
  /** Multiplier on gather yield (1.0 = normal). */
  gatherYieldMult?: number;
  /** Multiplier on all XP gain (1.0 = normal). */
  xpMult?: number;
  /** Multiplier on soul-gear XP gain (1.0 = normal). */
  soulXpMult?: number;
  /** Multiplier on building construction speed (1.0 = normal). */
  buildSpeedMult?: number;
  /** Prevents gathering on this tile regardless of features present. */
  noGathering?: boolean;
  /** Stun duration in ms when the player first steps onto this tile. */
  stunOnEnterMs?: number;
  /** Speed multiplier applied for `speedBurstMs` after leaving this tile. */
  speedBurstOnExit?: number;
  /** Duration in ms for the exit speed burst. */
  speedBurstMs?: number;
}

export interface MaterialDef {
  name: string;
  art: { ramp: RGB[]; detail: Detail; accents?: RGB[] };  // never crosses the wasm boundary
  passable: boolean;
  speedMult: number;   // movement multiplier standing on it (1 = normal; ignored if impassable)
  buildable: boolean;  // may buildings be placed on it (canPlaceAt gains this check)
  flammable: number;   // 0..1 ignition factor — stored now, used by R2
  fuel: number;        // burn-seconds — R2
  burnsTo: number;     // material id after burnout; -1 = fireproof — R2
  heightClass: 0 | 1 | 2 | 3; // water=0 ground=1 hill=2 mountain/snow=3 — render-only (R1.5):
                              // drives cliff-ledge shading + dual-grid blend stacking order
  wetness: number;     // 0..1 baseline moisture — R2: water-family tiles are wet SOURCES that
                        // diffuse dampness into flammable neighbors; high wet[] blocks ignition
                        // and extinguishes an already-burning tile
  /** W7: base soul XP granted per unit when fed to a soul slot. 0 = cannot be fed. */
  xpValue: number;
  /** W7: which soul slot type gets 1.5× bonus XP from this material. */
  soulAffinity?: SoulSlot;
  /** N2b: per-tile gameplay effects while the player stands on this material. */
  effects?: MaterialEffects;
}

/** index IS the material id (u8). Keep in sync with `M` below. */
export const MATERIALS: MaterialDef[] = [
  // ---- 0–8: the original nine biomes (art verbatim from the old biomes.ts) ----
  { name: 'deep', art: { ramp: ramp('#08192b', '#0a2138', '#0d2b47', '#103351', '#123a5e'), detail: 'waves' },
    passable: false, speedMult: 0, buildable: false, flammable: 0, fuel: 0, burnsTo: -1, heightClass: 0, wetness: 1.0, xpValue: 0 },
  { name: 'water', art: { ramp: ramp('#0f3352', '#123a5e', '#1b4d78', '#205a8c', '#2565a0'), detail: 'waves' },
    passable: false, speedMult: 0, buildable: false, flammable: 0, fuel: 0, burnsTo: -1, heightClass: 0, wetness: 1.0, xpValue: 0 },
  { name: 'sand', art: { ramp: ramp('#b08a4e', '#c2a15f', '#d4b878', '#dcc487', '#e6d094'), detail: 'speckle' },
    passable: true, speedMult: 0.9, buildable: true, flammable: 0, fuel: 0, burnsTo: -1, heightClass: 1, wetness: 0.1, xpValue: 1, soulAffinity: 'charm' },
  { name: 'grass', art: { ramp: ramp('#2a6238', '#356f3e', '#3f8148', '#4c9050', '#569a53'), detail: 'grass' },
    passable: true, speedMult: 1.0, buildable: true, flammable: 0.15, fuel: 2, burnsTo: 10, heightClass: 1, wetness: 0.05, xpValue: 1, soulAffinity: 'tool_axe' },
  { name: 'meadow', art: { ramp: ramp('#3a7a44', '#478c4c', '#569a53', '#65a659', '#74b25e'), detail: 'flowers',
    accents: ramp('#e6c86e', '#d97b7b', '#c9a0dc', '#f2f2f2') },
    passable: true, speedMult: 1.0, buildable: true, flammable: 0.2, fuel: 2, burnsTo: 10, heightClass: 1, wetness: 0.05, xpValue: 2, soulAffinity: 'ring' },
  { name: 'forest', art: { ramp: ramp('#1c4530', '#245239', '#2f6b3f', '#377640', '#3f8148'), detail: 'forest' },
    passable: true, speedMult: 1.0, buildable: true, flammable: 0.45, fuel: 6, burnsTo: 10, heightClass: 1, wetness: 0.1, xpValue: 3, soulAffinity: 'tool_axe' },
  { name: 'hill', art: { ramp: ramp('#55634b', '#67754f', '#7b8a63', '#93a277', '#adba8e'), detail: 'pebbles' },
    passable: true, speedMult: 0.85, buildable: true, flammable: 0.05, fuel: 2, burnsTo: 10, heightClass: 2, wetness: 0.05, xpValue: 2, soulAffinity: 'tool_pick' },
  { name: 'mountain', art: { ramp: ramp('#5a6170', '#737b8c', '#8f97a8', '#abb3c4', '#c5cddb'), detail: 'cracks' },
    passable: false, speedMult: 0, buildable: false, flammable: 0, fuel: 0, burnsTo: -1, heightClass: 3, wetness: 0, xpValue: 0 },
  { name: 'snow', art: { ramp: ramp('#b9c4d6', '#ccd5e4', '#dde4f0', '#ecf1f8', '#fbfdff'), detail: 'sparkle' },
    passable: false, speedMult: 0, buildable: false, flammable: 0, fuel: 0, burnsTo: -1, heightClass: 3, wetness: 1.0, xpValue: 0 },
  // ---- 9–15: new writable materials (props are CFG-grade — tuned at the gate) ----
  { name: 'Dirt', art: { ramp: ramp('#6b5236', '#7a5f3f', '#93764f', '#a08359', '#ac8f64'), detail: 'speckle' },
    passable: true, speedMult: 1.0, buildable: true, flammable: 0, fuel: 0, burnsTo: -1, heightClass: 1, wetness: 0.05, xpValue: 1 },
  { name: 'Ash', art: { ramp: ramp('#2e2e32', '#3a3a3e', '#4a4a50', '#55555c', '#5f5f66'), detail: 'speckle' },
    passable: true, speedMult: 1.0, buildable: true, flammable: 0, fuel: 0, burnsTo: -1, heightClass: 1, wetness: 0, xpValue: 2, soulAffinity: 'weapon' },
  { name: 'Ice', art: { ramp: ramp('#8fb6de', '#9fc4e8', '#bcd9f2', '#cfe5f7', '#e0f0fb'), detail: 'cracks' },
    passable: true, speedMult: 1.15, buildable: false, flammable: 0, fuel: 0, burnsTo: -1, heightClass: 0, wetness: 1.0, xpValue: 0 },
  { name: 'Mud', art: { ramp: ramp('#1c1610', '#241c12', '#33281a', '#3b2e1e', '#443423'), detail: 'wet' },
    passable: true, speedMult: 0.55, buildable: true, flammable: 0, fuel: 0, burnsTo: -1, heightClass: 1, wetness: 0.6, xpValue: 2, soulAffinity: 'armor' },
  { name: 'Gravel', art: { ramp: ramp('#5e626a', '#6b6f77', '#7d828c', '#878d98', '#9198a3'), detail: 'pebbles' },
    passable: true, speedMult: 0.95, buildable: true, flammable: 0, fuel: 0, burnsTo: -1, heightClass: 1, wetness: 0.05, xpValue: 1, soulAffinity: 'tool_pick' },
  { name: 'Tilled Soil', art: { ramp: ramp('#3d2f21', '#4a3928', '#5a4632', '#644e39', '#6e5740'), detail: 'furrows' },
    passable: true, speedMult: 0.9, buildable: false, flammable: 0.1, fuel: 1, burnsTo: 9, heightClass: 1, wetness: 0.15, xpValue: 1, soulAffinity: 'tool_axe' },
  { name: 'Shallows', art: { ramp: ramp('#1f5a90', '#2565a0', '#3579b4', '#4184be', '#4a8ec9'), detail: 'waves' },
    passable: true, speedMult: 0.6, buildable: false, flammable: 0, fuel: 0, burnsTo: -1, heightClass: 0, wetness: 1.0, xpValue: 0 },
  // ---- 16–23: realm-warped materials (N2b: per-tile gameplay effects) ----
  { name: 'Fading Zone', art: { ramp: ramp('#5e2050', '#7a2d68', '#98387f', '#b34a97', '#c862ae'), detail: 'speckle',
    accents: ramp('#e879d0', '#ffb0ec') },
    passable: true, speedMult: 0.5, buildable: false, flammable: 0, fuel: 0, burnsTo: -1, heightClass: 1, wetness: 0, xpValue: 4, soulAffinity: 'weapon',
    effects: { damagePerSec: 0.5 } },  // packet-loss: slow + chip damage
  { name: 'Flux Crystal', art: { ramp: ramp('#0f4a55', '#166470', '#1f838f', '#2fa3ad', '#4dc4cc'), detail: 'sparkle',
    accents: ramp('#7fe8f0', '#ffffff') },
    passable: true, speedMult: 0.3, buildable: false, flammable: 0, fuel: 0, burnsTo: -1, heightClass: 1, wetness: 0, xpValue: 6, soulAffinity: 'ring',
    effects: { stunOnEnterMs: 500, speedBurstOnExit: 1.5, speedBurstMs: 2000 } },  // latency spike: stun→rebound
  { name: 'Verdant Bloom', art: { ramp: ramp('#7a5a12', '#96721c', '#b38f28', '#ccab3f', '#e0c65e'), detail: 'flowers',
    accents: ramp('#ffd700', '#ffec80') },
    passable: true, speedMult: 1.2, buildable: true, flammable: 0.1, fuel: 4, burnsTo: 9, heightClass: 1, wetness: 0.05, xpValue: 3, soulAffinity: 'amulet',
    effects: { regenMult: 2.0, gatherYieldMult: 1.5 } },  // bandwidth bloom: double regen + richer gathers
  { name: 'Dead Zone', art: { ramp: ramp('#1a1a1c', '#232326', '#2d2d31', '#3a3a3f', '#48484e'), detail: 'speckle' },
    passable: true, speedMult: 1.0, buildable: false, flammable: 0, fuel: 0, burnsTo: -1, heightClass: 1, wetness: 0, xpValue: 1,
    effects: { noGathering: true } },  // dead zone: no building, no gathering
  { name: 'Scorch Wall', art: { ramp: ramp('#7a2508', '#96330d', '#b34415', '#cc5a22', '#e07536'), detail: 'pebbles',
    accents: ramp('#ff6600', '#ff9944') },
    passable: false, speedMult: 0, buildable: true, flammable: 0, fuel: 0, burnsTo: -1, heightClass: 2, wetness: 0, xpValue: 0,
    effects: { damagePerSec: 2.0 } },  // firewall barrier: hurts anything touching it
  { name: 'Azure Vein', art: { ramp: ramp('#2f5a91', '#3d6ea8', '#5588cc', '#71a3dd', '#93c1f0'), detail: 'sparkle' },
    passable: true, speedMult: 1.0, buildable: true, flammable: 0, fuel: 0, burnsTo: -1, heightClass: 1, wetness: 0.05, xpValue: 5, soulAffinity: 'charm',
    effects: { xpMult: 1.5 } },  // DNS cache: bonus XP while standing on it
  { name: 'Warp Rift', art: { ramp: ramp('#3d1170', '#521a91', '#6b25b8', '#8a3fd6', '#a961ee'), detail: 'cracks',
    accents: ramp('#aa44ff', '#dd99ff') },
    passable: true, speedMult: 1.0, buildable: false, flammable: 0, fuel: 0, burnsTo: -1, heightClass: 1, wetness: 0, xpValue: 8, soulAffinity: 'amulet',
    effects: { damagePerSec: 1.5, stunOnEnterMs: 300 } },  // routing loop: disorienting + chip damage
  { name: 'Ley Bloom', art: { ramp: ramp('#0d5c26', '#137a33', '#1c9944', '#2eb85a', '#4cd477'), detail: 'sparkle',
    accents: ramp('#5cff92', '#b6ffcf') },
    passable: true, speedMult: 1.3, buildable: true, flammable: 0.05, fuel: 3, burnsTo: 9, heightClass: 1, wetness: 0.02, xpValue: 5, soulAffinity: 'weapon',
    effects: { soulXpMult: 2.0, buildSpeedMult: 1.5 } },  // signal booster: double soul XP + faster building
];

/** Material ids by name — index into MATERIALS. */
export const M = {
  DEEP: 0, WATER: 1, SAND: 2, GRASS: 3, MEADOW: 4, FOREST: 5, HILL: 6, MOUNTAIN: 7,
  SNOW: 8, DIRT: 9, ASH: 10, ICE: 11, MUD: 12, GRAVEL: 13, TILLED: 14, SHALLOW: 15,
  PKT_LOSS: 16, LATENCY: 17, BANDWIDTH: 18, DEADZONE: 19, FIREWALL: 20, DNSCACHE: 21, ROUTING: 22, SIGNAL: 23,
} as const;

/** floats per material in the packed table (see layout below). */
export const STRIDE = 7;

/** Flat-pack the numeric props for upload into the wasm core.
 * Layout per material: [passable(0|1), speedMult, buildable(0|1), flammable, fuel, burnsTo, wetness]. */
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
    out[o + 6] = m.wetness;
  }
  return out;
}
