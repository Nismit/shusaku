// 背景グラデーション (fullscreen)
// 深度アタッチメント付きパスで使うため depthStencil 状態を持つ (depthWrite=false)。

struct BgParams {
  bgTop: vec3<f32>,
  bgBottom: vec3<f32>,
};

@group(0) @binding(0) var<uniform> bg: BgParams;

fn sRGBToLinear(c: vec3<f32>) -> vec3<f32> {
  return pow(c, vec3<f32>(2.2));
}

fn dither(p: vec2<f32>) -> f32 {
  return fract(sin(dot(p, vec2<f32>(12.9898, 78.233))) * 43758.5453)
       - fract(sin(dot(p + 1.0, vec2<f32>(12.9898, 78.233))) * 43758.5453);
}

@fragment
fn fs(@builtin(position) fragCoord: vec4<f32>, @location(0) texCoord: vec2<f32>) -> @location(0) vec4<f32> {
  // texCoord.y=0 が画面上端 (top-left origin) なので top を y=0 側に
  var color = mix(sRGBToLinear(bg.bgTop), sRGBToLinear(bg.bgBottom), texCoord.y);
  color += dither(fragCoord.xy) / 255.0;
  return vec4<f32>(color, 1.0);
}
