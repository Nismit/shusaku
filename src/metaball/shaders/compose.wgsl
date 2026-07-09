struct VOut { @builtin(position) position: vec4f, @location(0) uv: vec2f }

@vertex fn vs(@builtin(vertex_index) i: u32) -> VOut {
  var pos = array<vec2f, 3>(vec2f(-1, -1), vec2f(3, -1), vec2f(-1, 3));
  var o: VOut;
  o.position = vec4f(pos[i], 0, 1);
  o.uv = pos[i] * vec2f(0.5, -0.5) + vec2f(0.5);
  return o;
}

struct Params { strength: f32, toneMapping: f32, _p0: f32, _p1: f32 }

@group(0) @binding(0) var samp: sampler;
@group(0) @binding(1) var sceneTex: texture_2d<f32>;
@group(0) @binding(2) var bloomTex: texture_2d<f32>;
@group(0) @binding(3) var<uniform> params: Params;

fn aces(x: vec3f) -> vec3f {
  let a = x * (x * 2.51 + 0.03);
  let b = x * (x * 2.43 + 0.59) + 0.14;
  return clamp(a / b, vec3f(0.0), vec3f(1.0));
}

@fragment fn fs(in: VOut) -> @location(0) vec4f {
  let scene = textureSample(sceneTex, samp, in.uv).rgb;
  let bloom = textureSample(bloomTex, samp, in.uv).rgb;
  var color = scene + bloom * params.strength;
  color = mix(color, aces(color), params.toneMapping);
  color = pow(color, vec3f(1.0 / 2.2));
  return vec4f(color, 1.0);
}
