struct Uniforms {
  viewProj: mat4x4f,
  cameraPos: vec3f,
  farPlane: f32,
  time: f32,
};

@group(0) @binding(0) var<uniform> u: Uniforms;

struct VOut {
  @builtin(position) position: vec4f,
  @location(0) alpha: f32,
};

@vertex fn vs(@location(0) pos: vec3f, @location(1) alpha: f32, @location(2) speed: f32) -> VOut {
  let angle = u.time * speed;
  let c = cos(angle);
  let s = sin(angle);
  let rotated = vec3f(pos.x * c - pos.z * s, pos.y, pos.x * s + pos.z * c);
  var out: VOut;
  out.position = u.viewProj * vec4f(rotated, 1.0);
  out.alpha = alpha;
  return out;
}

@fragment fn fs(v: VOut) -> @location(0) vec4f {
  return vec4f(1.0, 1.0, 1.0, v.alpha);
}
