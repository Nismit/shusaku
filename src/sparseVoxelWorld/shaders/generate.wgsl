const GRID_X: u32 = 128u;
const GRID_Y: u32 = 64u;
const GRID_Z: u32 = 128u;

const AIR: u32 = 0u;
const GRASS: u32 = 1u;
const DIRT: u32 = 2u;
const STONE: u32 = 3u;
const SNOW: u32 = 4u;
const SAND: u32 = 5u;
const WOOD: u32 = 6u;
const LEAVES: u32 = 7u;

struct GenParams {
  seed: f32,
  waterLevel: f32,
  _pad: vec2f,
};

@group(0) @binding(0) var<uniform> params: GenParams;
@group(0) @binding(1) var<storage, read_write> voxels: array<u32>;

fn idx(x: u32, y: u32, z: u32) -> u32 {
  return x + y * GRID_X + z * GRID_X * GRID_Y;
}

fn hash(p: vec2f) -> f32 {
  return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453);
}

fn noise(p: vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2f(1.0, 0.0)), u.x),
    mix(hash(i + vec2f(0.0, 1.0)), hash(i + vec2f(1.0, 1.0)), u.x),
    u.y
  );
}

fn fbm(pin: vec2f) -> f32 {
  var v = 0.0;
  var a = 0.5;
  var p = pin;
  let rot = mat2x2f(0.8, -0.6, 0.6, 0.8);
  for (var i = 0u; i < 6u; i++) {
    v += a * noise(p);
    p = rot * p * 2.0;
    a *= 0.5;
  }
  return v;
}

fn terrainHeight(x: f32, z: f32) -> f32 {
  let p = vec2f(x, z) * 0.02 + vec2f(params.seed * 10.0, params.seed * 7.3);
  let wx = fbm(p + vec2f(5.2, 1.3));
  let wz = fbm(p + vec2f(9.2, 3.7));
  let warped = p + vec2f(wx, wz) * 0.15;
  return 6.0 + fbm(warped) * 46.0;
}

const TREE_CELL: f32 = 7.0;

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let x = gid.x;
  let z = gid.y;
  if (x >= GRID_X || z >= GRID_Z) { return; }

  let fx = f32(x);
  let fz = f32(z);
  let wl = params.waterLevel;

  let h = terrainHeight(fx, fz);
  let surfY = i32(floor(h));

  let above = f32(surfY) - wl;
  var surfType = GRASS;
  if (above <= 2.0) { surfType = SAND; }
  else if (above > 20.0 && above <= 30.0) { surfType = STONE; }
  else if (above > 30.0) { surfType = SNOW; }

  for (var y = 0u; y < GRID_Y; y++) {
    let iy = i32(y);
    var vt = AIR;
    if (iy <= surfY) {
      if (iy == surfY) { vt = surfType; }
      else if (iy > surfY - 4) {
        vt = select(SAND, DIRT, surfType != SAND);
      } else { vt = STONE; }
    }
    voxels[idx(x, y, z)] = vt;
  }

  let tc = vec2f(floor(fx / TREE_CELL), floor(fz / TREE_CELL));
  for (var dx = -1; dx <= 1; dx++) {
    for (var dz = -1; dz <= 1; dz++) {
      let c = tc + vec2f(f32(dx), f32(dz));
      if (hash(c * 137.0 + vec2f(42.0, 89.0)) > 0.3) { continue; }

      let tx = c.x * TREE_CELL + hash(c * 173.0 + vec2f(11.0, 53.0)) * (TREE_CELL - 2.0) + 1.0;
      let tz = c.y * TREE_CELL + hash(c * 197.0 + vec2f(29.0, 67.0)) * (TREE_CELL - 2.0) + 1.0;
      let th = i32(4.0 + hash(c * 211.0 + vec2f(47.0, 71.0)) * 3.0);

      let tSurf = i32(floor(terrainHeight(tx, tz)));
      let tAbove = f32(tSurf) - wl;
      if (tAbove <= 2.0 || tAbove > 20.0) { continue; }

      let adx = abs(fx - tx);
      let adz = abs(fz - tz);

      if (adx < 0.5 && adz < 0.5) {
        for (var ty = tSurf + 1; ty <= tSurf + th; ty++) {
          if (ty >= 0 && ty < i32(GRID_Y)) {
            voxels[idx(x, u32(ty), z)] = WOOD;
          }
        }
      }

      let cheb = max(adx, adz);
      let cBase = tSurf + th - 1;
      for (var cy = cBase; cy <= cBase + 4; cy++) {
        if (cy < 0 || cy >= i32(GRID_Y)) { continue; }
        let layer = f32(cy - cBase);
        let rad = 3.0 - layer * 0.7;
        if (cheb <= rad) {
          let vi = idx(x, u32(cy), z);
          if (voxels[vi] == AIR) {
            voxels[vi] = LEAVES;
          }
        }
      }
    }
  }
}
