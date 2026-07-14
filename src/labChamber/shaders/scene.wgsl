struct Uniforms {
  resolution: vec2f,
  time: f32,
  _pad: f32,
};

@group(0) @binding(0) var<uniform> u: Uniforms;

const MAX_STEPS: i32 = 128;
const MAX_DIST: f32 = 60.0;
const SURF_DIST: f32 = 0.001;

const METAL_COL = vec3f(0.18, 0.18, 0.2);
const LIGHT_COL = vec3f(0.8, 0.9, 1.0);
const FLOOR_COL = vec3f(0.12, 0.12, 0.13);
const CABLE_COL = vec3f(0.08, 0.08, 0.09);
const BOX_COL   = vec3f(0.14, 0.14, 0.15);
const WALL_COL  = vec3f(0.48, 0.50, 0.52);
const TRIM_COL  = vec3f(0.24, 0.26, 0.28);

const MAT_NONE:  i32 = 0;
const MAT_METAL: i32 = 1;
const MAT_GLASS: i32 = 2;
const MAT_LIGHT: i32 = 3;
const MAT_FLOOR: i32 = 4;
const MAT_CABLE: i32 = 5;
const MAT_BOX:   i32 = 6;
const MAT_WALL:  i32 = 7;
const MAT_TRIM:  i32 = 8;

const CUBE_SZ: f32  = 2.0;
const STEP_H: f32    = 0.12;
const STEP_D: f32    = 0.15;
const FRAME_SZ: f32  = CUBE_SZ + STEP_D * 2.0;
const FRAME_R: f32   = 0.055;
const CHAMBER_BASE_Y: f32 = STEP_H * 2.0;
const CHAMBER_H: f32 = FRAME_SZ;
const CEIL_T: f32    = 0.12;
const GLASS_T: f32   = 0.018;
const GLASS_INSET: f32 = 0.012;
const FLOOR_HF: f32  = 1.8;
const FLOOR_T: f32   = 0.05;
const LT_GAP: f32    = 0.5;
const TOP_LIGHT_Y: f32 = 6.5;
const CABLE_RAD: f32 = 0.025;
const METAL_JOIN: f32 = 0.06;
const SHADOW_SOFTNESS: f32 = 7.0;
const SHADOW_FLOOR: f32 = 0.32;
const WALL_POS: f32 = -3.0;

// ── SDF primitives ──

fn sdBox(p: vec3f, b: vec3f) -> f32 {
  let q = abs(p) - b;
  return length(max(q, vec3f(0.0, 0.0, 0.0))) + min(max(q.x, max(q.y, q.z)), 0.0);
}

fn sdRoundBox(p: vec3f, b: vec3f, r: f32) -> f32 {
  let q = abs(p) - b + r;
  return length(max(q, vec3f(0.0, 0.0, 0.0))) + min(max(q.x, max(q.y, q.z)), 0.0) - r;
}

fn sdCapsule(a: vec3f, b: vec3f, r: f32, p: vec3f) -> f32 {
  let ab = b - a;
  let ap = p - a;
  let t = clamp(dot(ap, ab) / dot(ab, ab), 0.0, 1.0);
  let c = a + ab * t;
  return length(p - c) - r;
}

fn sMin(a: f32, b: f32, k: f32) -> f32 {
  let h = max(k - abs(a - b), 0.0) / k;
  return min(a, b) - h * h * k * 0.25;
}

// ── Scene SDFs ──

struct Hit { d: f32, m: i32, };

fn hMin(a: Hit, b: Hit) -> Hit {
  if (a.d < b.d) { return a; }
  return b;
}

fn sdPedestal(p: vec3f) -> f32 {
  let h = CUBE_SZ * 0.5;
  let s1 = sdBox(p - vec3f(0.0, STEP_H * 0.5, 0.0),
                 vec3f(h + STEP_D * 3.0, STEP_H * 0.5, h + STEP_D * 3.0));
  let s2 = sdBox(p - vec3f(0.0, STEP_H * 1.5, 0.0),
                 vec3f(h + STEP_D * 2.0, STEP_H * 0.5, h + STEP_D * 2.0));
  return min(s1, s2);
}

fn sdCubeFrame(p: vec3f) -> f32 {
  let h = FRAME_SZ * 0.5;
  let off = h - FRAME_R;
  let by = CHAMBER_BASE_Y;
  let cy = by + CHAMBER_H * 0.5;
  let edgeY = vec3f(FRAME_R, CHAMBER_H * 0.5, FRAME_R);
  let v1 = sdBox(p - vec3f( off, cy,  off), edgeY);
  let v2 = sdBox(p - vec3f(-off, cy,  off), edgeY);
  let v3 = sdBox(p - vec3f( off, cy, -off), edgeY);
  let v4 = sdBox(p - vec3f(-off, cy, -off), edgeY);

  let edgeX = vec3f(h, FRAME_R, FRAME_R);
  let edgeZ = vec3f(FRAME_R, FRAME_R, h);
  let bottomY = by + FRAME_R;
  let topY = by + CHAMBER_H - FRAME_R;
  let bottomFront = sdBox(p - vec3f(0.0, bottomY,  off), edgeX);
  let bottomBack  = sdBox(p - vec3f(0.0, bottomY, -off), edgeX);
  let bottomRight = sdBox(p - vec3f( off, bottomY, 0.0), edgeZ);
  let bottomLeft  = sdBox(p - vec3f(-off, bottomY, 0.0), edgeZ);
  let topFront = sdBox(p - vec3f(0.0, topY,  off), edgeX);
  let topBack  = sdBox(p - vec3f(0.0, topY, -off), edgeX);
  let topRight = sdBox(p - vec3f( off, topY, 0.0), edgeZ);
  let topLeft  = sdBox(p - vec3f(-off, topY, 0.0), edgeZ);

  let verticals = min(min(v1, v2), min(v3, v4));
  let bottom = min(min(bottomFront, bottomBack), min(bottomRight, bottomLeft));
  let top = min(min(topFront, topBack), min(topRight, topLeft));
  return min(verticals, min(bottom, top));
}

fn sdMetalFrame(p: vec3f) -> f32 {
  return sMin(sdPedestal(p), sdCubeFrame(p), METAL_JOIN);
}

fn sdCeiling(p: vec3f) -> f32 {
  let by = CHAMBER_BASE_Y + CHAMBER_H;
  return sdBox(vec3f(p.x, p.y - by - CEIL_T * 0.5, p.z),
               vec3f(FRAME_SZ * 0.5, CEIL_T * 0.5, FRAME_SZ * 0.5));
}

fn sdLights(p: vec3f) -> f32 {
  let by = CHAMBER_BASE_Y + CHAMBER_H - 0.005;
  let ls = vec3f(0.35, 0.02, 0.35);
  let d1 = sdBox(p - vec3f(-LT_GAP, by, -LT_GAP), ls);
  let d2 = sdBox(p - vec3f( LT_GAP, by, -LT_GAP), ls);
  let d3 = sdBox(p - vec3f(-LT_GAP, by,  LT_GAP), ls);
  let d4 = sdBox(p - vec3f( LT_GAP, by,  LT_GAP), ls);
  let ceilingLights = min(min(d1, d2), min(d3, d4));

  let backBar1 = sdBox(p - vec3f(-1.25, 3.0, WALL_POS + 0.09), vec3f(0.72, 0.045, 0.02));
  let backBar2 = sdBox(p - vec3f( 1.25, 3.0, WALL_POS + 0.09), vec3f(0.72, 0.045, 0.02));
  let sideBar1 = sdBox(p - vec3f(WALL_POS + 0.09, 3.0, -1.25), vec3f(0.02, 0.045, 0.72));
  let sideBar2 = sdBox(p - vec3f(WALL_POS + 0.09, 3.0,  1.25), vec3f(0.02, 0.045, 0.72));
  let wallLights = min(min(backBar1, backBar2), min(sideBar1, sideBar2));
  return min(ceilingLights, wallLights);
}

fn sdGlass(p: vec3f) -> f32 {
  let by = CHAMBER_BASE_Y + CHAMBER_H * 0.5;
  let h = FRAME_SZ * 0.5;
  let opening = h - FRAME_R * 2.0;
  let paneHalf = h - FRAME_R;
  let paneHalfY = CHAMBER_H * 0.5 - FRAME_R;
  // The pane surface sits behind the frame opening, while its edges tuck under it.
  let paneCenter = opening - GLASS_INSET - GLASS_T;
  let front = sdBox(p - vec3f(0.0, by, paneCenter), vec3f(paneHalf, paneHalfY, GLASS_T));
  let back  = sdBox(p - vec3f(0.0, by, -paneCenter), vec3f(paneHalf, paneHalfY, GLASS_T));
  let rt    = sdBox(p - vec3f(paneCenter, by, 0.0), vec3f(GLASS_T, paneHalfY, paneHalf));
  let lt    = sdBox(p - vec3f(-paneCenter, by, 0.0), vec3f(GLASS_T, paneHalfY, paneHalf));
  return min(min(front, back), min(rt, lt));
}

fn sdFloorPlate(p: vec3f) -> f32 {
  return sdBox(p - vec3f(0.0, -FLOOR_T * 0.5, 0.0),
               vec3f(FLOOR_HF, FLOOR_T * 0.5, FLOOR_HF));
}

fn sdLabWalls(p: vec3f) -> f32 {
  let back = sdBox(p - vec3f(0.0, 1.8, WALL_POS), vec3f(4.5, 1.8, 0.06));
  let side = sdBox(p - vec3f(WALL_POS, 1.8, 0.0), vec3f(0.06, 1.8, 4.5));
  return min(back, side);
}

fn sdWallTrim(p: vec3f) -> f32 {
  let backZ = WALL_POS + 0.075;
  let sideX = WALL_POS + 0.075;
  let vb1 = sdBox(p - vec3f(-1.5, 1.8, backZ), vec3f(0.012, 1.8, 0.015));
  let vb2 = sdBox(p - vec3f( 0.0, 1.8, backZ), vec3f(0.012, 1.8, 0.015));
  let vb3 = sdBox(p - vec3f( 1.5, 1.8, backZ), vec3f(0.012, 1.8, 0.015));
  let vs1 = sdBox(p - vec3f(sideX, 1.8, -1.5), vec3f(0.015, 1.8, 0.012));
  let vs2 = sdBox(p - vec3f(sideX, 1.8,  0.0), vec3f(0.015, 1.8, 0.012));
  let vs3 = sdBox(p - vec3f(sideX, 1.8,  1.5), vec3f(0.015, 1.8, 0.012));
  let hb1 = sdBox(p - vec3f(0.0, 1.2, backZ), vec3f(4.5, 0.012, 0.015));
  let hb2 = sdBox(p - vec3f(0.0, 2.4, backZ), vec3f(4.5, 0.012, 0.015));
  let hs1 = sdBox(p - vec3f(sideX, 1.2, 0.0), vec3f(0.015, 0.012, 4.5));
  let hs2 = sdBox(p - vec3f(sideX, 2.4, 0.0), vec3f(0.015, 0.012, 4.5));
  let verticals = min(min(min(vb1, vb2), vb3), min(min(vs1, vs2), vs3));
  let horizontals = min(min(hb1, hb2), min(hs1, hs2));
  return min(verticals, horizontals);
}

fn sdPSU(p: vec3f) -> f32 {
  let pos = vec3f(CUBE_SZ * 0.5 + STEP_D * 2.5, STEP_H + 0.2, CUBE_SZ * 0.3);
  return sdRoundBox(p - pos, vec3f(0.25, 0.2, 0.15), 0.02);
}

fn sdCables(p: vec3f) -> f32 {
  let bx = CUBE_SZ * 0.5 + STEP_D * 2.5;
  let by = STEP_H * 0.5;
  let bz = CUBE_SZ * 0.3;
  let fy = CABLE_RAD;

  let d1a = sdCapsule(vec3f(bx, by + 0.1, bz - 0.08), vec3f(bx + 0.3, fy, bz - 0.2), CABLE_RAD, p);
  let d1b = sdCapsule(vec3f(bx + 0.3, fy, bz - 0.2), vec3f(bx + 1.2, fy, bz - 0.6), CABLE_RAD, p);
  let d2a = sdCapsule(vec3f(bx, by + 0.1, bz), vec3f(bx + 0.4, fy, bz + 0.1), CABLE_RAD, p);
  let d2b = sdCapsule(vec3f(bx + 0.4, fy, bz + 0.1), vec3f(bx + 1.5, fy, bz + 0.3), CABLE_RAD, p);
  let d3a = sdCapsule(vec3f(bx, by + 0.1, bz + 0.08), vec3f(bx + 0.2, fy, bz + 0.4), CABLE_RAD, p);
  let d3b = sdCapsule(vec3f(bx + 0.2, fy, bz + 0.4), vec3f(bx + 1.0, fy, bz + 1.0), CABLE_RAD, p);
  return min(min(min(d1a, d1b), min(d2a, d2b)), min(d3a, d3b));
}

// ── Composed scene ──

fn mapOpaqueScene(p: vec3f) -> Hit {
  var r = Hit(sdFloorPlate(p), MAT_FLOOR);
  r = hMin(r, Hit(sdMetalFrame(p), MAT_METAL));
  r = hMin(r, Hit(sdCeiling(p), MAT_METAL));
  r = hMin(r, Hit(sdLights(p), MAT_LIGHT));
  r = hMin(r, Hit(sdLabWalls(p), MAT_WALL));
  r = hMin(r, Hit(sdWallTrim(p), MAT_TRIM));
  r = hMin(r, Hit(sdPSU(p), MAT_BOX));
  r = hMin(r, Hit(sdCables(p), MAT_CABLE));
  return r;
}

fn mapScene(p: vec3f) -> Hit {
  return hMin(mapOpaqueScene(p), Hit(sdGlass(p), MAT_GLASS));
}

fn mapD(p: vec3f) -> f32 { return mapScene(p).d; }

fn mapShadow(p: vec3f) -> f32 {
  var d = sdFloorPlate(p);
  d = min(d, sdPedestal(p));
  d = min(d, sdPSU(p));
  d = min(d, sdCables(p));
  return d;
}

fn mapOcclusion(p: vec3f) -> f32 {
  var d = sdFloorPlate(p);
  d = min(d, sdMetalFrame(p));
  d = min(d, sdLabWalls(p));
  d = min(d, sdWallTrim(p));
  d = min(d, sdPSU(p));
  d = min(d, sdCables(p));
  return d;
}

fn calcN(p: vec3f) -> vec3f {
  let e: f32 = 0.0005;
  return normalize(vec3f(
    mapD(p + vec3f(e, 0.0, 0.0)) - mapD(p - vec3f(e, 0.0, 0.0)),
    mapD(p + vec3f(0.0, e, 0.0)) - mapD(p - vec3f(0.0, e, 0.0)),
    mapD(p + vec3f(0.0, 0.0, e)) - mapD(p - vec3f(0.0, 0.0, e))));
}

fn calcOpaqueN(p: vec3f) -> vec3f {
  let e: f32 = 0.0005;
  return normalize(vec3f(
    mapOpaqueScene(p + vec3f(e, 0.0, 0.0)).d - mapOpaqueScene(p - vec3f(e, 0.0, 0.0)).d,
    mapOpaqueScene(p + vec3f(0.0, e, 0.0)).d - mapOpaqueScene(p - vec3f(0.0, e, 0.0)).d,
    mapOpaqueScene(p + vec3f(0.0, 0.0, e)).d - mapOpaqueScene(p - vec3f(0.0, 0.0, e)).d));
}

// ── Raymarching ──

fn march(ro: vec3f, rd: vec3f) -> Hit {
  var t: f32 = 0.0;
  var mat: i32 = MAT_NONE;
  for (var i: i32 = 0; i < MAX_STEPS; i = i + 1) {
    let h = mapScene(ro + rd * t);
    if (h.d < SURF_DIST) { mat = h.m; break; }
    if (t > MAX_DIST) { break; }
    t = t + h.d;
  }
  return Hit(t, mat);
}

fn marchOpaque(ro: vec3f, rd: vec3f) -> Hit {
  var t: f32 = 0.0;
  var mat: i32 = MAT_NONE;
  for (var i: i32 = 0; i < MAX_STEPS; i = i + 1) {
    let h = mapOpaqueScene(ro + rd * t);
    if (h.d < SURF_DIST) { mat = h.m; break; }
    if (t > MAX_DIST) { break; }
    t = t + h.d;
  }
  return Hit(t, mat);
}

// ── Soft shadow ──

fn softShadow(ro: vec3f, rd: vec3f, mint: f32, maxt: f32) -> f32 {
  var res: f32 = 1.0;
  var t: f32 = mint;
  for (var i: i32 = 0; i < 48; i = i + 1) {
    let h = mapShadow(ro + rd * t);
    if (h < 0.001) {
      res = 0.0;
      break;
    }
    res = min(res, SHADOW_SOFTNESS * h / max(t, 0.001));
    t = t + clamp(h, 0.01, 0.2);
    if (t > maxt) { break; }
  }
  let penumbra = smoothstep(0.0, 1.0, clamp(res, 0.0, 1.0));
  return mix(SHADOW_FLOOR, 1.0, penumbra);
}

// ── Ambient occlusion ──

fn calcAO(p: vec3f, n: vec3f) -> f32 {
  var occ: f32 = 0.0;
  var sca: f32 = 1.0;
  for (var i: i32 = 0; i < 5; i = i + 1) {
    let h = 0.01 + 0.12 * f32(i);
    occ = occ + (h - mapOcclusion(p + n * h)) * sca;
    sca = sca * 0.95;
  }
  return clamp(1.0 - 0.85 * occ, 0.55, 1.0);
}

// ── Lighting from 4 panel lights and an overhead light ──

fn lightAt(p: vec3f, n: vec3f, lp: vec3f) -> vec3f {
  let L = lp - p;
  let dist = length(L);
  let Ln = L / dist;
  let NdL = max(dot(n, Ln), 0.0);
  let att = 1.0 / (1.0 + 0.25 * dist * dist);
  let sh = softShadow(p + n * 0.015, Ln, 0.03, dist);
  return LIGHT_COL * NdL * att * sh * 2.0;
}

fn lighting(p: vec3f, n: vec3f) -> vec3f {
  let by = CHAMBER_BASE_Y + CHAMBER_H - 0.03;
  return lightAt(p, n, vec3f(-LT_GAP, by, -LT_GAP))
       + lightAt(p, n, vec3f( LT_GAP, by, -LT_GAP))
       + lightAt(p, n, vec3f(-LT_GAP, by,  LT_GAP))
       + lightAt(p, n, vec3f( LT_GAP, by,  LT_GAP))
       + lightAt(p, n, vec3f(0.0, TOP_LIGHT_Y, 0.0)) * 2.2
       + vec3f(0.07, 0.08, 0.09);
}

// ── Material shading ──

fn shade(p: vec3f, n: vec3f, rd: vec3f, mat: i32) -> vec3f {
  let ao = calcAO(p, n);
  let li = lighting(p, n);
  if (mat == MAT_METAL) {
    let viewRef = reflect(rd, n);
    let sp = pow(max(dot(viewRef, normalize(vec3f(0.5, 1.0, 0.5))), 0.0), 24.0);
    return METAL_COL * li * ao + vec3f(sp * 0.2, sp * 0.2, sp * 0.2);
  }
  if (mat == MAT_FLOOR) { return FLOOR_COL * li * ao; }
  if (mat == MAT_LIGHT) { return LIGHT_COL * 5.0; }
  if (mat == MAT_CABLE) { return CABLE_COL * li * ao; }
  if (mat == MAT_BOX)   { return BOX_COL * li * ao; }
  if (mat == MAT_WALL)  { return WALL_COL * li * mix(0.85, 1.0, ao); }
  if (mat == MAT_TRIM)  { return TRIM_COL * li * mix(0.9, 1.0, ao); }
  return vec3f(0.1, 0.1, 0.1) * li * ao;
}

// ── Stylized glass ──

fn shadeGlass(p: vec3f, n: vec3f, rd: vec3f) -> vec3f {
  let cosT = max(dot(-rd, n), 0.0);
  let edge = pow(1.0 - cosT, 1.5);

  // The camera looks from +X/+Z: tint the near panes and clear the far panes.
  var panelDepth = p.z;
  if (abs(p.x) > abs(p.z)) { panelDepth = p.x; }
  let nearPane = smoothstep(-0.4, 0.4, panelDepth);

  // Trace only opaque geometry so the glass can never intersect itself.
  let tro = p + rd * 0.01;
  let th = marchOpaque(tro, rd);
  var transCol = labBackground(rd);
  if (th.m != MAT_NONE && th.d < MAX_DIST) {
    let tp = tro + rd * th.d;
    transCol = shade(tp, calcOpaqueN(tp), rd, th.m);
  }

  let transmissionTint = mix(vec3f(0.99, 1.0, 1.02), vec3f(0.91, 0.98, 1.12), nearPane);
  let clearTransmission = transCol * transmissionTint;
  let glassTint = mix(vec3f(0.10, 0.24, 0.34), vec3f(0.04, 0.30, 0.62), nearPane);
  let glassColor = glassTint * (0.45 + edge * 0.55);
  let baseOpacity = mix(0.025, 0.12, nearPane);
  let edgeOpacity = mix(0.06, 0.22, nearPane);
  let glassOpacity = baseOpacity + edge * edgeOpacity;
  return mix(clearTransmission, glassColor, glassOpacity);
}

// ── Tone mapping ──

fn aces(x: vec3f) -> vec3f {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14),
               vec3f(0.0, 0.0, 0.0), vec3f(1.0, 1.0, 1.0));
}

fn labBackground(rd: vec3f) -> vec3f {
  let gradient = smoothstep(-0.35, 0.55, rd.y);
  let lower = vec3f(0.22, 0.235, 0.25);
  let upper = vec3f(0.38, 0.40, 0.42);
  return mix(lower, upper, gradient);
}

// ── Entry ──

@fragment fn fs(@location(0) vuv: vec2f) -> @location(0) vec4f {
  let aspect = u.resolution.x / u.resolution.y;
  let px = (vuv.x - 0.5) * aspect;
  let py = 0.5 - vuv.y;

  let camTarget = vec3f(0.0, CHAMBER_BASE_Y + CHAMBER_H * 0.4, 0.0);
  let ro = vec3f(6.0, 4.6, 6.0);
  let fwd = normalize(camTarget - ro);
  let rt = normalize(cross(fwd, vec3f(0.0, 1.0, 0.0)));
  let up = cross(rt, fwd);
  let rd = normalize(fwd * 1.8 + rt * px + up * py);

  let hit = march(ro, rd);
  let bg = labBackground(rd);
  var col = bg;

  if (hit.m != MAT_NONE && hit.d < MAX_DIST) {
    let p = ro + rd * hit.d;
    let n = calcN(p);
    if (hit.m == MAT_GLASS) {
      col = shadeGlass(p, n, rd);
    } else {
      col = shade(p, n, rd, hit.m);
    }
    let fog = 1.0 - exp(-hit.d * hit.d * 0.003);
    col = mix(col, bg, fog);
  }

  col = aces(col);
  col = pow(col, vec3f(1.0 / 2.2, 1.0 / 2.2, 1.0 / 2.2));
  return vec4f(col, 1.0);
}
