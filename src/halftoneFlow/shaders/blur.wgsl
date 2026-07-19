// 分離型ガウシアンブラー (5-tap, sigma ~1.4) (fullscreen)
// WebGL 版 blur.frag の WGSL 移植。

struct Params {
  texelSize: vec2<f32>,
  direction: vec2<f32>,
};

@group(0) @binding(0) var uSampler: sampler;
@group(0) @binding(1) var uTexture: texture_2d<f32>;
@group(0) @binding(2) var<uniform> p: Params;

@fragment
fn fs(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  let d = p.direction * p.texelSize;
  var sum = textureSampleLevel(uTexture, uSampler, uv - 2.0 * d, 0.0) * 0.06136;
  sum += textureSampleLevel(uTexture, uSampler, uv - 1.0 * d, 0.0) * 0.24477;
  sum += textureSampleLevel(uTexture, uSampler, uv, 0.0) * 0.38774;
  sum += textureSampleLevel(uTexture, uSampler, uv + 1.0 * d, 0.0) * 0.24477;
  sum += textureSampleLevel(uTexture, uSampler, uv + 2.0 * d, 0.0) * 0.06136;
  return sum;
}
