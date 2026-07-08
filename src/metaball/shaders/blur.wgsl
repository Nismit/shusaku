struct VOut { @builtin(position) position: vec4f, @location(0) uv: vec2f }

@vertex fn vs(@builtin(vertex_index) i: u32) -> VOut {
  var pos = array<vec2f, 3>(vec2f(-1, -1), vec2f(3, -1), vec2f(-1, 3));
  var o: VOut;
  o.position = vec4f(pos[i], 0, 1);
  o.uv = pos[i] * vec2f(0.5, -0.5) + vec2f(0.5);
  return o;
}

struct Params { texelSize: vec2f, iteration: f32, _pad: f32 }

@group(0) @binding(0) var samp: sampler;
@group(0) @binding(1) var tex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: Params;

@fragment fn fs(in: VOut) -> @location(0) vec4f {
  let horizontal = (u32(params.iteration) & 1u) == 0u;
  let dir = select(vec2f(0.0, 1.0), vec2f(1.0, 0.0), horizontal);
  let step = dir * params.texelSize;
  let weights = array<f32, 5>(0.227027, 0.1945946, 0.1216216, 0.054054, 0.016216);
  var color = textureSample(tex, samp, in.uv).rgb * weights[0];
  for (var i = 1; i < 5; i++) {
    let offset = step * f32(i);
    color += textureSample(tex, samp, in.uv + offset).rgb * weights[i];
    color += textureSample(tex, samp, in.uv - offset).rgb * weights[i];
  }
  return vec4f(color, 1.0);
}
