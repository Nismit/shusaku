// 染料フィールドを画面へ転送 (fullscreen)
// WebGL 版 display.frag の WGSL 移植。
// シミュレーションは WebGL と同じ y-up 座標系で解いているため、
// chottoGPU のフルスクリーン uv (y-down / top-left 原点) に合わせて y を反転する。

@group(0) @binding(0) var uSampler: sampler;
@group(0) @binding(1) var uTexture: texture_2d<f32>;

@fragment
fn fs(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  let flipped = vec2<f32>(uv.x, 1.0 - uv.y);
  let color = textureSampleLevel(uTexture, uSampler, flipped, 0.0).rgb;
  return vec4<f32>(color, 1.0);
}
