struct VOut { @builtin(position) position: vec4f, @location(0) uv: vec2f }

@vertex fn vs(@builtin(vertex_index) i: u32) -> VOut {
  var pos = array<vec2f, 3>(vec2f(-1, -1), vec2f(3, -1), vec2f(-1, 3));
  var o: VOut;
  o.position = vec4f(pos[i], 0, 1);
  o.uv = pos[i] * vec2f(0.5, -0.5) + vec2f(0.5);
  return o;
}

struct Params { threshold: f32, _p0: f32, _p1: f32, _p2: f32 }

@group(0) @binding(0) var samp: sampler;
@group(0) @binding(1) var tex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: Params;

@fragment fn fs(in: VOut) -> @location(0) vec4f {
  let c = textureSample(tex, samp, in.uv).rgb;
  let lum = dot(c, vec3f(0.2126, 0.7152, 0.0722));
  let bright = max(vec3f(0.0), c * (lum - params.threshold) / max(lum, 0.001));
  return vec4f(bright, 1.0);
}
