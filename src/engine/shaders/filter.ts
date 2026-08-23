// ============================================================================
// SR4 — The shader floor.
//
// Before this file, postprocess.ts opened with the words "zero shaders" as a
// FEATURE, and every effect in the game was Canvas2D gradients composited with
// blend modes. That is why the game looked like 1993: not pillar 1 — "no image
// assets" constrains where pixels come from, not how good they are — but the
// absence of any way to run code per pixel.
//
// Pixi v8 wants a filter to carry TWO programs, a WGSL `GpuProgram` and a GLSL
// `GlProgram`, because NIGHTWARD ships WebGPU by default and WebGL behind ?gl.
// Written by hand that is three declarations of the same uniform — once in
// TypeScript, once in a WGSL struct, once as GLSL `uniform` lines — and three
// places for them to drift apart. The whole point of this module is that a
// filter declares its uniforms ONCE and the two shader preambles are generated.
//
// The vertex boilerplate is Pixi's own, verified against `passthroughWgsl` and
// `defaultFilterVert` in pixi 8.19, so a Pixi upgrade that changes the filter
// vertex contract breaks here loudly rather than silently rendering nothing.
// ============================================================================
import { Filter, GlProgram, GpuProgram, UniformGroup, defaultFilterVert } from 'pixi.js';

/** The uniform types this floor supports. Deliberately NOT vec3 — WGSL aligns
 *  vec3 to 16 bytes and the padding rules are a footgun that costs an afternoon
 *  the first time a filter renders black for no visible reason. Pack a colour
 *  into a vec4 and put something useful in `.w`. */
export type UniformType = 'f32' | 'i32' | 'vec2<f32>' | 'vec4<f32>';

export interface UniformSpec {
  [name: string]: { value: number | number[] | Float32Array; type: UniformType };
}

const GLSL_TYPE: Record<UniformType, string> = {
  'f32': 'float',
  'i32': 'int',
  'vec2<f32>': 'vec2',
  'vec4<f32>': 'vec4',
};

/** Pixi's global filter uniforms and the vertex stage, in WGSL. Every custom
 *  filter gets this verbatim; only the fragment differs. */
const WGSL_HEAD = `
struct GlobalFilterUniforms {
  uInputSize: vec4<f32>,
  uInputPixel: vec4<f32>,
  uInputClamp: vec4<f32>,
  uOutputFrame: vec4<f32>,
  uGlobalFrame: vec4<f32>,
  uOutputTexture: vec4<f32>,
};

@group(0) @binding(0) var<uniform> gfu: GlobalFilterUniforms;
@group(0) @binding(1) var uTexture: texture_2d<f32>;
@group(0) @binding(2) var uSampler: sampler;

struct VSOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>
};

fn filterVertexPosition(aPosition: vec2<f32>) -> vec4<f32> {
  var position = aPosition * gfu.uOutputFrame.zw + gfu.uOutputFrame.xy;
  position.x = position.x * (2.0 / gfu.uOutputTexture.x) - 1.0;
  position.y = position.y * (2.0 * gfu.uOutputTexture.z / gfu.uOutputTexture.y) - gfu.uOutputTexture.z;
  return vec4(position, 0.0, 1.0);
}

fn filterTextureCoord(aPosition: vec2<f32>) -> vec2<f32> {
  return aPosition * (gfu.uOutputFrame.zw * gfu.uInputSize.zw);
}

@vertex
fn mainVertex(@location(0) aPosition: vec2<f32>) -> VSOutput {
  return VSOutput(filterVertexPosition(aPosition), filterTextureCoord(aPosition));
}
`;

/** Shared helpers both backends get, so a filter body reads the same in either
 *  language and can be diffed line-for-line when one of them misbehaves. */
const WGSL_LIB = `
/** Screen-space UV in 0..1 across the filter area, padding accounted for. */
fn screenUV(uv: vec2<f32>) -> vec2<f32> { return uv / gfu.uInputClamp.zw; }

fn luma(c: vec3<f32>) -> f32 { return dot(c, vec3<f32>(0.2126, 0.7152, 0.0722)); }

/** Cheap ordered-ish dither from the pixel position. Breaks the banding a
 *  grade always introduces on a dark palette — an 8-bit gradient across a
 *  near-black sky bands visibly, and one part in 255 of noise hides it. */
fn dither(p: vec2<f32>) -> f32 {
  return fract(sin(dot(floor(p), vec2<f32>(12.9898, 78.233))) * 43758.5453) - 0.5;
}
`;

const GLSL_LIB = `
vec2 screenUV(vec2 uv) { return uv / uInputClamp.zw; }
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
float dither(vec2 p) {
  return fract(sin(dot(floor(p), vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
}
`;

export interface FilterSpec {
  /** Used for the GL program name and for anything that has to report which
   *  shader misbehaved. Kebab-case. */
  name: string;
  /** Declared once; the WGSL struct and the GLSL uniform block are generated. */
  uniforms: UniformSpec;
  /**
   * The WGSL fragment. Write the body of a function whose inputs are `uv`
   * (`vec2<f32>`) and `pos` (`vec4<f32>`, the builtin position), which returns
   * a premultiplied `vec4<f32>`. Sample the input with
   * `textureSample(uTexture, uSampler, uv)`, read uniforms off `u.` and use the
   * helpers above.
   */
  wgsl: string;
  /**
   * The GLSL 300-es fragment body. `vTextureCoord` and `gl_FragCoord` are in
   * scope, uniforms are plain names, and the body must assign `finalColor`.
   */
  glsl: string;
  /** Extra WGSL/GLSL declared above the entry point — helper functions a body
   *  needs. Two strings because the languages differ; keep them line-aligned. */
  wgslHelpers?: string;
  glslHelpers?: string;
  /** Render the filter at a fraction of screen resolution. Light and bloom are
   *  low-frequency and half-res is free money; a grade must stay at 1. */
  resolution?: number;
  /** Padding in pixels around the filtered area, for effects that read outside
   *  their own footprint (blurs). */
  padding?: number;
}

/**
 * Build one Pixi filter that runs on both backends from a single declaration.
 * The returned filter carries its `UniformGroup` under `resources.u`, so a
 * caller sets a value with `filter.resources.u.uniforms.uThing = x`.
 */
export function makeFilter(spec: FilterSpec): Filter {
  const names = Object.keys(spec.uniforms);

  const wgslStruct = `struct FilterUniforms {\n`
    + names.map((n) => `  ${n}: ${spec.uniforms[n].type},`).join('\n')
    + `\n};\n@group(1) @binding(0) var<uniform> u: FilterUniforms;\n`;

  const glslUniforms = names
    .map((n) => `uniform ${GLSL_TYPE[spec.uniforms[n].type]} ${n};`)
    .join('\n');

  const wgslSource = WGSL_HEAD + wgslStruct + WGSL_LIB + (spec.wgslHelpers ?? '') + `
@fragment
fn mainFragment(@location(0) uv: vec2<f32>, @builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
${spec.wgsl}
}
`;

  const glslSource = `
in vec2 vTextureCoord;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform vec4 uInputSize;
uniform vec4 uInputClamp;
${glslUniforms}
${GLSL_LIB}${spec.glslHelpers ?? ''}
void main(void) {
  vec2 uv = vTextureCoord;
${spec.glsl}
}
`;

  return new Filter({
    gpuProgram: GpuProgram.from({
      vertex: { source: wgslSource, entryPoint: 'mainVertex' },
      fragment: { source: wgslSource, entryPoint: 'mainFragment' },
    }),
    glProgram: GlProgram.from({
      vertex: defaultFilterVert,
      fragment: glslSource,
      name: spec.name,
    }),
    resources: { u: new UniformGroup(spec.uniforms as any) },
    resolution: spec.resolution ?? 1,
    padding: spec.padding ?? 0,
  });
}

/** Typed accessor so callers never reach through three property hops by hand. */
export function uni(f: Filter): Record<string, any> {
  return (f.resources as any).u.uniforms;
}
