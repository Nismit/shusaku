// Kawase Blur (fullscreen)
// 4つの斜めコーナーを半ピクセルオフセットでサンプリング。反復ごとにオフセット増加。

struct Params {
  texelSize: vec2<f32>,
  iteration: f32,
  _pad: f32,
};

@group(0) @binding(0) var uSampler: sampler;
@group(0) @binding(1) var uTexture: texture_2d<f32>;
@group(0) @binding(2) var<uniform> p: Params;

@fragment
fn fs(@location(0) texCoord: vec2<f32>) -> @location(0) vec4<f32> {
  let off = p.texelSize * (p.iteration + 0.5);

  var color = textureSampleLevel(uTexture, uSampler, texCoord + vec2<f32>(-off.x,  off.y), 0.0);
  color     += textureSampleLevel(uTexture, uSampler, texCoord + vec2<f32>( off.x,  off.y), 0.0);
  color     += textureSampleLevel(uTexture, uSampler, texCoord + vec2<f32>( off.x, -off.y), 0.0);
  color     += textureSampleLevel(uTexture, uSampler, texCoord + vec2<f32>(-off.x, -off.y), 0.0);

  return color * 0.25;
}
