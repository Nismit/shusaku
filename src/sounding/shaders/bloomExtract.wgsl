@group(0) @binding(0) var samp: sampler;
@group(0) @binding(1) var colorTex: texture_2d<f32>;

const THRESHOLD: f32 = 0.30;
const KNEE: f32 = 0.25;

@fragment fn fs(@location(0) uv: vec2f) -> @location(0) vec4f {
  let c = textureSample(colorTex, samp, uv).rgb;
  let br = max(c.r, max(c.g, c.b));
  let soft = clamp(br - THRESHOLD + KNEE, 0.0, 2.0 * KNEE);
  let contrib = soft * soft / (4.0 * KNEE + 1e-5);
  let w = max(contrib, br - THRESHOLD) / max(br, 1e-5);
  return vec4f(c * clamp(w, 0.0, 1.0), 1.0);
}
