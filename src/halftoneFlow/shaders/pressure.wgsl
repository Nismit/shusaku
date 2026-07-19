// 圧力ポアソン方程式の Jacobi 反復 1 ステップ (fullscreen)
// WebGL 版 pressure.frag の WGSL 移植。

struct Params {
  texelSize: vec2<f32>,
};

@group(0) @binding(0) var uSampler: sampler;
@group(0) @binding(1) var uPressure: texture_2d<f32>;
@group(0) @binding(2) var uDivergence: texture_2d<f32>;
@group(0) @binding(3) var<uniform> p: Params;

@fragment
fn fs(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  let L = textureSampleLevel(uPressure, uSampler, uv - vec2<f32>(p.texelSize.x, 0.0), 0.0).x;
  let R = textureSampleLevel(uPressure, uSampler, uv + vec2<f32>(p.texelSize.x, 0.0), 0.0).x;
  let T = textureSampleLevel(uPressure, uSampler, uv + vec2<f32>(0.0, p.texelSize.y), 0.0).x;
  let B = textureSampleLevel(uPressure, uSampler, uv - vec2<f32>(0.0, p.texelSize.y), 0.0).x;
  let div = textureSampleLevel(uDivergence, uSampler, uv, 0.0).x;
  let pressure = (L + R + B + T - div) * 0.25;
  return vec4<f32>(pressure, 0.0, 0.0, 1.0);
}
