struct Params {
  bgTop: vec3<f32>,
  _p0: f32,
  bgBottom: vec3<f32>,
  toneMapping: f32,
  exposure: f32,
  saturation: f32,
};

@group(0) @binding(0) var uSampler: sampler;
@group(0) @binding(1) var uAccum: texture_2d<f32>;
@group(0) @binding(2) var<uniform> p: Params;

fn sRGBToLinear(c: vec3<f32>) -> vec3<f32> {
  return pow(c, vec3<f32>(2.2));
}

fn acesToneMap(x: vec3<f32>) -> vec3<f32> {
  let a = 2.51;
  let b = 0.03;
  let c = 2.43;
  let d = 0.59;
  let e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), vec3<f32>(0.0), vec3<f32>(1.0));
}

fn dither(pos: vec2<f32>) -> f32 {
  return fract(sin(dot(pos, vec2<f32>(12.9898, 78.233))) * 43758.5453)
       - fract(sin(dot(pos + 1.0, vec2<f32>(12.9898, 78.233))) * 43758.5453);
}

@fragment
fn fs(@builtin(position) fragCoord: vec4<f32>, @location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  let bg = mix(sRGBToLinear(p.bgTop), sRGBToLinear(p.bgBottom), uv.y);
  let accum = textureSampleLevel(uAccum, uSampler, uv, 0.0).rgb;

  var color = bg + accum * p.exposure;

  let luma = dot(color, vec3<f32>(0.299, 0.587, 0.114));
  color = mix(vec3<f32>(luma), color, p.saturation);

  let mapped = acesToneMap(color);
  color = mix(color, mapped, p.toneMapping);
  color += dither(fragCoord.xy) / 255.0;

  return vec4<f32>(color, 1.0);
}
