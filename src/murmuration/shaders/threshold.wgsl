// ブルーム: 明度しきい値抽出 (fullscreen)

struct Params {
  threshold: f32,
};

@group(0) @binding(0) var uSampler: sampler;
@group(0) @binding(1) var uTexture: texture_2d<f32>;
@group(0) @binding(2) var<uniform> p: Params;

@fragment
fn fs(@location(0) texCoord: vec2<f32>) -> @location(0) vec4<f32> {
  let color = textureSampleLevel(uTexture, uSampler, texCoord, 0.0);
  let brightness = dot(color.rgb, vec3<f32>(0.2126, 0.7152, 0.0722));
  if (brightness > p.threshold) {
    return color;
  }
  return vec4<f32>(0.0, 0.0, 0.0, 1.0);
}
