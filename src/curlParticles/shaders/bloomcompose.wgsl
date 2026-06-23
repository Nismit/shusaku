// ブルーム合成 (fullscreen): オリジナル + ブルーム * 強度

struct Params {
  strength: f32,
};

@group(0) @binding(0) var uSampler: sampler;
@group(0) @binding(1) var uOriginal: texture_2d<f32>;
@group(0) @binding(2) var uBloom: texture_2d<f32>;
@group(0) @binding(3) var<uniform> p: Params;

@fragment
fn fs(@location(0) texCoord: vec2<f32>) -> @location(0) vec4<f32> {
  let original = textureSampleLevel(uOriginal, uSampler, texCoord, 0.0);
  let bloom = textureSampleLevel(uBloom, uSampler, texCoord, 0.0);
  let finalColor = original + bloom * p.strength;
  return vec4<f32>(finalColor.rgb, 1.0);
}
