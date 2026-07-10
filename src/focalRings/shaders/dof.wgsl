@group(0) @binding(0) var samp: sampler;
@group(0) @binding(1) var colorTex: texture_2d<f32>;
@group(0) @binding(2) var depthTex: texture_2d<f32>;

struct DofParams {
  resolution: vec2f,
  focalDepth: f32,
  aperture: f32,
  maxBlur: f32,
  _pad0: f32,
  _pad1: f32,
  _pad2: f32,
};

@group(0) @binding(3) var<uniform> dof: DofParams;

const GOLDEN_ANGLE: f32 = 2.39996323;
const NUM_SAMPLES: i32 = 64;
const BG_DEPTH: f32 = 0.9;

@fragment fn fs(@location(0) uv: vec2f) -> @location(0) vec4f {
  let texel = 1.0 / dof.resolution;
  let center = textureSample(colorTex, samp, uv).rgb;
  let depth = textureSample(depthTex, samp, uv).r;

  let isBg = step(BG_DEPTH, depth);
  let coc = clamp(dof.aperture * abs(depth - dof.focalDepth), 0.0, 1.0);
  let radius = coc * dof.maxBlur * (1.0 - isBg * 0.85);

  var col = center;
  var wt = 1.0;

  for (var i = 1; i <= NUM_SAMPLES; i++) {
    let fi = f32(i);
    let ang = fi * GOLDEN_ANGLE;
    let r = sqrt(fi / f32(NUM_SAMPLES)) * radius;
    let off = vec2f(cos(ang), sin(ang)) * r * texel;

    let sc = textureSample(colorTex, samp, uv + off).rgb;
    let lum = dot(sc, vec3f(0.333));
    let w = 0.05 + lum;
    col += sc * w;
    wt += w;
  }

  col /= wt;
  return vec4f(pow(saturate(col), vec3f(1.0 / 2.2)), 1.0);
}
