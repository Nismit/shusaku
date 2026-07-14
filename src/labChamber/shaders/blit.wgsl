@group(0) @binding(0) var linearSampler: sampler;
@group(0) @binding(1) var colorTexture: texture_2d<f32>;

@fragment fn fs(@location(0) uv: vec2f) -> @location(0) vec4f {
  return textureSample(colorTexture, linearSampler, uv);
}
