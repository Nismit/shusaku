// 煙の蓄積バッファを解決し、背景グラデーションへ合成する (fullscreen)
//   accum.rgb = Σ(litColor * density),  accum.a = Σ(density)
//   avgColor  = accum.rgb / accum.a           (順序非依存の加重平均色)
//   coverage  = 1 - exp(-accum.a * densityScale)  (Beer-Lambert 風の不透明度)
// 出力は線形 HDR。トーンマッピングは後段 (screen / bloomcompose) の ACES で行う。

struct CParams {
  bgTop: vec3<f32>,
  densityScale: f32,
  bgBottom: vec3<f32>,
  exposure: f32,
  saturation: f32,
  contrast: f32,
  _pad0: f32,
  _pad1: f32,
};

@group(0) @binding(0) var uSampler: sampler;
@group(0) @binding(1) var uSmoke: texture_2d<f32>;
@group(0) @binding(2) var<uniform> p: CParams;

fn sRGBToLinear(c: vec3<f32>) -> vec3<f32> {
  return pow(c, vec3<f32>(2.2));
}

fn dither(uv: vec2<f32>) -> f32 {
  return fract(sin(dot(uv, vec2<f32>(12.9898, 78.233))) * 43758.5453)
       - fract(sin(dot(uv + 1.0, vec2<f32>(12.9898, 78.233))) * 43758.5453);
}

@fragment
fn fs(@builtin(position) fragCoord: vec4<f32>, @location(0) texCoord: vec2<f32>) -> @location(0) vec4<f32> {
  var bg = mix(sRGBToLinear(p.bgTop), sRGBToLinear(p.bgBottom), texCoord.y);
  bg += dither(fragCoord.xy) / 255.0;

  let accum = textureSample(uSmoke, uSampler, texCoord);
  let dens = accum.a;
  let avgColor = accum.rgb / max(dens, 1e-4);
  let coverage = 1.0 - exp(-dens * p.densityScale);

  var color = mix(bg, avgColor, coverage);

  // カラーグレーディング (トーンマップ前)
  let luma = dot(color, vec3<f32>(0.299, 0.587, 0.114));
  color = mix(vec3<f32>(luma), color, p.saturation);
  color = (color - 0.5) * p.contrast + 0.5;
  color = max(color, vec3<f32>(0.0)) * p.exposure;

  return vec4<f32>(color, 1.0);
}
