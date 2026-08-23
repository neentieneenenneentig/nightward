// ============================================================================
// SR4 + SR6 + part of SR8 — one full-screen pass that does the whole grade.
//
// It replaces GradePass (a multiply-blended Graphics rect rebuilt every frame)
// and VignettePass (TWELVE concentric filled circles, also rebuilt every frame,
// approximating a radial gradient the GPU can evaluate exactly). Both of those
// were geometry standing in for maths. This is the maths.
//
// The eight stages, in the order the eye reads them:
//
//   exposure -> contrast -> saturation -> split-tone -> tint
//            -> filmic roll-off -> vignette -> dithered posterise
//
// Split-tone is the single biggest reason Diablo looks like Diablo: warm
// highlights against cool shadows. One `mix` per pixel buys most of it.
//
// The filmic roll-off matters specifically because SR4 also makes bloom real.
// Additive glow clips to flat white the moment it saturates, and flat white is
// the most 1990s thing a frame can contain. The ACES curve bends the top end so
// a bright fire goes yellow-white and KEEPS its shape.
//
// The dithered posterise is the "2025 pixel game" tell. A hard quantise bands;
// a quantise with a pixel-hash offset dissolves the band into stipple, which is
// what a good pixel artist does by hand. It also hides the banding the grade
// itself introduces on a near-black night sky.
//
// Every stage is neutral at its default (pillar 5): exposure 1, contrast 1,
// saturation 1, warmth 0, tint strength 0, roll-off 0, vignette 0, steps 0 is
// a byte-for-byte passthrough.
// ============================================================================
import type { Filter } from 'pixi.js';
import { makeFilter, uni } from './filter';

export interface GradeSettings {
  /** Linear multiplier before everything else. 1 = untouched. */
  exposure: number;
  /** Around a 0.5 pivot. 1 = untouched, 1.15 is a noticeable but sane push. */
  contrast: number;
  /** 0 = greyscale, 1 = untouched, >1 pushes. */
  saturation: number;
  /** Split-tone amount. Warm highlights, cool shadows. 0 = untouched. */
  warmth: number;
  /** Biome tint, RGB 0..255, and how much of it to apply. */
  tint: [number, number, number];
  tintStrength: number;
  /** How much of the filmic curve to blend in. 0 = linear, 1 = full ACES. */
  rolloff: number;
  /** Edge darkening, and where it starts as a fraction of the half-diagonal. */
  vignette: number;
  vignetteRadius: number;
  /** Quantisation steps per channel. 0 disables it. Below about 12 the look
   *  goes from "graded" to "posterised", which is a decision, not an accident. */
  steps: number;
  /** Dither amplitude, in units of 1.0 = full range. ~1/128 is right. */
  dither: number;
}

export const NEUTRAL_GRADE: GradeSettings = {
  exposure: 1, contrast: 1, saturation: 1, warmth: 0,
  tint: [255, 255, 255], tintStrength: 0,
  rolloff: 0, vignette: 0, vignetteRadius: 0.55,
  steps: 0, dither: 0,
};

// The two bodies are kept LINE-ALIGNED on purpose. When one backend renders
// something the other does not, the diff is the bug, and a diff only works if
// the two sides are written to be diffable.
const WGSL = `
  var c = textureSample(uTexture, uSampler, uv);
  if (c.a <= 0.0) { return c; }
  var rgb = c.rgb / c.a;
  rgb = rgb * u.uGrade.x;
  rgb = (rgb - vec3<f32>(0.5)) * u.uGrade.y + vec3<f32>(0.5);
  let l = luma(rgb);
  rgb = mix(vec3<f32>(l), rgb, u.uGrade.z);
  rgb = rgb + (l - 0.5) * u.uGrade.w * vec3<f32>(0.20, 0.06, -0.18);
  rgb = mix(rgb, rgb * u.uTint.rgb, u.uTint.w);
  let t = (rgb * (2.51 * rgb + vec3<f32>(0.03))) / (rgb * (2.43 * rgb + vec3<f32>(0.59)) + vec3<f32>(0.14));
  rgb = mix(rgb, clamp(t, vec3<f32>(0.0), vec3<f32>(1.0)), u.uVig.z);
  let d = distance(screenUV(uv), vec2<f32>(0.5, 0.5)) * 1.41421;
  rgb = rgb * (1.0 - u.uVig.x * smoothstep(u.uVig.y, 1.0, d));
  let n = dither(pos.xy);
  if (u.uPal.x > 0.5) { rgb = floor(rgb * u.uPal.x + n * 0.9 + 0.5) / u.uPal.x; }
  rgb = clamp(rgb + n * u.uVig.w, vec3<f32>(0.0), vec3<f32>(1.0));
  return vec4<f32>(rgb * c.a, c.a);
`;

const GLSL = `
  vec4 c = texture(uTexture, uv);
  if (c.a <= 0.0) { finalColor = c; return; }
  vec3 rgb = c.rgb / c.a;
  rgb = rgb * uGrade.x;
  rgb = (rgb - vec3(0.5)) * uGrade.y + vec3(0.5);
  float l = luma(rgb);
  rgb = mix(vec3(l), rgb, uGrade.z);
  rgb = rgb + (l - 0.5) * uGrade.w * vec3(0.20, 0.06, -0.18);
  rgb = mix(rgb, rgb * uTint.rgb, uTint.w);
  vec3 t = (rgb * (2.51 * rgb + vec3(0.03))) / (rgb * (2.43 * rgb + vec3(0.59)) + vec3(0.14));
  rgb = mix(rgb, clamp(t, vec3(0.0), vec3(1.0)), uVig.z);
  float d = distance(screenUV(uv), vec2(0.5, 0.5)) * 1.41421;
  rgb = rgb * (1.0 - uVig.x * smoothstep(uVig.y, 1.0, d));
  float n = dither(gl_FragCoord.xy);
  if (uPal.x > 0.5) { rgb = floor(rgb * uPal.x + n * 0.9 + 0.5) / uPal.x; }
  rgb = clamp(rgb + n * uVig.w, vec3(0.0), vec3(1.0));
  finalColor = vec4(rgb * c.a, c.a);
`;

export function makeGradeFilter(): Filter {
  return makeFilter({
    name: 'nw-grade',
    uniforms: {
      // exposure, contrast, saturation, warmth
      uGrade: { value: new Float32Array([1, 1, 1, 0]), type: 'vec4<f32>' },
      // tint rgb 0..1, strength
      uTint: { value: new Float32Array([1, 1, 1, 0]), type: 'vec4<f32>' },
      // vignette intensity, vignette radius, roll-off, dither
      uVig: { value: new Float32Array([0, 0.55, 0, 0]), type: 'vec4<f32>' },
      // posterise steps, spare, spare, spare
      uPal: { value: new Float32Array([0, 0, 0, 0]), type: 'vec4<f32>' },
    },
    wgsl: WGSL,
    glsl: GLSL,
  });
}

/** Push a settings object into the filter's uniforms. Cheap enough to call
 *  every frame — it writes twelve floats into arrays Pixi already owns. */
export function applyGrade(f: Filter, g: GradeSettings) {
  const u = uni(f);
  const a = u.uGrade as Float32Array;
  a[0] = g.exposure; a[1] = g.contrast; a[2] = g.saturation; a[3] = g.warmth;
  const b = u.uTint as Float32Array;
  b[0] = g.tint[0] / 255; b[1] = g.tint[1] / 255; b[2] = g.tint[2] / 255; b[3] = g.tintStrength;
  const c = u.uVig as Float32Array;
  c[0] = g.vignette; c[1] = g.vignetteRadius; c[2] = g.rolloff; c[3] = g.dither;
  const d = u.uPal as Float32Array;
  d[0] = g.steps;
  // Pixi tracks dirty state per uniform group, not per element, so an in-place
  // array write needs the group flagged by hand or the GPU keeps last frame's
  // values — the classic "my uniform never updates" bug.
  (f.resources as any).u.update();
}
