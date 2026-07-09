struct Params {
  decay: f32,
};

@group(0) @binding(0) var uSampler: sampler;
@group(0) @binding(1) var uTexture: texture_2d<f32>;
@group(0) @binding(2) var<uniform> p: Params;

@fragment
fn fs(@location(0) texCoord: vec2<f32>) -> @location(0) vec4<f32> {
  let color = textureSampleLevel(uTexture, uSampler, texCoord, 0.0);
  return vec4<f32>(color.rgb * p.decay, 1.0);
}
