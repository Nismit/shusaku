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

const MAT_NONE:  i32 = 0;
const MAT_METAL: i32 = 1;
const MAT_GLASS: i32 = 2;
const MAT_LIGHT: i32 = 3;
const MAT_FLOOR: i32 = 4;
const MAT_CABLE: i32 = 5;
const MAT_BOX:   i32 = 6;

const CUBE_SZ: f32  = 2.0;
const PILLAR_R: f32  = 0.08;
const PILLAR_H: f32  = 2.0;
const CEIL_T: f32    = 0.12;
const GLASS_T: f32   = 0.04;
const STEP_H: f32    = 0.12;
const STEP_D: f32    = 0.15;
const FLOOR_HF: f32  = 1.8;
const FLOOR_T: f32   = 0.05;
const LT_GAP: f32    = 0.5;
const CABLE_RAD: f32 = 0.025;

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
  let s3 = sdBox(p - vec3f(0.0, STEP_H * 2.5, 0.0),
                 vec3f(h + STEP_D, STEP_H * 0.5, h + STEP_D));
  return min(s1, min(s2, s3));
}

fn sdPillars(p: vec3f) -> f32 {
  let off = CUBE_SZ * 0.5 - PILLAR_R;
  let by = STEP_H * 3.0;
  let py = p.y - by - PILLAR_H * 0.5;
  let pr = vec3f(PILLAR_R, PILLAR_H * 0.5, PILLAR_R);
  let d1 = sdBox(vec3f(p.x - off, py, p.z - off), pr);
  let d2 = sdBox(vec3f(p.x + off, py, p.z - off), pr);
  let d3 = sdBox(vec3f(p.x - off, py, p.z + off), pr);
  let d4 = sdBox(vec3f(p.x + off, py, p.z + off), pr);
  return min(min(d1, d2), min(d3, d4));
}

fn sdCeiling(p: vec3f) -> f32 {
  let by = STEP_H * 3.0 + PILLAR_H;
  return sdBox(vec3f(p.x, p.y - by - CEIL_T * 0.5, p.z),
               vec3f(CUBE_SZ * 0.5, CEIL_T * 0.5, CUBE_SZ * 0.5));
}

fn sdLights(p: vec3f) -> f32 {
  let by = STEP_H * 3.0 + PILLAR_H - 0.005;
  let ls = vec3f(0.35, 0.02, 0.35);
  let d1 = sdBox(p - vec3f(-LT_GAP, by, -LT_GAP), ls);
  let d2 = sdBox(p - vec3f( LT_GAP, by, -LT_GAP), ls);
  let d3 = sdBox(p - vec3f(-LT_GAP, by,  LT_GAP), ls);
  let d4 = sdBox(p - vec3f( LT_GAP, by,  LT_GAP), ls);
  return min(min(d1, d2), min(d3, d4));
}

fn sdGlass(p: vec3f) -> f32 {
  let by = STEP_H * 3.0 + PILLAR_H * 0.5;
  let h = CUBE_SZ * 0.5;
  let wh = PILLAR_H * 0.5;
  let po = PILLAR_R;
  let front = sdBox(p - vec3f(0.0, by, h), vec3f(h - po, wh, GLASS_T));
  let back  = sdBox(p - vec3f(0.0, by, -h), vec3f(h - po, wh, GLASS_T));
  let rt    = sdBox(p - vec3f(h, by, 0.0), vec3f(GLASS_T, wh, h - po));
  let lt    = sdBox(p - vec3f(-h, by, 0.0), vec3f(GLASS_T, wh, h - po));
  return min(min(front, back), min(rt, lt));
}

fn sdFloorPlate(p: vec3f) -> f32 {
  return sdBox(p - vec3f(0.0, -FLOOR_T * 0.5, 0.0),
               vec3f(FLOOR_HF, FLOOR_T * 0.5, FLOOR_HF));
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

fn mapScene(p: vec3f) -> Hit {
  var r = Hit(sdFloorPlate(p), MAT_FLOOR);
  r = hMin(r, Hit(sdPedestal(p), MAT_METAL));
  r = hMin(r, Hit(sdPillars(p), MAT_METAL));
  r = hMin(r, Hit(sdCeiling(p), MAT_METAL));
  r = hMin(r, Hit(sdLights(p), MAT_LIGHT));
  r = hMin(r, Hit(sdGlass(p), MAT_GLASS));
  r = hMin(r, Hit(sdPSU(p), MAT_BOX));
  r = hMin(r, Hit(sdCables(p), MAT_CABLE));
  return r;
}

fn mapD(p: vec3f) -> f32 { return mapScene(p).d; }

fn mapShadow(p: vec3f) -> f32 {
  var d = sdFloorPlate(p);
  d = min(d, sdPedestal(p));
  d = min(d, sdPillars(p));
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

// ── Soft shadow ──

fn softSh(ro: vec3f, rd: vec3f, mint: f32, maxt: f32, k: f32) -> f32 {
  var res: f32 = 1.0;
  var t: f32 = mint;
  for (var i: i32 = 0; i < 48; i = i + 1) {
    let h = mapShadow(ro + rd * t);
    if (h < 0.001) { return 0.0; }
    res = min(res, k * h / t);
    t = t + clamp(h, 0.01, 0.2);
    if (t > maxt) { break; }
  }
  return clamp(res, 0.0, 1.0);
}

// ── Ambient occlusion ──

fn calcAO(p: vec3f, n: vec3f) -> f32 {
  var occ: f32 = 0.0;
  var sca: f32 = 1.0;
  for (var i: i32 = 0; i < 5; i = i + 1) {
    let h = 0.01 + 0.12 * f32(i);
    occ = occ + (h - mapShadow(p + n * h)) * sca;
    sca = sca * 0.95;
  }
  return clamp(1.0 - 3.0 * occ, 0.0, 1.0);
}

// ── Fresnel ──

fn fresnelSchlick(cosT: f32, f0: f32) -> f32 {
  return f0 + (1.0 - f0) * pow(1.0 - cosT, 5.0);
}

// ── Lighting from 4 panel lights ──

fn lightAt(p: vec3f, n: vec3f, lp: vec3f) -> vec3f {
  let L = lp - p;
  let dist = length(L);
  let Ln = L / dist;
  let NdL = max(dot(n, Ln), 0.0);
  let att = 1.0 / (1.0 + 0.25 * dist * dist);
  let sh = softSh(p + n * 0.01, Ln, 0.02, dist, 16.0);
  return LIGHT_COL * NdL * att * sh * 2.0;
}

fn lighting(p: vec3f, n: vec3f) -> vec3f {
  let by = STEP_H * 3.0 + PILLAR_H - 0.03;
  return lightAt(p, n, vec3f(-LT_GAP, by, -LT_GAP))
       + lightAt(p, n, vec3f( LT_GAP, by, -LT_GAP))
       + lightAt(p, n, vec3f(-LT_GAP, by,  LT_GAP))
       + lightAt(p, n, vec3f( LT_GAP, by,  LT_GAP))
       + vec3f(0.04, 0.05, 0.06);
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
  return vec3f(0.1, 0.1, 0.1) * li * ao;
}

// ── Glass with Fresnel ──

fn shadeGlass(p: vec3f, n: vec3f, rd: vec3f) -> vec3f {
  let cosT = max(dot(-rd, n), 0.0);
  let fr = fresnelSchlick(cosT, 0.04);

  // Reflection
  let reflDir = reflect(rd, n);
  let rh = march(p + n * 0.02, reflDir);
  var reflCol = vec3f(0.0, 0.0, 0.0);
  if (rh.m != MAT_NONE && rh.d < MAX_DIST) {
    let rp = p + n * 0.02 + reflDir * rh.d;
    reflCol = shade(rp, calcN(rp), reflDir, rh.m);
  }

  // Transmission (straight through thin glass)
  let th = march(p - n * 0.1, rd);
  var transCol = vec3f(0.0, 0.0, 0.0);
  if (th.m != MAT_NONE && th.d < MAX_DIST) {
    let tp = p - n * 0.1 + rd * th.d;
    let tn = calcN(tp);
    if (th.m == MAT_GLASS) {
      // hit the opposite glass wall, continue through
      let th2 = march(tp - tn * 0.1, rd);
      if (th2.m != MAT_NONE && th2.d < MAX_DIST) {
        let tp2 = tp - tn * 0.1 + rd * th2.d;
        transCol = shade(tp2, calcN(tp2), rd, th2.m);
      }
    } else {
      transCol = shade(tp, tn, rd, th.m);
    }
  }

  let tint = vec3f(0.92, 0.95, 1.0);
  return mix(transCol * tint, reflCol, fr);
}

// ── Tone mapping ──

fn aces(x: vec3f) -> vec3f {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14),
               vec3f(0.0, 0.0, 0.0), vec3f(1.0, 1.0, 1.0));
}

// ── Entry ──

@fragment fn fs(@location(0) vuv: vec2f) -> @location(0) vec4f {
  let aspect = u.resolution.x / u.resolution.y;
  let px = (vuv.x - 0.5) * aspect;
  let py = 0.5 - vuv.y;

  let camTarget = vec3f(0.0, STEP_H * 3.0 + PILLAR_H * 0.4, 0.0);
  let ro = vec3f(5.0, 4.5, 5.0);
  let fwd = normalize(camTarget - ro);
  let rt = normalize(cross(fwd, vec3f(0.0, 1.0, 0.0)));
  let up = cross(rt, fwd);
  let rd = normalize(fwd * 1.8 + rt * px + up * py);

  let hit = march(ro, rd);
  var col = vec3f(0.0, 0.0, 0.0);

  if (hit.m != MAT_NONE && hit.d < MAX_DIST) {
    let p = ro + rd * hit.d;
    let n = calcN(p);
    if (hit.m == MAT_GLASS) {
      col = shadeGlass(p, n, rd);
    } else {
      col = shade(p, n, rd, hit.m);
    }
    let fog = 1.0 - exp(-hit.d * hit.d * 0.003);
    col = mix(col, vec3f(0.0, 0.0, 0.0), fog);
  }

  col = aces(col);
  col = pow(col, vec3f(1.0 / 2.2, 1.0 / 2.2, 1.0 / 2.2));
  return vec4f(col, 1.0);
}
