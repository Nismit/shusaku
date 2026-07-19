// 速度場の発散 (divergence) を計算 (fullscreen)
// WebGL 版 divergence.frag の WGSL 移植。

struct Params {
  texelSize: vec2<f32>,
};

@group(0) @binding(0) var uSampler: sampler;
@group(0) @binding(1) var uVelocity: texture_2d<f32>;
@group(0) @binding(2) var<uniform> p: Params;

@fragment
fn fs(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  let L = textureSampleLevel(uVelocity, uSampler, uv - vec2<f32>(p.texelSize.x, 0.0), 0.0).x;
  let R = textureSampleLevel(uVelocity, uSampler, uv + vec2<f32>(p.texelSize.x, 0.0), 0.0).x;
  let T = textureSampleLevel(uVelocity, uSampler, uv + vec2<f32>(0.0, p.texelSize.y), 0.0).y;
  let B = textureSampleLevel(uVelocity, uSampler, uv - vec2<f32>(0.0, p.texelSize.y), 0.0).y;
  let div = 0.5 * (R - L + T - B);
  return vec4<f32>(div, 0.0, 0.0, 1.0);
}
