// ============================================================================
// SR4/SR6/SR8 — The look, as data.
//
// Everything that decides how NIGHTWARD is COLOURED lives here, in one table
// and one function, for the same reason NET_GAME_MAP is a table: a look you can
// only change by editing three call sites is a look nobody ever tunes.
//
// The reference is Diablo, and what Diablo actually does is narrower than it
// looks. It is not "dark". A dark frame is a frame you cannot read. It is:
//
//   * warm highlights against cool shadows — torchlight versus stone;
//   * crushed but never black shadows, so the dark still has texture in it;
//   * a heavy vignette that puts the character at the centre of a lit circle;
//   * saturation held BACK on the world so that spell colour reads as an event.
//
// That last one is the discipline most pixel games miss. If the grass is
// vivid, a fireball is just more vivid. The world here is pulled toward its
// greys and the glow layer is where the colour goes.
// ============================================================================
import type { GradeSettings } from './grade';

/** The realms the wire puts you in, and how each one is lit. Tint is what the
 *  BIOME does to the light; warmth is the split-tone strength on top. */
export interface RealmLook {
  tint: [number, number, number];
  tintStrength: number;
  warmth: number;
  saturation: number;
}

export const REALM_LOOK: Record<string, RealmLook> = {
  // Copper and lamplight. The only realm that is genuinely warm.
  ethernet: { tint: [255, 226, 188], tintStrength: 0.13, warmth: 0.55, saturation: 0.98 },
  // Moonlight through glass. Cool, and the least saturated of the four.
  wifi: { tint: [186, 206, 255], tintStrength: 0.15, warmth: 0.28, saturation: 0.90 },
  // A red sky. Cellular is where the wire is worst and the world should feel it.
  cellular: { tint: [255, 186, 176], tintStrength: 0.17, warmth: 0.62, saturation: 1.02 },
  unknown: { tint: [214, 214, 214], tintStrength: 0.06, warmth: 0.30, saturation: 0.95 },
};

export interface LookInputs {
  realm: string;
  /** 0 = full day, 1 = deepest night. */
  night: number;
  /** The wire is offline. */
  offline: boolean;
  /** N4.3 Surge strength, 0..1 — packet loss made visible. */
  surge: number;
  /** SR7 — a short spike after a heavy hit. 0..1. */
  impact: number;
  tier: 'low' | 'mid' | 'high';
  /** SR5 — CFG.gfx.lights. Off means no ambient darkening either: a night with
   *  no light pools to hold back the dark is a broken frame, not a cheap one. */
  lights: boolean;
  /** SR6 — CFG.gfx.palette. Gates the posterise step count; the split-tone
   *  warmth stage and the per-realm LUT (REALM_LOOK, below) are load-bearing
   *  for the look and stay on regardless — see PostProcess.setGraded for the
   *  actual real revert (the whole filter comes off the stage). */
  palette: boolean;
  /** SR8 — CFG.gfx.atmosphere. The exposure/warmth/fog half of the Diablo
   *  pass: darker night, harder warm-fire/cold-haze split, a cold fog at the
   *  frame's edge. Off means these three deltas are zero, not halved — the
   *  base night curve above (tint, nightAmbient, the existing vignette) stays
   *  exactly as it was before SR8 either way. */
  atmosphere: boolean;
}

/**
 * One function, called once a frame, that turns the world's current state into
 * twelve floats.
 *
 * The night curve is the interesting part. Naively you dim the exposure, and
 * the result is a frame that is uniformly darker and no more nocturnal — the
 * grass is just grey grass at 60%. What actually reads as night is exposure
 * down A LITTLE, contrast UP, saturation down, the tint pulled cold, and the
 * vignette closed in hard. The eye reads "night" off the colour of the shadows
 * and the size of the lit circle, not off the brightness of the midtones.
 */
export function lookFor(i: LookInputs): GradeSettings {
  const r = REALM_LOOK[i.realm] ?? REALM_LOOK.unknown;
  const n = Math.max(0, Math.min(1, i.night));

  // Cold pull at night: the biome tint is crossfaded toward moonlight rather
  // than replaced, so an Ethernet night still reads warmer than a WiFi one.
  const moon: [number, number, number] = [150, 176, 230];
  const tint: [number, number, number] = [
    r.tint[0] * (1 - n * 0.7) + moon[0] * n * 0.7,
    r.tint[1] * (1 - n * 0.7) + moon[1] * n * 0.7,
    r.tint[2] * (1 - n * 0.7) + moon[2] * n * 0.7,
  ];

  // SR8 — the Diablo pass's grading half: darker exposure, harder warm/cold
  // split, a cold haze at distance. All three are DELTAS added to the SR4/SR6
  // curve above, zero when atmosphere is off, so the gate is a real revert
  // rather than a re-tune of numbers other phases already settled.
  const atmo = i.atmosphere ? n : 0;

  // The world is overcast at noon, not just after dusk — a FLAT pull, never
  // scaled by `n`, so it is there for the ~70% of a run's clock (daySec 240 vs
  // nightSec 100) that CFG.time spends in daylight. Before this, n=0 produced
  // the literal NEUTRAL_GRADE plus a weak realm tint, which is why a game
  // named for the night read as a lovely sunny day for most of every run.
  // Night's own deltas (below) are untouched and still stack on top of this
  // floor, so the day→night gap is exactly as wide as it always was — it now
  // runs dim→darker instead of bright→dark.
  const OVERCAST_EXPOSURE = 0.08;
  const OVERCAST_SATURATION = 0.12;
  const OVERCAST_VIGNETTE = 0.08;
  const OVERCAST_TINT_STRENGTH = 0.05;

  const g: GradeSettings = {
    exposure: 1.0 - OVERCAST_EXPOSURE - n * 0.18 - i.surge * 0.06 + i.impact * 0.35 - atmo * 0.08,
    contrast: 1.06 + n * 0.14 + i.impact * 0.10,
    saturation: r.saturation - OVERCAST_SATURATION - n * 0.18 - i.impact * 0.45,
    warmth: r.warmth * (1 - n * 0.45) + atmo * 0.14,
    tint,
    tintStrength: r.tintStrength + OVERCAST_TINT_STRENGTH + n * 0.10,
    // The filmic roll-off is what stops the new bloom from clipping to white.
    // It is the single stage that must never be tier-gated off, because the
    // alternative is not "cheaper", it is "blown out".
    rolloff: 0.55,
    vignette: 0.16 + OVERCAST_VIGNETTE + n * 0.26 + (i.offline ? 0.14 : 0) + i.surge * 0.22,
    vignetteRadius: 0.52 - n * 0.10,
    // SR6: 7 steps per channel, dithered — the "graded, not banded" line the
    // plan draws at. Off at 'low' for the same reason dither is: a posterise
    // with no dither to break its edges is the ONE combination that looks
    // worse than doing nothing, so the two share a gate rather than each
    // getting their own.
    steps: i.palette && i.tier !== 'low' ? 7 : 0,
    dither: i.tier === 'low' ? 0 : 1 / 160,
    // SR5 — darkness with pools of light, minus the pools: the mask that says
    // WHERE the pools are lives in the shader (uLightMask), sampled straight
    // off SR4's glow layer. This is only the floor a pixel is held to without
    // one. It now carries most of what tintNight used to do by brightness
    // crush alone (see config.ts) — the difference is this floor lifts back
    // toward 1 near a light and the old flat multiply never could.
    nightAmbient: i.lights ? 1 - n * 0.55 : 1,
    // SR8 — cold ambient haze at the frame's edge, sharing the vignette's own
    // falloff curve (see grade.ts's vigT) rather than a second radius. Rides
    // ONLY the atmosphere gate, not night alone, so day never fogs.
    fogTint: [138, 156, 196],
    fogStrength: atmo * 0.22,
  };

  // A Surge turns the world hostile — the omen already darkens and shakes, and
  // this is the colour half of the same event. Hue toward blood, saturation up
  // rather than down, because a Surge should look like the world is WRONG, not
  // like the lights went out.
  if (i.surge > 0) {
    const k = i.surge;
    g.tint = [
      g.tint[0] * (1 - k) + 255 * k,
      g.tint[1] * (1 - k) + 120 * k,
      g.tint[2] * (1 - k) + 112 * k,
    ];
    g.tintStrength = Math.min(0.42, g.tintStrength + 0.16 * k);
    g.saturation += 0.20 * k;
    g.warmth += 0.25 * k;
  }

  // A hit desaturates and lifts for a few frames — the classic ARPG impact
  // flash, done to the whole frame rather than to one sprite, which is what
  // makes a boss slam feel like it happened to YOU.
  g.saturation = Math.max(0, g.saturation);
  g.exposure = Math.max(0.35, g.exposure);
  return g;
}
