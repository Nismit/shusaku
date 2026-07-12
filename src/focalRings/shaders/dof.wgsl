@group(0) @binding(0) var samp: sampler;
@group(0) @binding(1) var colorTex: texture_2d<f32>;
@group(0) @binding(2) var bloomTex: texture_2d<f32>;

struct Params {
  bloomIntensity: f32,
};

@group(0) @binding(3) var<uniform> params: Params;

@fragment fn fs(@location(0) uv: vec2f) -> @location(0) vec4f {
  var col = textureSample(colorTex, samp, uv).rgb;

  let bloom = textureSample(bloomTex, samp, uv).rgb;
  col += bloom * params.bloomIntensity;

  return vec4f(pow(saturate(col), vec3f(1.0 / 2.2)), 1.0);
}
