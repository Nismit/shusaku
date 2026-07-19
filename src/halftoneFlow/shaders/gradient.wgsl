// 圧力勾配を速度場から差し引き非圧縮性を保つ (fullscreen)
// WebGL 版 gradient.frag の WGSL 移植。

struct Params {
  texelSize: vec2<f32>,
};

@group(0) @binding(0) var uSampler: sampler;
@group(0) @binding(1) var uPressure: texture_2d<f32>;
@group(0) @binding(2) var uVelocity: texture_2d<f32>;
@group(0) @binding(3) var<uniform> p: Params;

@fragment
fn fs(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  let L = textureSampleLevel(uPressure, uSampler, uv - vec2<f32>(p.texelSize.x, 0.0), 0.0).x;
  let R = textureSampleLevel(uPressure, uSampler, uv + vec2<f32>(p.texelSize.x, 0.0), 0.0).x;
  let T = textureSampleLevel(uPressure, uSampler, uv + vec2<f32>(0.0, p.texelSize.y), 0.0).x;
  let B = textureSampleLevel(uPressure, uSampler, uv - vec2<f32>(0.0, p.texelSize.y), 0.0).x;
  var velocity = textureSampleLevel(uVelocity, uSampler, uv, 0.0).xy;
  velocity -= vec2<f32>(R - L, T - B) * 0.5;
  return vec4<f32>(velocity, 0.0, 1.0);
}
