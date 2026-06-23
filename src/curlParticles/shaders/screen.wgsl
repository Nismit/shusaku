// renderFBO を画面へ転送 (fullscreen passthrough)

@group(0) @binding(0) var uSampler: sampler;
@group(0) @binding(1) var uTexture: texture_2d<f32>;

@fragment
fn fs(@location(0) texCoord: vec2<f32>) -> @location(0) vec4<f32> {
  let color = textureSample(uTexture, uSampler, texCoord);
  return vec4<f32>(color.rgb, 1.0);
}
