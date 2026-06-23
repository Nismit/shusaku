// スクリーンスペースモーションブラー (fullscreen)
// 速度バッファに沿って 21 サンプルを平均。

struct Params {
  resolution: vec2<f32>,
  maxDistance: f32,
  motionMultiplier: f32,
  leaning: f32,
  _pad0: f32,
  _pad1: f32,
  _pad2: f32,
};

@group(0) @binding(0) var uSampler: sampler;
@group(0) @binding(1) var uTexture: texture_2d<f32>;
@group(0) @binding(2) var uVelocity: texture_2d<f32>;
@group(0) @binding(3) var<uniform> p: Params;

const SAMPLE_COUNT = 21;

@fragment
fn fs(@location(0) texCoord: vec2<f32>) -> @location(0) vec4<f32> {
  let motion = textureSampleLevel(uVelocity, uSampler, texCoord, 0.0).xy;
  var offset = motion * p.resolution * p.motionMultiplier;
  let offsetDistance = length(offset);
  if (offsetDistance > p.maxDistance) {
    offset = normalize(offset) * p.maxDistance;
  }

  let delta = -offset / p.resolution * 2.0 / f32(SAMPLE_COUNT);
  var pos = texCoord - delta * p.leaning * f32(SAMPLE_COUNT);

  var color = vec3<f32>(0.0);
  for (var i = 0; i < SAMPLE_COUNT; i++) {
    color += textureSampleLevel(uTexture, uSampler, pos, 0.0).rgb;
    pos += delta;
  }

  return vec4<f32>(color / f32(SAMPLE_COUNT), 1.0);
}
