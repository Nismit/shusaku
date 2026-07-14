const GRID_SIZE: u32 = 64u;
const WORLD_MIN: f32 = -4.0;
const WORLD_MAX: f32 = 4.0;

struct Params {
  count: u32,
  _pad0: u32,
  _pad1: u32,
  _pad2: u32,
};

@group(0) @binding(0) var<storage, read> positions: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read_write> density: array<atomic<u32>>;
@group(0) @binding(2) var<uniform> params: Params;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let idx = id.x;
  if (idx >= params.count) { return; }

  let pos = positions[idx].xyz;
  let worldRange = WORLD_MAX - WORLD_MIN;
  let gxf = (pos.x - WORLD_MIN) / worldRange * f32(GRID_SIZE);
  let gzf = (pos.z - WORLD_MIN) / worldRange * f32(GRID_SIZE);

  let gx = clamp(i32(gxf), 0, i32(GRID_SIZE) - 1);
  let gz = clamp(i32(gzf), 0, i32(GRID_SIZE) - 1);
  let cellIdx = u32(gz) * GRID_SIZE + u32(gx);

  atomicAdd(&density[cellIdx], 1u);
}
