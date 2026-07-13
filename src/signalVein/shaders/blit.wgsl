// Upscales the low-res raymarch target onto the full-res canvas.
@group(0) @binding(0) var blitSampler: sampler;
@group(0) @binding(1) var blitTexture: texture_2d<f32>;

@fragment
fn fs(@location(0) uv: vec2f) -> @location(0) vec4f {
  return textureSample(blitTexture, blitSampler, uv);
}
