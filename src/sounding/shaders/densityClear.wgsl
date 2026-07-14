const CELL_COUNT: u32 = 4096u;

@group(0) @binding(0) var<storage, read_write> density: array<atomic<u32>>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= CELL_COUNT) { return; }
  atomicStore(&density[id.x], 0u);
}
