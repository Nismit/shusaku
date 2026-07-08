@group(0) @binding(0) var samp: sampler;
@group(0) @binding(1) var tex: texture_2d<f32>;

@fragment fn fs(@location(0) uv: vec2f) -> @location(0) vec4f {
  let col = saturate(textureSample(tex, samp, uv).rgb);
  let gamma = pow(col, vec3f(1.0 / 2.2));
  return vec4f(gamma, 1.0);
}
