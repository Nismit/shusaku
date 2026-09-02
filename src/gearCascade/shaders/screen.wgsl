@group(0) @binding(0) var samp: sampler;
@group(0) @binding(1) var tex: texture_2d<f32>;

@fragment fn fs(@location(0) uv: vec2f) -> @location(0) vec4f {
  let col = saturate(textureSample(tex, samp, uv).rgb);
  let gamma = pow(col, vec3f(1.0 / 2.2));
  let d = length(uv - vec2f(0.5));
  let vignette = 1.0 - smoothstep(0.58, 1.08, d) * 0.20;
  return vec4f(gamma * vignette, 1.0);
}
