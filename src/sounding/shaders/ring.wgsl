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
  @location(1) worldXZ: vec2f,
};

@vertex fn vs(@location(0) pos: vec3f, @location(1) alpha: f32, @location(2) speed: f32) -> VOut {
  let angle = u.time * speed;
  let c = cos(angle);
  let s = sin(angle);
  let rotated = vec3f(pos.x * c - pos.z * s, pos.y, pos.x * s + pos.z * c);

  var out: VOut;
  out.position = u.viewProj * vec4f(rotated, 1.0);
  out.alpha = alpha;
  out.worldXZ = rotated.xz;
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

const COLD_COL: vec3f = vec3f(0.25, 0.38, 0.55);
const HOT_COL: vec3f  = vec3f(0.55, 0.85, 1.0);

@fragment fn fs(v: VOut) -> @location(0) vec4f {
  let d = sampleDensity(v.worldXZ);

  let baseAlpha = 0.04;
  let a = v.alpha * (baseAlpha + d * 1.2);
  let col = mix(COLD_COL, HOT_COL, d);

  return vec4f(col, saturate(a));
}
