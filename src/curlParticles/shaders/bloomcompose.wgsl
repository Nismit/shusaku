// ブルーム合成 + ACES トーンマッピング

struct Params {
  strength: f32,
  toneMapping: f32,
};

@group(0) @binding(0) var uSampler: sampler;
@group(0) @binding(1) var uOriginal: texture_2d<f32>;
@group(0) @binding(2) var uBloom: texture_2d<f32>;
@group(0) @binding(3) var<uniform> p: Params;

fn acesToneMap(x: vec3<f32>) -> vec3<f32> {
  let a = 2.51;
  let b = 0.03;
  let c = 2.43;
  let d = 0.59;
  let e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), vec3<f32>(0.0), vec3<f32>(1.0));
}

@fragment
fn fs(@location(0) texCoord: vec2<f32>) -> @location(0) vec4<f32> {
  let original = textureSampleLevel(uOriginal, uSampler, texCoord, 0.0);
  let bloom = textureSampleLevel(uBloom, uSampler, texCoord, 0.0);
  let color = (original + bloom * p.strength).rgb;
  let mapped = acesToneMap(color);
  let result = mix(color, mapped, p.toneMapping);
  return vec4<f32>(result, 1.0);
}
