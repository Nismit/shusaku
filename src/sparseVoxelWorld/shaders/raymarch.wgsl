const GRID_X: u32 = 128u;
const GRID_Y: u32 = 64u;
const GRID_Z: u32 = 128u;
const GRID_XF: f32 = 128.0;
const GRID_YF: f32 = 64.0;
const GRID_ZF: f32 = 128.0;
const HALF_X: f32 = 64.0;
const HALF_Z: f32 = 64.0;
const MAX_STEPS: i32 = 384;

const AIR: u32 = 0u;
const CRYSTAL: u32 = 1u;
const DARK_CRYSTAL: u32 = 2u;
const METAL: u32 = 3u;
const CORE: u32 = 4u;
const GAS_SEED: u32 = 5u;
const RUNE: u32 = 6u;
const SHARD: u32 = 7u;

struct Params {
  resolution: vec2f,
  time: f32,
  camYaw: f32,
  camPitch: f32,
  camDist: f32,
  waterLevel: f32,
  fogDensity: f32,
  sunDir: vec3f,
  aoStrength: f32,
};

@group(0) @binding(0) var<uniform> u: Params;
@group(0) @binding(1) var<storage, read> voxels: array<u32>;

fn getVoxel(x: i32, y: i32, z: i32) -> u32 {
  if (x < 0 || x >= i32(GRID_X) || y < 0 || y >= i32(GRID_Y) || z < 0 || z >= i32(GRID_Z)) {
    return AIR;
  }
  return voxels[u32(x) + u32(y) * GRID_X + u32(z) * GRID_X * GRID_Y];
}

fn worldToGrid(p: vec3f) -> vec3f {
  return vec3f(p.x + HALF_X, p.y, p.z + HALF_Z);
}

fn isOccluder(x: i32, y: i32, z: i32) -> f32 {
  return select(0.0, 1.0, getVoxel(x, y, z) != AIR);
}

fn getColor(vt: u32, n: vec3f, cell: vec3i) -> vec3f {
  let posHash = fract(sin(dot(vec2f(f32(cell.x), f32(cell.z)), vec2f(12.9898, 78.233))) * 43758.5453);
  let variation = 0.86 + 0.28 * posHash;
  switch (vt) {
    case CRYSTAL: {
      let facing = pow(1.0 - abs(dot(n, normalize(vec3f(0.35, 0.7, 0.2)))), 2.0);
      return mix(vec3f(0.20, 0.60, 0.92), vec3f(0.86, 0.97, 1.0), facing) * variation;
    }
    case DARK_CRYSTAL: { return vec3f(0.14, 0.18, 0.34) * variation; }
    case METAL: { return mix(vec3f(0.25, 0.27, 0.29), vec3f(0.67, 0.62, 0.52), posHash) * variation; }
    case CORE: { return vec3f(1.0, 0.55, 0.22) * variation; }
    case GAS_SEED: { return vec3f(0.15, 0.42, 0.72) * variation; }
    case RUNE: { return vec3f(0.35, 0.95, 1.0) * variation; }
    case SHARD: { return vec3f(0.75, 0.40, 1.0) * variation; }
    default: { return vec3f(1.0, 0.0, 1.0); }
  }
}

fn getEmission(vt: u32, cell: vec3i) -> vec3f {
  let h = fract(sin(dot(vec3f(f32(cell.x), f32(cell.y), f32(cell.z)), vec3f(17.1, 31.7, 67.3))) * 43758.5453);
  switch (vt) {
    case CORE: { return vec3f(4.5, 1.6, 0.45) * (0.8 + 0.2 * sin(u.time * 2.4)); }
    case RUNE: { return vec3f(0.2, 1.8, 2.4) * (0.75 + 0.25 * sin(u.time * 3.0 + h * 6.28)); }
    case SHARD: { return vec3f(0.8, 0.25, 1.5) * 0.45; }
    case GAS_SEED: { return vec3f(0.1, 0.55, 1.2) * 0.8; }
    default: { return vec3f(0.0); }
  }
}

fn calcAO(cell: vec3i, normal: vec3f) -> f32 {
  let ni = vec3i(i32(round(normal.x)), i32(round(normal.y)), i32(round(normal.z)));
  let base = cell + ni;

  var t1: vec3i;
  var t2: vec3i;
  if (ni.x != 0) { t1 = vec3i(0, 1, 0); t2 = vec3i(0, 0, 1); }
  else if (ni.y != 0) { t1 = vec3i(1, 0, 0); t2 = vec3i(0, 0, 1); }
  else { t1 = vec3i(1, 0, 0); t2 = vec3i(0, 1, 0); }

  let e1 = isOccluder(base.x + t1.x, base.y + t1.y, base.z + t1.z);
  let e2 = isOccluder(base.x - t1.x, base.y - t1.y, base.z - t1.z);
  let e3 = isOccluder(base.x + t2.x, base.y + t2.y, base.z + t2.z);
  let e4 = isOccluder(base.x - t2.x, base.y - t2.y, base.z - t2.z);
  let c1 = isOccluder(base.x + t1.x + t2.x, base.y + t1.y + t2.y, base.z + t1.z + t2.z);
  let c2 = isOccluder(base.x - t1.x + t2.x, base.y - t1.y + t2.y, base.z - t1.z + t2.z);
  let c3 = isOccluder(base.x + t1.x - t2.x, base.y + t1.y - t2.y, base.z + t1.z - t2.z);
  let c4 = isOccluder(base.x - t1.x - t2.x, base.y - t1.y - t2.y, base.z - t1.z - t2.z);

  let occ = (e1 + e2 + e3 + e4) * 0.18 + (c1 + c2 + c3 + c4) * 0.10;
  return 1.0 - occ * u.aoStrength;
}

fn edgeDarken(hitPos: vec3f, cell: vec3i, normal: vec3f) -> f32 {
  let f = hitPos - vec3f(f32(cell.x), f32(cell.y), f32(cell.z));
  var uv: vec2f;
  if (abs(normal.x) > 0.5) { uv = vec2f(f.y, f.z); }
  else if (abs(normal.y) > 0.5) { uv = vec2f(f.x, f.z); }
  else { uv = vec2f(f.x, f.y); }
  let d = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
  return 0.90 + 0.10 * smoothstep(0.0, 0.12, d);
}

fn skyColor(rd: vec3f) -> vec3f {
  if (rd.y >= 0.0) {
    let t = pow(rd.y, 0.7);
    var sky = mix(vec3f(0.015, 0.018, 0.035), vec3f(0.05, 0.08, 0.16), t);
    let sunDot = max(dot(rd, u.sunDir), 0.0);
    sky += vec3f(0.5, 0.35, 0.8) * pow(sunDot, 96.0);
    sky += vec3f(0.05, 0.08, 0.12) * exp(-rd.y * 5.0);
    return sky;
  }
  return mix(vec3f(0.012, 0.014, 0.025), vec3f(0.035, 0.028, 0.055), pow(-rd.y, 0.5));
}

fn hash31(p: vec3f) -> f32 {
  return fract(sin(dot(p, vec3f(17.31, 59.17, 113.91))) * 43758.5453);
}

fn noise3(p: vec3f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let w = f * f * (3.0 - 2.0 * f);
  let x00 = mix(hash31(i), hash31(i + vec3f(1.0, 0.0, 0.0)), w.x);
  let x10 = mix(hash31(i + vec3f(0.0, 1.0, 0.0)), hash31(i + vec3f(1.0, 1.0, 0.0)), w.x);
  let x01 = mix(hash31(i + vec3f(0.0, 0.0, 1.0)), hash31(i + vec3f(1.0, 0.0, 1.0)), w.x);
  let x11 = mix(hash31(i + vec3f(0.0, 1.0, 1.0)), hash31(i + vec3f(1.0, 1.0, 1.0)), w.x);
  return mix(mix(x00, x10, w.y), mix(x01, x11, w.y), w.z);
}

fn nebulaDensity(p: vec3f) -> f32 {
  let centered = p - vec3f(HALF_X, 30.0, HALF_Z);
  let r = length(centered.xz);
  let core = exp(-length(centered) * 0.045);
  let ring = exp(-abs(r - 28.0) * 0.12) * smoothstep(5.0, 18.0, centered.y + 22.0) * smoothstep(28.0, 6.0, centered.y);
  let n = noise3(p * 0.045 + vec3f(u.time * 0.018, 0.0, -u.time * 0.012));
  let n2 = noise3(p * 0.095 + vec3f(4.0, u.time * 0.015, 8.0));
  return max(0.0, (core * 0.9 + ring * 0.65) * smoothstep(0.28, 0.86, n * 0.7 + n2 * 0.3));
}

fn integrateNebula(ro: vec3f, rd: vec3f, maxT: f32) -> vec4f {
  var color = vec3f(0.0);
  var alpha = 0.0;
  let steps = 26;
  let span = min(maxT, 150.0);
  let stepLen = span / f32(steps);
  let jitter = hash31(vec3f(ro.xy, u.time)) * stepLen;

  for (var i = 0; i < steps; i++) {
    let t = f32(i) * stepLen + jitter;
    let p = ro + rd * t;
    if (p.x < 0.0 || p.x >= GRID_XF || p.y < 0.0 || p.y >= GRID_YF || p.z < 0.0 || p.z >= GRID_ZF) {
      continue;
    }
    let d = nebulaDensity(p) * 0.09;
    let centered = p - vec3f(HALF_X, 30.0, HALF_Z);
    let heat = exp(-length(centered) * 0.06);
    let gasColor = mix(vec3f(0.08, 0.35, 0.90), vec3f(1.0, 0.34, 0.12), heat);
    let a = d * stepLen * (1.0 - alpha);
    color += gasColor * a * (0.7 + heat * 2.7);
    alpha += a;
    if (alpha > 0.92) { break; }
  }

  return vec4f(color, clamp(alpha, 0.0, 0.95));
}

struct Hit {
  found: bool,
  t: f32,
  normal: vec3f,
  cell: vec3i,
  voxelType: u32,
};

fn march(ro: vec3f, rd: vec3f) -> Hit {
  var result: Hit;
  result.found = false;

  let invDir = 1.0 / rd;
  let boxMin = vec3f(0.0);
  let boxMax = vec3f(GRID_XF, GRID_YF, GRID_ZF);
  let t1 = (boxMin - ro) * invDir;
  let t2 = (boxMax - ro) * invDir;
  let tmin = min(t1, t2);
  let tmax = max(t1, t2);
  let tNear = max(max(tmin.x, tmin.y), tmin.z);
  let tFar = min(min(tmax.x, tmax.y), tmax.z);

  if (tNear > tFar) { return result; }

  let tStart = max(tNear, 0.0) + 0.001;
  let entryPos = ro + rd * tStart;

  var cell = clamp(
    vec3i(floor(entryPos)),
    vec3i(0),
    vec3i(i32(GRID_X) - 1, i32(GRID_Y) - 1, i32(GRID_Z) - 1)
  );

  let stepDir = vec3i(
    select(-1, 1, rd.x >= 0.0),
    select(-1, 1, rd.y >= 0.0),
    select(-1, 1, rd.z >= 0.0)
  );

  let tDelta = abs(1.0 / rd);

  var tMax = vec3f(1e30);
  if (rd.x > 0.0) { tMax.x = tStart + (f32(cell.x + 1) - entryPos.x) / rd.x; }
  else if (rd.x < 0.0) { tMax.x = tStart + (f32(cell.x) - entryPos.x) / rd.x; }
  if (rd.y > 0.0) { tMax.y = tStart + (f32(cell.y + 1) - entryPos.y) / rd.y; }
  else if (rd.y < 0.0) { tMax.y = tStart + (f32(cell.y) - entryPos.y) / rd.y; }
  if (rd.z > 0.0) { tMax.z = tStart + (f32(cell.z + 1) - entryPos.z) / rd.z; }
  else if (rd.z < 0.0) { tMax.z = tStart + (f32(cell.z) - entryPos.z) / rd.z; }

  var normal = vec3f(0.0);
  if (tmin.x >= tmin.y && tmin.x >= tmin.z) {
    normal = vec3f(-f32(stepDir.x), 0.0, 0.0);
  } else if (tmin.y >= tmin.z) {
    normal = vec3f(0.0, -f32(stepDir.y), 0.0);
  } else {
    normal = vec3f(0.0, 0.0, -f32(stepDir.z));
  }

  var t = tStart;

  for (var i = 0; i < MAX_STEPS; i++) {
    if (cell.x < 0 || cell.x >= i32(GRID_X) ||
        cell.y < 0 || cell.y >= i32(GRID_Y) ||
        cell.z < 0 || cell.z >= i32(GRID_Z)) {
      break;
    }

    let v = voxels[u32(cell.x) + u32(cell.y) * GRID_X + u32(cell.z) * GRID_X * GRID_Y];
    if (v != AIR) {
      result.found = true;
      result.t = t;
      result.normal = normal;
      result.cell = cell;
      result.voxelType = v;
      return result;
    }

    if (tMax.x < tMax.y) {
      if (tMax.x < tMax.z) {
        t = tMax.x;
        tMax.x += tDelta.x;
        cell.x += stepDir.x;
        normal = vec3f(-f32(stepDir.x), 0.0, 0.0);
      } else {
        t = tMax.z;
        tMax.z += tDelta.z;
        cell.z += stepDir.z;
        normal = vec3f(0.0, 0.0, -f32(stepDir.z));
      }
    } else {
      if (tMax.y < tMax.z) {
        t = tMax.y;
        tMax.y += tDelta.y;
        cell.y += stepDir.y;
        normal = vec3f(0.0, -f32(stepDir.y), 0.0);
      } else {
        t = tMax.z;
        tMax.z += tDelta.z;
        cell.z += stepDir.z;
        normal = vec3f(0.0, 0.0, -f32(stepDir.z));
      }
    }
  }

  return result;
}

@fragment
fn fs(@builtin(position) fragCoord: vec4f, @location(0) texCoord: vec2f) -> @location(0) vec4f {
  var uv = (fragCoord.xy - u.resolution * 0.5) / u.resolution.y;
  uv.y = -uv.y;

  let center = vec3f(0.0, 30.0, 0.0);
  let camPos = center + vec3f(
    u.camDist * cos(u.camPitch) * sin(u.camYaw),
    u.camDist * sin(u.camPitch),
    u.camDist * cos(u.camPitch) * cos(u.camYaw)
  );

  let forward = normalize(center - camPos);
  let right = normalize(cross(forward, vec3f(0.0, 1.0, 0.0)));
  let up = cross(right, forward);
  let fov = 0.72;
  let rd = normalize(forward + uv.x * right * fov + uv.y * up * fov);

  let gridRo = worldToGrid(camPos);
  let hit = march(gridRo, rd);

  let surfaceT = select(150.0, hit.t, hit.found);
  let nebula = integrateNebula(gridRo, rd, surfaceT);
  var col = skyColor(rd);

  if (hit.found) {
    let hitPos = gridRo + rd * hit.t;
    var baseColor = getColor(hit.voxelType, hit.normal, hit.cell);

    let NdotL = max(dot(hit.normal, u.sunDir), 0.0);
    let rim = pow(1.0 - max(dot(-rd, hit.normal), 0.0), 3.0);
    let lighting = 0.18 + NdotL * 0.55 + rim * 0.5;

    let ao = calcAO(hit.cell, hit.normal);
    let edge = edgeDarken(hitPos, hit.cell, hit.normal);
    let emission = getEmission(hit.voxelType, hit.cell);

    col = baseColor * lighting * ao * edge + emission;

    let fog = exp(-hit.t * u.fogDensity);
    col = mix(skyColor(rd), col, fog);
  }

  col = col * (1.0 - nebula.a) + nebula.rgb;

  col = col / (col + vec3f(1.0));
  col = pow(col, vec3f(1.0 / 2.2));

  return vec4f(col, 1.0);
}
