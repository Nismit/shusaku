@group(0) @binding(0) var samp: sampler;
@group(0) @binding(1) var colorTex: texture_2d<f32>;
@group(0) @binding(2) var bloomTex: texture_2d<f32>;

struct Params {
  bloomIntensity: f32,
  caStrength: f32,
};

@group(0) @binding(3) var<uniform> params: Params;

@fragment fn fs(@location(0) uv: vec2f) -> @location(0) vec4f {
  let center = vec2f(0.5);
  let dir = uv - center;
  let dist = length(dir);
  let offset = dir * dist * params.caStrength;

  var col: vec3f;
  col.r = textureSample(colorTex, samp, uv + offset).r;
  col.g = textureSample(colorTex, samp, uv).g;
  col.b = textureSample(colorTex, samp, uv - offset).b;

  let bloom = textureSample(bloomTex, samp, uv).rgb;
  col += bloom * params.bloomIntensity;

  return vec4f(pow(saturate(col), vec3f(1.0 / 2.2)), 1.0);
}
