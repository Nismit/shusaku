struct Uniforms {
  viewProj: mat4x4f,
  cameraPos: vec3f,
  farPlane: f32,
};

@group(0) @binding(0) var<uniform> u: Uniforms;

struct VOut {
  @builtin(position) position: vec4f,
  @location(0) worldPos: vec3f,
};

@vertex fn vs(@location(0) pos: vec3f, @location(1) alpha: f32) -> VOut {
  var out: VOut;
  out.position = u.viewProj * vec4f(pos, 1.0);
  out.worldPos = pos;
  return out;
}

@fragment fn fs(v: VOut) -> @location(0) vec4f {
  let depth = length(v.worldPos - u.cameraPos) / u.farPlane;
  return vec4f(depth, 0.0, 0.0, 1.0);
}
