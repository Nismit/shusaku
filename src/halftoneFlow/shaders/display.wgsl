// 染料フィールドを画面へ転送 + ポストエフェクト (fullscreen)
// 長押しで DOT / PIXEL / HEX を順に切り替える。
// 切り替え時は prevMode → currentMode へ smoothstep でモーフする。

struct Params {
  resolution: vec2<f32>,
  cellSize: f32,
  dotScale: f32,
  currentMode: f32,  // 0=dot, 1=pixel, 2=hex
  prevMode: f32,
  transition: f32,   // 0→1: prevMode → currentMode
  _pad: f32,
};

@group(0) @binding(0) var uSampler: sampler;
@group(0) @binding(1) var uTexture: texture_2d<f32>;
@group(0) @binding(2) var<uniform> p: Params;

fn sampleField(uv: vec2<f32>) -> vec3<f32> {
  return textureSampleLevel(uTexture, uSampler, vec2<f32>(uv.x, 1.0 - uv.y), 0.0).rgb;
}

fn patternColor(mode: f32, col: vec3<f32>, dotMask: f32, hexMask: f32) -> vec3<f32> {
  if mode < 0.5 { return col * dotMask; }
  if mode < 1.5 { return col; }
  return col * hexMask;
}

@fragment
fn fs(@builtin(position) fragCoord: vec4<f32>, @location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  let cell = max(p.cellSize, 2.0);
  let cellCenter = floor(fragCoord.xy / cell) * cell + cell * 0.5;
  let cellColor = sampleField(cellCenter / p.resolution);

  let lum = clamp(dot(cellColor, vec3<f32>(0.299, 0.587, 0.114)), 0.0, 1.0);
  let radius = cell * 0.5 * p.dotScale * sqrt(lum);
  let delta = fragCoord.xy - cellCenter;

  let dotMask = 1.0 - smoothstep(radius - 1.0, radius + 1.0, length(delta));
  let hexDist = max(abs(delta.x) * 0.866025 + abs(delta.y) * 0.5, abs(delta.y));
  let hexMask = 1.0 - smoothstep(radius - 1.0, radius + 1.0, hexDist);

  let fromColor = patternColor(p.prevMode, cellColor, dotMask, hexMask);
  let toColor = patternColor(p.currentMode, cellColor, dotMask, hexMask);
  let color = mix(fromColor, toColor, smoothstep(0.0, 1.0, p.transition));

  return vec4<f32>(color, 1.0);
}
