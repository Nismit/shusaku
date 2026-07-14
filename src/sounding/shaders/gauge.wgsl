struct Scene {
  viewProj: mat4x4f,
  camRight: vec3f,
  time: f32,
  camUp: vec3f,
  particleSize: f32,
  densityScale: f32,
  _pad0: f32,
  _pad1: f32,
  _pad2: f32,
};

@group(0) @binding(0) var<uniform> u: Scene;
@group(0) @binding(1) var<storage, read> densityGrid: array<u32>;

const GRID_SIZE: f32 = 64.0;
const WORLD_MIN: f32 = -4.0;
const WORLD_MAX: f32 = 4.0;

struct VOut {
  @builtin(position) position: vec4f,
  @location(0) alpha: f32,
  @location(1) param: f32,
  @location(2) worldXZ: vec2f,
  @location(3) phase: f32,
};

@vertex fn vs(@location(0) pos: vec3f, @location(1) alpha: f32, @location(2) param: f32) -> VOut {
  var out: VOut;
  out.position = u.viewProj * vec4f(pos, 1.0);
  out.alpha = alpha;
  out.param = param;
  out.worldXZ = pos.xz;
  out.phase = select(0.0, 3.14159265, pos.x < 0.0);
  return out;
}

fn sampleDensity(wpos: vec2f) -> f32 {
  let worldRange = WORLD_MAX - WORLD_MIN;
  let gx = clamp(i32((wpos.x - WORLD_MIN) / worldRange * GRID_SIZE), 0, i32(GRID_SIZE) - 1);
  let gz = clamp(i32((wpos.y - WORLD_MIN) / worldRange * GRID_SIZE), 0, i32(GRID_SIZE) - 1);
  let cellIdx = u32(gz) * u32(GRID_SIZE) + u32(gx);
  let raw = f32(densityGrid[cellIdx]);
  return 1.0 - exp(-raw * u.densityScale);
}

const EDGE_WIDTH: f32 = 0.04;
const COLD_COL: vec3f = vec3f(0.3, 0.5, 0.7);
const HOT_COL: vec3f  = vec3f(0.6, 0.92, 1.0);

@fragment fn fs(v: VOut) -> @location(0) vec4f {
  let density = sampleDensity(v.worldXZ);

  if (v.param < 0.0) {
    let a = v.alpha * (0.03 + density * 0.8);
    let col = mix(COLD_COL, HOT_COL, density);
    return vec4f(col, saturate(a));
  }

  let baseLevel = 0.5 + 0.42 * sin(u.time * 0.88 + v.phase);
  let level = baseLevel * density;
  let d = v.param - level;
  if (d > EDGE_WIDTH) { discard; }

  let edge = 1.0 - smoothstep(0.0, EDGE_WIDTH, abs(d));
  let filled = 1.0 - smoothstep(0.0, EDGE_WIDTH, d);
  let col = mix(COLD_COL, HOT_COL, density) + edge * 1.2;
  let a = v.alpha * filled * density + edge * 0.9 * density;
  return vec4f(col, saturate(a));
}
