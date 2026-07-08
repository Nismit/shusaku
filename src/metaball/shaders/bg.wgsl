struct BgParams {
  top: vec3f,
  _pad0: f32,
  bottom: vec3f,
  _pad1: f32,
}

struct VOut { @builtin(position) position: vec4f, @location(0) uv: vec2f }

@vertex fn vs(@builtin(vertex_index) i: u32) -> VOut {
  var pos = array<vec2f, 3>(vec2f(-1, -1), vec2f(3, -1), vec2f(-1, 3));
  var o: VOut;
  o.position = vec4f(pos[i], 1.0, 1.0);
  o.uv = pos[i] * vec2f(0.5, -0.5) + vec2f(0.5);
  return o;
}

@group(0) @binding(0) var<uniform> params: BgParams;

@fragment fn fs(in: VOut) -> @location(0) vec4f {
  let color = mix(params.bottom, params.top, in.uv.y);
  return vec4f(color, 1.0);
}
