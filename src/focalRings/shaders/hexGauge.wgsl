struct Uniforms {
  viewProj: mat4x4f,
  cameraPos: vec3f,
  farPlane: f32,
  time: f32,
  kick: f32,
  rotBoost: f32,
  speedLevel: f32,
};

@group(0) @binding(0) var<uniform> u: Uniforms;

struct VOut {
  @builtin(position) position: vec4f,
  @location(0) alpha: f32,
  @location(1) param: f32,
};

@vertex fn vs(@location(0) pos: vec3f, @location(1) alpha: f32, @location(2) param: f32) -> VOut {
  var out: VOut;
  out.position = u.viewProj * vec4f(pos, 1.0);
  out.alpha = alpha;
  out.param = param;
  return out;
}

const EDGE_WIDTH: f32 = 0.03;
const WARN_COLOR: vec3f = vec3f(1.0, 0.28, 0.06);

@fragment fn fs(v: VOut) -> @location(0) vec4f {
  let warn = smoothstep(0.65, 1.0, u.speedLevel);
  let pulse = 1.0 + warn * 0.12 * sin(u.time * 8.0);

  if (v.param < 0.0) {
    let trackCol = mix(vec3f(1.0), WARN_COLOR, warn * 0.4) * pulse;
    return vec4f(trackCol, saturate(v.alpha + u.kick * 0.3));
  }

  let level = u.speedLevel;
  let d = v.param - level;
  if (d > EDGE_WIDTH) { discard; }

  let edge = 1.0 - smoothstep(0.0, EDGE_WIDTH, abs(d));
  let filled = 1.0 - smoothstep(0.0, EDGE_WIDTH, d);
  let flash = 1.0 + u.kick * 0.8;
  let baseCol = mix(vec3f(1.0), WARN_COLOR, warn) * flash * pulse;
  let col = baseCol + edge * 1.2;
  let a = v.alpha * filled + edge * 0.9;
  return vec4f(col, saturate(a));
}
