// ============================================================================
// SR7 — the boss-slam punch: chromatic aberration + a short radial pull,
// decaying over ~220ms. One filter, added to the stage only while it's live
// (PostProcess.triggerSlam) rather than sitting neutral every frame like the
// grade pass — a screen-space distortion has no honest "neutral" value the
// way exposure=1 does, so the real revert here is absence, not zero.
// ============================================================================
import type { Filter } from 'pixi.js';
import { makeFilter, uni } from './filter';

// Line-aligned with the WGSL below, same convention as grade.ts.
const WGSL = `
  var c = textureSample(uTexture, uSampler, uv);
  if (c.a <= 0.0) { return c; }
  let toCenter = screenUV(uv) - vec2<f32>(0.5, 0.5);
  let k = u.uSlam.x;
  let off = toCenter * k * 0.018;
  let cr = textureSample(uTexture, uSampler, uv + off);
  let cb = textureSample(uTexture, uSampler, uv - off);
  var rgb = vec3<f32>(cr.r / max(cr.a, 0.001), c.g / c.a, cb.b / max(cb.a, 0.001));
  var blur = rgb;
  var wsum = 1.0;
  for (var i = 1; i <= 3; i = i + 1) {
    let t = f32(i) * 0.012 * k;
    let s = textureSample(uTexture, uSampler, uv - toCenter * t);
    blur = blur + s.rgb / max(s.a, 0.001);
    wsum = wsum + 1.0;
  }
  rgb = blur / wsum;
  return vec4<f32>(rgb * c.a, c.a);
`;

const GLSL = `
  vec4 c = texture(uTexture, uv);
  if (c.a <= 0.0) { finalColor = c; return; }
  vec2 toCenter = screenUV(uv) - vec2(0.5, 0.5);
  float k = uSlam.x;
  vec2 off = toCenter * k * 0.018;
  vec4 cr = texture(uTexture, uv + off);
  vec4 cb = texture(uTexture, uv - off);
  vec3 rgb = vec3(cr.r / max(cr.a, 0.001), c.g / c.a, cb.b / max(cb.a, 0.001));
  vec3 blur = rgb;
  float wsum = 1.0;
  for (int i = 1; i <= 3; i++) {
    float t = float(i) * 0.012 * k;
    vec4 s = texture(uTexture, uv - toCenter * t);
    blur += s.rgb / max(s.a, 0.001);
    wsum += 1.0;
  }
  rgb = blur / wsum;
  finalColor = vec4(rgb * c.a, c.a);
`;

export function makeSlamFilter(): Filter {
  return makeFilter({
    name: 'nw-slam',
    // strength 0..1 (decaying), spare, spare, spare
    uniforms: { uSlam: { value: new Float32Array([0, 0, 0, 0]), type: 'vec4<f32>' } },
    wgsl: WGSL,
    glsl: GLSL,
  });
}

export function setSlamStrength(f: Filter, k: number) {
  (uni(f).uSlam as Float32Array)[0] = Math.max(0, Math.min(1, k));
  (f.resources as any).u.update();
}
