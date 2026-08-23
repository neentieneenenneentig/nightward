// ============================================================================
// SR4 — which things in the world emit light, and what kind.
//
// A table, not a switch statement, for the reason every other table in this
// codebase is a table: a light that can only be added by editing a render loop
// is a light nobody adds. Before this, exactly ONE thing in NIGHTWARD glowed —
// campfires — hard-coded inside main.ts's render function, and glowing in the
// wrong coordinate space at that.
//
// `hz` and `flicker` matter more than they look. Fire that flickers at frame
// rate reads as a rendering fault; the eye only accepts flame from something
// that moves slower than it does. Everything here breathes between 0.5 and 3 Hz
// and no light varies by more than a sixth of its own brightness.
//
// Colours are chosen as LIGHT, not as paint. A forge is not orange — it is a
// white-hot centre that falls off THROUGH orange, so every colour here sits
// high and only leans warm or cold. Saturated light is what makes a scene look
// like coloured cellophane instead of like it is lit.
//
// Every id below is checked against BUILDINGS. A row aimed at a building that
// does not exist is a dormant row, and this codebase treats those as the
// cardinal sin — so the regression suite asserts this table's keys are real.
// ============================================================================
export interface LightDef {
  /** World-pixel radius of the falloff. TILE is 32, so 48 is a tile and a half. */
  radius: number;
  /** Peak brightness, 0..1. */
  intensity: number;
  /** RGB 0..255, as emitted light. */
  color: [number, number, number];
  /** Breathing rate in Hz. */
  hz: number;
  /** Fraction of itself the light varies by, 0..1. */
  flicker: number;
}

const fire = (radius: number, intensity: number): LightDef =>
  ({ radius, intensity, color: [255, 178, 96], hz: 2.4, flicker: 0.13 });
const frost = (radius: number, intensity: number): LightDef =>
  ({ radius, intensity, color: [172, 224, 255], hz: 0.8, flicker: 0.06 });
const storm = (radius: number, intensity: number): LightDef =>
  ({ radius, intensity, color: [196, 200, 255], hz: 3.0, flicker: 0.16 });
const blight = (radius: number, intensity: number): LightDef =>
  ({ radius, intensity, color: [186, 236, 150], hz: 1.1, flicker: 0.09 });

export const BUILDING_LIGHT: Record<string, LightDef> = {
  // ---- hearth and home ----
  campfire: { radius: 64, intensity: 0.82, color: [255, 168, 74], hz: 2.7, flicker: 0.14 },
  hall: { radius: 80, intensity: 0.50, color: [255, 216, 156], hz: 0.6, flicker: 0.04 },
  beacon: { radius: 96, intensity: 0.68, color: [255, 238, 196], hz: 1.3, flicker: 0.08 },
  forge_warden: { radius: 68, intensity: 0.74, color: [255, 198, 126], hz: 1.9, flicker: 0.12 },
  workshop: { radius: 44, intensity: 0.34, color: [255, 210, 158], hz: 0.9, flicker: 0.06 },
  // Cold, patient light: the three buildings that are about knowing rather than
  // making. They read as a different KIND of place before you can name why.
  waystone: { radius: 58, intensity: 0.56, color: [158, 200, 255], hz: 0.9, flicker: 0.07 },
  reliquary: { radius: 56, intensity: 0.50, color: [202, 162, 255], hz: 0.7, flicker: 0.06 },
  shrine: { radius: 52, intensity: 0.46, color: [222, 206, 255], hz: 0.5, flicker: 0.05 },
  sounding_stone: { radius: 62, intensity: 0.58, color: [140, 236, 224], hz: 1.2, flicker: 0.10 },

  // ---- the tower ladder ----
  // A tower's light is its element, so a defended wall reads at a glance as a
  // line of fire, frost or storm without a single icon.
  tower_ember: fire(48, 0.46), tower_inferno: fire(58, 0.60), tower_forge: fire(54, 0.54),
  trap_flame: fire(38, 0.40),
  tower_frost: frost(48, 0.42), tower_glacier: frost(58, 0.54), tower_hail: frost(52, 0.48),
  tower_bolt: storm(48, 0.44), tower_storm: storm(58, 0.58), tower_arc: storm(52, 0.50),
  tower_blight: blight(48, 0.42), tower_plague: blight(58, 0.52), tower_venom: blight(52, 0.46),
};
