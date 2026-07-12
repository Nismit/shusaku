struct Uniforms {
  viewProj: mat4x4f,
  cameraPos: vec3f,
  farPlane: f32,
  time: f32,
};

@group(0) @binding(0) var<uniform> u: Uniforms;

struct VOut {
  @builtin(position) position: vec4f,
  @location(0) perimParam: f32,
};

@vertex fn vs(@location(0) pos: vec3f, @location(1) param: f32, @location(2) speed: f32) -> VOut {
  var out: VOut;
  out.position = u.viewProj * vec4f(pos, 1.0);
  out.perimParam = param;
  return out;
}

@fragment fn fs(v: VOut) -> @location(0) vec4f {
  let speed = 0.4;
  let len = 1.0 / 6.0;
  let head = fract(u.time * speed);
  var d = v.perimParam - head;
  if (d < -0.5) { d += 1.0; }
  if (d > 0.5) { d -= 1.0; }
  let mask = smoothstep(len, len * 0.8, abs(d));
  if (mask < 0.01) { discard; }
  return vec4f(1.0, 1.0, 1.0, mask * 0.7);
}
