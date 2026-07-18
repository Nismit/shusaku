// 染料フィールドを画面へ転送 + dot matrix ポストエフェクト (fullscreen)
// WebGL 版 display.frag の WGSL 移植 + LED パネル風ハーフトーン。
// シミュレーションは WebGL と同じ y-up 座標系で解いているため、
// chottoGPU のフルスクリーン uv (y-down / top-left 原点) に合わせて y を反転する。

struct Params {
  resolution: vec2<f32>, // canvas のデバイスピクセル解像度
  cellSize: f32,         // ドット格子 1 セルの一辺 (px)
  dotScale: f32,         // セルに対するドット最大半径の比 (0..1)
  enabled: f32,          // 0 = 素の流体, 1 = dot matrix
  _pad0: f32,
  _pad1: f32,
  _pad2: f32,
};

@group(0) @binding(0) var uSampler: sampler;
@group(0) @binding(1) var uTexture: texture_2d<f32>;
@group(0) @binding(2) var<uniform> p: Params;

// sim は y-up なので表示時に y を反転してサンプルする
fn sampleField(uv: vec2<f32>) -> vec3<f32> {
  return textureSampleLevel(uTexture, uSampler, vec2<f32>(uv.x, 1.0 - uv.y), 0.0).rgb;
}

@fragment
fn fs(@builtin(position) fragCoord: vec4<f32>, @location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  let plain = sampleField(uv);

  // スクリーンピクセル空間でセル格子を組む (アスペクトに依らず正方ドット)
  let cell = max(p.cellSize, 2.0);
  let cellCenter = floor(fragCoord.xy / cell) * cell + cell * 0.5;
  let cellColor = sampleField(cellCenter / p.resolution);

  // 輝度でドット半径を決める。面積 ∝ 輝度 になるよう半径は sqrt を取る。
  let lum = clamp(dot(cellColor, vec3<f32>(0.299, 0.587, 0.114)), 0.0, 1.0);
  let maxR = cell * 0.5 * p.dotScale;
  let radius = maxR * sqrt(lum);

  // 1px アンチエイリアスした円マスク
  let d = distance(fragCoord.xy, cellCenter);
  let mask = 1.0 - smoothstep(radius - 1.0, radius + 1.0, d);

  let dotColor = cellColor * mask;
  let color = mix(plain, dotColor, p.enabled);
  return vec4<f32>(color, 1.0);
}
