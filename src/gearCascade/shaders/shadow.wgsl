struct ShadowU { lightViewProj: mat4x4f };

@group(0) @binding(0) var<uniform> u: ShadowU;
@group(0) @binding(1) var<storage, read> parts: array<mat4x4f>;

struct VOut {
  @builtin(position) position: vec4f,
  @location(0) depth: f32,
};

@vertex fn vs(@location(0) pos: vec3f, @location(2) partId: f32) -> VOut {
  let clip = u.lightViewProj * parts[u32(partId)] * vec4f(pos, 1.0);
  var out: VOut;
  out.position = clip;
  out.depth = clip.z / clip.w;
  return out;
}

@fragment fn fs(v: VOut) -> @location(0) vec4f {
  return vec4f(v.depth, 0.0, 0.0, 1.0);
}
