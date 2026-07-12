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
  @location(2) phase: f32,
};

@vertex fn vs(@location(0) pos: vec3f, @location(1) alpha: f32, @location(2) param: f32) -> VOut {
  var out: VOut;
  out.position = u.viewProj * vec4f(pos, 1.0);
  out.alpha = alpha;
  out.param = param;
  out.phase = select(0.0, 3.14159265, pos.x < 0.0);
  return out;
}

const GAUGE_SPEED: f32 = 0.88;
const EDGE_WIDTH: f32 = 0.04;

@fragment fn fs(v: VOut) -> @location(0) vec4f {
  if (v.param < 0.0) {
    return vec4f(1.0, 1.0, 1.0, saturate(v.alpha + u.kick * 0.7));
  }

  let baseLevel = 0.5 + 0.42 * sin(u.time * GAUGE_SPEED + v.phase);
  let level = mix(baseLevel, 1.0, u.kick);
  let d = v.param - level;
  if (d > EDGE_WIDTH) { discard; }

  let edge = 1.0 - smoothstep(0.0, EDGE_WIDTH, abs(d));
  let filled = 1.0 - smoothstep(0.0, EDGE_WIDTH, d);
  let col = vec3f(1.0) + edge * 1.2;
  let a = v.alpha * filled + edge * 0.9;
  return vec4f(col, saturate(a));
}
