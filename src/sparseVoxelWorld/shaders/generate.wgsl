const GRID_X: u32 = 128u;
const GRID_Y: u32 = 64u;
const GRID_Z: u32 = 128u;

const AIR: u32 = 0u;
const CRYSTAL: u32 = 1u;
const DARK_CRYSTAL: u32 = 2u;
const METAL: u32 = 3u;
const CORE: u32 = 4u;
const GAS_SEED: u32 = 5u;
const RUNE: u32 = 6u;
const SHARD: u32 = 7u;

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

fn hash12(p: vec2f) -> f32 {
  return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453);
}

fn hash13(p: vec3f) -> f32 {
  return fract(sin(dot(p, vec3f(17.31, 59.17, 113.91))) * 43758.5453);
}

fn prismMetric(p: vec2f) -> f32 {
  let a = abs(p);
  return max(a.x * 0.86 + a.y * 0.50, a.y);
}

fn ringDistance(p: vec2f, radius: f32) -> f32 {
  return abs(length(p) - radius);
}

fn nearestSpoke(p: vec2f, count: f32) -> vec2f {
  let ang = atan2(p.y, p.x);
  let sector = 6.2831853 / count;
  let spoke = round(ang / sector) * sector;
  return vec2f(cos(spoke), sin(spoke));
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let x = gid.x;
  let z = gid.y;
  if (x >= GRID_X || z >= GRID_Z) { return; }

  let fx = f32(x) - 64.0;
  let fz = f32(z) - 64.0;
  let radial = length(vec2f(fx, fz));
  let spokeDir = nearestSpoke(vec2f(fx, fz), 12.0);
  let spokeSide = abs(dot(vec2f(fx, fz), vec2f(-spokeDir.y, spokeDir.x)));
  let spokeAlong = dot(vec2f(fx, fz), spokeDir);

  for (var y = 0u; y < GRID_Y; y++) {
    let fy = f32(y);
    let p = vec3f(fx, fy - 30.0, fz);
    var vt = AIR;

    let floorRing = ringDistance(vec2f(fx, fz), 31.0);
    if (fy <= 2.0 && floorRing < 28.0) {
      vt = select(DARK_CRYSTAL, METAL, fract((fx + fz) * 0.125) > 0.45);
    }

    if (fy <= 5.0 && (ringDistance(vec2f(fx, fz), 18.0) < 1.2 || ringDistance(vec2f(fx, fz), 38.0) < 1.0)) {
      vt = RUNE;
    }

    for (var i = 0u; i < 12u; i++) {
      let fi = f32(i);
      let a = fi * 0.5235988 + params.seed * 0.013;
      let c = vec2f(cos(a), sin(a)) * 39.0;
      let q = vec2f(fx, fz) - c;
      let h = 36.0 + hash12(vec2f(fi, params.seed)) * 18.0;
      let taper = 1.0 - clamp((fy - 12.0) / h, 0.0, 0.75);
      let radius = 3.6 * taper + 0.8;
      if (fy < h && fy > 2.0 && prismMetric(q) < radius) {
        vt = select(CRYSTAL, DARK_CRYSTAL, hash12(vec2f(fi, floor(fy * 0.2))) < 0.22);
      }

      let cap = abs(fy - h);
      if (cap < 3.0 && prismMetric(q) < radius + (3.0 - cap) * 0.45) {
        vt = CRYSTAL;
      }
    }

    let archHeight = 12.0 + sin(clamp((spokeAlong - 10.0) / 33.0, 0.0, 1.0) * 3.1415926) * 31.0;
    if (spokeAlong > 8.0 && spokeAlong < 43.0 && spokeSide < 1.3 && abs(fy - archHeight) < 1.7) {
      vt = CRYSTAL;
    }

    if (spokeAlong > 14.0 && spokeAlong < 37.0 && spokeSide < 0.7 && fy > 10.0 && fy < archHeight) {
      let rib = fract(fy * 0.18 + spokeAlong * 0.09);
      if (rib < 0.12) { vt = RUNE; }
    }

    let coreRingA = abs(length(vec2f(p.x, p.z)) - 11.0);
    if (coreRingA < 1.3 && abs(p.y) < 1.5) {
      vt = METAL;
    }
    let coreRingB = abs(length(vec2f(p.x, p.y)) - 8.0);
    if (coreRingB < 1.0 && abs(p.z) < 1.3) {
      vt = METAL;
    }
    let coreRingC = abs(length(vec2f(p.z, p.y)) - 8.0);
    if (coreRingC < 1.0 && abs(p.x) < 1.3) {
      vt = METAL;
    }

    if (length(p) < 4.2) {
      vt = CORE;
    }

    if ((abs(p.x) < 1.0 && abs(p.z) < 1.0 && abs(p.y) < 18.0) ||
        (abs(p.x) < 18.0 && abs(p.z) < 0.8 && abs(p.y) < 0.8) ||
        (abs(p.z) < 18.0 && abs(p.x) < 0.8 && abs(p.y) < 0.8)) {
      vt = RUNE;
    }

    let cell = floor((vec3f(fx, fy, fz) + vec3f(64.0, params.seed, 64.0)) / 9.0);
    let rnd = hash13(cell);
    if (rnd > 0.955) {
      let center = cell * 9.0 + vec3f(
        hash13(cell + vec3f(1.0, 0.0, 0.0)) * 9.0,
        hash13(cell + vec3f(0.0, 1.0, 0.0)) * 9.0,
        hash13(cell + vec3f(0.0, 0.0, 1.0)) * 9.0
      ) - vec3f(64.0, 0.0, 64.0);
      let s = 1.5 + hash13(cell + vec3f(4.0)) * 3.0;
      let q = vec3f(fx, fy, fz) - center;
      if (abs(q.y) + prismMetric(q.xz) * 1.5 < s && radial > 18.0 && radial < 59.0 && fy > 10.0 && fy < 58.0) {
        vt = select(SHARD, CRYSTAL, hash13(cell + vec3f(7.0)) < 0.35);
      }
    }

    if (vt == AIR && radial < 50.0 && fy > 7.0 && fy < 54.0) {
      let gasBand = hash13(floor(vec3f(fx, fy * 0.7, fz) / 8.0) + vec3f(params.seed));
      if (gasBand > 0.985) { vt = GAS_SEED; }
    }

    voxels[idx(x, y, z)] = vt;
  }
}
