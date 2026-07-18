// 染料フィールドを画面へ転送 + dot matrix ポストエフェクト (fullscreen)
// WebGL 版 display.frag の WGSL 移植 + LED パネル風ハーフトーン。
// 長押し中は dot から目標パターン (pixelated / diamond) へモーフする。
// シミュレーションは WebGL と同じ y-up 座標系で解いているため、
// chottoGPU のフルスクリーン uv (y-down / top-left 原点) に合わせて y を反転する。

struct Params {
  resolution: vec2<f32>, // canvas のデバイスピクセル解像度
  cellSize: f32,         // ドット格子 1 セルの一辺 (px)
  dotScale: f32,         // セルに対するマーク最大半径の比 (0..1)
  enabled: f32,          // 0 = 素の流体, 1 = dot matrix
  hold: f32,             // 長押しモーフ量 (0 = dot, 1 = 目標パターン)
  targetMode: f32,       // 0 = pixelated, 1 = diamond
  _pad: f32,
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

  // スクリーンピクセル空間でセル格子を組む (アスペクトに依らず正方セル)
  let cell = max(p.cellSize, 2.0);
  let cellCenter = floor(fragCoord.xy / cell) * cell + cell * 0.5;
  let cellColor = sampleField(cellCenter / p.resolution);

  // 輝度でマーク半径を決める。面積 ∝ 輝度 になるよう半径は sqrt を取る。
  let lum = clamp(dot(cellColor, vec3<f32>(0.299, 0.587, 0.114)), 0.0, 1.0);
  let radius = cell * 0.5 * p.dotScale * sqrt(lum);
  let delta = fragCoord.xy - cellCenter;

  // dot: ユークリッド距離の円
  let dotMask = 1.0 - smoothstep(radius - 1.0, radius + 1.0, length(delta));
  let dotColor = cellColor * dotMask;

  // 目標パターン: pixelated (セル全塗り) / diamond (マンハッタン距離の菱形)
  let pixelColor = cellColor;
  let diamondMask = 1.0 - smoothstep(radius - 1.0, radius + 1.0, abs(delta.x) + abs(delta.y));
  let diamondColor = cellColor * diamondMask;
  let targetColor = mix(pixelColor, diamondColor, p.targetMode);

  // dot ↔ 目標パターンを長押し量でモーフ
  let matrixColor = mix(dotColor, targetColor, clamp(p.hold, 0.0, 1.0));

  let color = mix(plain, matrixColor, p.enabled);
  return vec4<f32>(color, 1.0);
}
