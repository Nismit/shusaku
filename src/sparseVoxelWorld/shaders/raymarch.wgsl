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
  let variation = 0.90 + 0.20 * posHash;
  switch (vt) {
    case 1u: {
      let green = vec3f(0.30, 0.55, 0.18);
      let side = vec3f(0.38, 0.30, 0.16);
      return mix(side, green, step(0.5, n.y)) * variation;
    }
    case 2u: { return vec3f(0.48, 0.32, 0.18) * variation; }
    case 3u: { return vec3f(0.45, 0.45, 0.48) * variation; }
    case 4u: { return vec3f(0.94, 0.95, 0.98) * variation; }
    case 5u: { return vec3f(0.85, 0.76, 0.52) * variation; }
    case 6u: { return vec3f(0.42, 0.28, 0.15) * variation; }
    case 7u: { return vec3f(0.18, 0.42, 0.12) * variation; }
    default: { return vec3f(1.0, 0.0, 1.0); }
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
    var sky = mix(vec3f(0.70, 0.80, 0.90), vec3f(0.25, 0.45, 0.75), t);
    let sunDot = max(dot(rd, u.sunDir), 0.0);
    sky += vec3f(1.5, 1.3, 0.9) * pow(sunDot, 256.0);
    sky += vec3f(0.4, 0.3, 0.15) * pow(sunDot, 8.0);
    sky += vec3f(0.2, 0.2, 0.18) * exp(-rd.y * 8.0);
    return sky;
  }
  return mix(vec3f(0.70, 0.80, 0.90), vec3f(0.35, 0.38, 0.33), pow(-rd.y, 0.5));
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

  let center = vec3f(0.0, 24.0, 0.0);
  let camPos = center + vec3f(
    u.camDist * cos(u.camPitch) * sin(u.camYaw),
    u.camDist * sin(u.camPitch),
    u.camDist * cos(u.camPitch) * cos(u.camYaw)
  );

  let forward = normalize(center - camPos);
  let right = normalize(cross(forward, vec3f(0.0, 1.0, 0.0)));
  let up = cross(right, forward);
  let fov = 0.8;
  let rd = normalize(forward + uv.x * right * fov + uv.y * up * fov);

  let gridRo = worldToGrid(camPos);
  let hit = march(gridRo, rd);

  var waterT = 1e30;
  if (abs(rd.y) > 1e-6) {
    let tw = (u.waterLevel - gridRo.y) / rd.y;
    if (tw > 0.001) {
      let wp = gridRo + rd * tw;
      if (wp.x >= 0.0 && wp.x < GRID_XF && wp.z >= 0.0 && wp.z < GRID_ZF) {
        waterT = tw;
      }
    }
  }

  let useWater = waterT < 1e29 && (!hit.found || waterT < hit.t);
  var col = vec3f(0.0);

  if (useWater) {
    let waterPos = gridRo + rd * waterT;

    var waterCol = vec3f(0.15, 0.32, 0.50);
    if (hit.found && hit.t > waterT) {
      let underwaterDist = (hit.t - waterT) * 0.08;
      let terrainCol = getColor(hit.voxelType, hit.normal, hit.cell);
      waterCol = mix(terrainCol * 0.45, vec3f(0.08, 0.18, 0.32), min(underwaterDist, 1.0));
    }

    let fresnel = pow(1.0 - abs(rd.y), 4.0);
    let reflDir = vec3f(rd.x, abs(rd.y), rd.z);
    waterCol = mix(waterCol, skyColor(reflDir) * 0.8, fresnel * 0.55);

    let halfVec = normalize(u.sunDir - rd);
    let spec = pow(max(dot(vec3f(0.0, 1.0, 0.0), halfVec), 0.0), 128.0);
    waterCol += vec3f(1.0, 0.95, 0.80) * spec * 0.7;

    let ripple = sin(waterPos.x * 2.0 + u.time * 1.5) * sin(waterPos.z * 2.3 + u.time * 1.2) * 0.02;
    waterCol += vec3f(ripple);

    col = waterCol;
    let fog = exp(-waterT * u.fogDensity);
    col = mix(skyColor(rd), col, fog);
  } else if (hit.found) {
    let hitPos = gridRo + rd * hit.t;
    var baseColor = getColor(hit.voxelType, hit.normal, hit.cell);

    let NdotL = max(dot(hit.normal, u.sunDir), 0.0);
    let lighting = 0.35 + NdotL * 0.65;

    let ao = calcAO(hit.cell, hit.normal);
    let edge = edgeDarken(hitPos, hit.cell, hit.normal);

    col = baseColor * lighting * ao * edge;

    let fog = exp(-hit.t * u.fogDensity);
    col = mix(skyColor(rd), col, fog);
  } else {
    col = skyColor(rd);
  }

  col = col / (col + vec3f(1.0));
  col = pow(col, vec3f(1.0 / 2.2));

  return vec4f(col, 1.0);
}
