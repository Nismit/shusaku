struct Uniforms {
  viewProj: mat4x4f,
  cameraPos: vec3f,
  farPlane: f32,
  time: f32,
  kick: f32,
};

@group(0) @binding(0) var<uniform> u: Uniforms;

struct VOut {
  @builtin(position) position: vec4f,
  @location(0) alpha: f32,
  @location(1) param: f32,
};

const ROTATE_SPEED: f32 = 0.12;

@vertex fn vs(@location(0) pos: vec3f, @location(1) alpha: f32, @location(2) param: f32) -> VOut {
  let angle = u.time * ROTATE_SPEED;
  let c = cos(angle);
  let s = sin(angle);
  let rotated = vec3f(pos.x * c - pos.z * s, pos.y, pos.x * s + pos.z * c);
  var out: VOut;
  out.position = u.viewProj * vec4f(rotated, 1.0);
  out.alpha = alpha;
  out.param = param;
  return out;
}

const FILL_SPEED: f32 = 0.45;
const EDGE_WIDTH: f32 = 0.03;

@fragment fn fs(v: VOut) -> @location(0) vec4f {
  if (v.param < 0.0) {
    return vec4f(1.0, 1.0, 1.0, v.alpha);
  }

  let baseLevel = 0.5 + 0.45 * sin(u.time * FILL_SPEED);
  let level = mix(baseLevel, 0.95, u.kick);
  let d = v.param - level;
  if (d > EDGE_WIDTH) { discard; }

  let edge = 1.0 - smoothstep(0.0, EDGE_WIDTH, abs(d));
  let filled = 1.0 - smoothstep(0.0, EDGE_WIDTH, d);
  let col = vec3f(1.0) + edge * 1.2;
  let a = v.alpha * filled + edge * 0.9;
  return vec4f(col, saturate(a));
}
