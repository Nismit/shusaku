// Raymarching tunnel based on Shane's "Subterranean Fly-Through"
// https://www.shadertoy.com/view/XlXXWj

struct Params {
  resolution: vec2f,
  time: f32,
  speed: f32,
  boostTime: f32,
  freqA: f32,
  freqB: f32,
  ampA: f32,
  ampB: f32,
  tunnelRadius: f32,
  maxSteps: i32,
  stepScale: f32,
  maxDist: f32,
};

@group(0) @binding(0) var<uniform> u: Params;

const PI: f32 = 3.1415926535898;
const TAU: f32 = 6.28318530718;
const NUM_CABLES: i32 = 4;
const RING_SPACING: f32 = 2.5;
const CONNECTOR_SPACING: f32 = 8.0;

fn glsl_mod_f(x: vec2f, y: f32) -> vec2f {
  return x - y * floor(x / y);
}

fn path(z: f32) -> vec2f {
  return vec2f(u.ampA * sin(z * u.freqA), u.ampB * cos(z * u.freqB));
}

fn pathDeriv(z: f32) -> vec2f {
  return vec2f(
    u.ampA * u.freqA * cos(z * u.freqA),
    -u.ampB * u.freqB * sin(z * u.freqB)
  );
}

fn hash(n: f32) -> f32 {
  return fract(sin(n) * 43758.5453);
}

fn hash2(p: vec2f) -> f32 {
  return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453);
}

fn noise1D(x: f32) -> f32 {
  let i = floor(x);
  var f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(hash(i), hash(i + 1.0), f);
}

fn getCablePosition(cableIndex: i32, z: f32) -> vec3f {
  let idx = f32(cableIndex);
  var baseAngle = idx * TAU / f32(NUM_CABLES);
  baseAngle += (hash(idx * 41.0) - 0.5) * 0.8;

  let undulateFreq = 0.3 + hash(idx * 47.0) * 0.2;
  let undulateAmp = 0.15 + hash(idx * 53.0) * 0.1;
  let angleNoise = (noise1D(z * undulateFreq + idx * 100.0) - 0.5) * undulateAmp * TAU;
  let radiusNoise = (noise1D(z * undulateFreq * 0.7 + idx * 200.0) - 0.5) * 0.1;

  let angle = baseAngle + angleNoise;
  let radius = (u.tunnelRadius - 0.08) * (1.0 + radiusNoise);

  let pathPos = path(z);
  let localPos = vec2f(cos(angle), sin(angle)) * radius;

  return vec3f(pathPos + localPos, z);
}

fn cableDist(pos: vec3f, cableIndex: i32) -> f32 {
  let cablePos = getCablePosition(cableIndex, pos.z);
  return length(pos.xy - cablePos.xy) - 0.025;
}

fn cableRingDist(pos: vec3f, cableIndex: i32, idx: f32) -> f32 {
  let phase = hash(idx * 61.0) * RING_SPACING;
  let ringZ = floor((pos.z + phase) / RING_SPACING) * RING_SPACING - phase;

  let zDist = abs(pos.z - ringZ);
  if (zDist > 0.15) { return 1e10; }

  let cablePos = getCablePosition(cableIndex, ringZ);
  let local = pos - vec3f(cablePos.xy, ringZ);

  let majorR: f32 = 0.045;
  let minorR: f32 = 0.012;
  let q = vec2f(length(local.xy) - majorR, local.z);
  return length(q) - minorR;
}

fn cableConnectorDist(pos: vec3f, cableIndex: i32, idx: f32) -> f32 {
  let phase = hash(idx * 89.0) * CONNECTOR_SPACING;
  let connZ = floor((pos.z + phase) / CONNECTOR_SPACING) * CONNECTOR_SPACING - phase;

  let zDist = abs(pos.z - connZ);
  if (zDist > 0.15) { return 1e10; }

  let cablePos = getCablePosition(cableIndex, connZ);
  let local = pos - vec3f(cablePos.xy, connZ);

  let boxSize = vec3f(0.05, 0.05, 0.06);
  let q = abs(local) - boxSize;
  return length(max(q, vec3f(0.0))) + min(max(q.x, max(q.y, q.z)), 0.0) - 0.01;
}

fn mapTunnel(pos: vec3f) -> f32 {
  let tun = pos.xy - path(pos.z);
  return u.tunnelRadius - length(tun);
}

fn mapAllCables(pos: vec3f) -> vec4f {
  var dCable: f32 = 1e10;
  var dRing: f32 = 1e10;
  var dConn: f32 = 1e10;

  for (var i: i32 = 0; i < NUM_CABLES; i++) {
    let idx = f32(i);
    dCable = min(dCable, cableDist(pos, i));
    dRing = min(dRing, cableRingDist(pos, i, idx));
    dConn = min(dConn, cableConnectorDist(pos, i, idx));
  }

  let minDist = min(min(dCable, dRing), dConn);
  return vec4f(minDist, dCable, dRing, dConn);
}

fn sdfMap(pos: vec3f) -> f32 {
  let tunnel = mapTunnel(pos);
  let cables = mapAllCables(pos);
  return min(tunnel, cables.x);
}

struct SDFResult {
  dist: f32,
  surface: i32,
};

// Skip expensive cable SDF when deep inside the tunnel interior
fn sdfMapFast(pos: vec3f) -> SDFResult {
  var result: SDFResult;
  let tun = pos.xy - path(pos.z);
  let r = length(tun);
  let tunnel = u.tunnelRadius - r;

  // Inner boundary of the cable zone (conservative estimate)
  let cableInner = (u.tunnelRadius - 0.08) * 0.95 - 0.06;
  let dCableZone = cableInner - r;
  if (dCableZone > 0.01) {
    result.dist = tunnel;
    result.surface = 0;
    return result;
  }

  let cables = mapAllCables(pos);
  if (cables.x < tunnel) {
    result.dist = cables.x;
    result.surface = 1;
  } else {
    result.dist = tunnel;
    result.surface = 0;
  }
  return result;
}

fn getCableHitType(pos: vec3f) -> i32 {
  let cables = mapAllCables(pos);
  let threshold: f32 = 0.015;

  if (cables.w < threshold) { return 3; }
  if (cables.z < threshold) { return 2; }
  if (cables.y < threshold) { return 1; }
  return 0;
}

fn getNormal(pos: vec3f) -> vec3f {
  let eps: f32 = 0.001;
  let k = vec2f(1.0, -1.0);
  return normalize(
    k.xyy * sdfMap(pos + k.xyy * eps) +
    k.yyx * sdfMap(pos + k.yyx * eps) +
    k.yxy * sdfMap(pos + k.yxy * eps) +
    k.xxx * sdfMap(pos + k.xxx * eps)
  );
}

fn getTunnelNormal(pos: vec3f) -> vec3f {
  let tun = pos.xy - path(pos.z);
  let pd = pathDeriv(pos.z);
  return normalize(vec3f(-tun, dot(pd, tun)));
}

struct GlowGI {
  glow: vec3f,
  gi: vec3f,
};

fn calcCableGlowGI(surfacePos: vec3f, surfaceNormal: vec3f, time: f32) -> GlowGI {
  var result: GlowGI;
  result.glow = vec3f(0.0);
  result.gi = vec3f(0.0);

  for (var i: i32 = 0; i < NUM_CABLES; i++) {
    let idx = f32(i);
    let cablePos = getCablePosition(i, surfacePos.z);
    let toC = cablePos.xy - surfacePos.xy;
    let dist = length(toC);

    let phaseOffset = hash(idx * 73.0) * TAU;
    let pulseRaw = sin((surfacePos.z - time * 8.0) * 0.8 + phaseOffset);
    let pulse = smoothstep(0.85, 1.0, pulseRaw);

    let cableColor = mix(
      vec3f(0.2, 0.6, 1.0),
      vec3f(0.4, 0.9, 1.0),
      hash(idx * 67.0)
    );

    result.glow += cableColor * exp(-dist * 15.0) * pulse * 1.5;

    let lightDir = vec3f(toC, 0.0) / dist;
    let NdotL = max(dot(surfaceNormal, lightDir), 0.0);
    let wrapDiffuse = max((NdotL + 0.3) / 1.3, 0.0);
    let atten = 1.0 / (1.0 + dist * 0.5 + dist * dist * 0.2);
    result.gi += cableColor * wrapDiffuse * atten * pulse * 0.8;
  }

  return result;
}

fn truchetPattern(localPos: vec2f, z: f32) -> f32 {
  let angle = atan2(localPos.y, localPos.x);
  let uv = vec2f(angle / TAU * 10.0, z * 0.8);
  let cellID = glsl_mod_f(floor(uv), 1000.0);
  var cellF = fract(uv);

  let rot = step(0.5, hash2(cellID));
  if (rot > 0.5) {
    cellF.x = 1.0 - cellF.x;
  }

  let d = abs(cellF.x - cellF.y) / sqrt(2.0);
  let lineWidth: f32 = 0.08;
  return smoothstep(lineWidth, lineWidth * 0.5, d);
}

fn styleWarp(sp: vec3f, sn: vec3f, rd: vec3f, t: f32, cableGlow: vec3f, cableGI: vec3f) -> vec3f {
  let localPos = sp.xy - path(sp.z);
  let angle = atan2(localPos.y, localPos.x);

  let depth = t / 80.0;
  let fog = exp(-depth * 0.5);

  let angularPos = angle * 30.0 / TAU;
  let sectorIdx = floor(angularPos);
  let fracInSector = fract(angularPos);
  let distToCenter = abs(fracInSector - 0.5);

  let currentStreak = step(0.8, hash(sectorIdx));
  let prevStreak = step(0.8, hash(sectorIdx - 1.0));
  let nextStreak = step(0.8, hash(sectorIdx + 1.0));

  let proximityToCurrent = currentStreak * (1.0 - distToCenter * 2.0);
  let proximityToPrev = prevStreak * (1.0 - (1.0 - fracInSector) * 2.0);
  let proximityToNext = nextStreak * (1.0 - fracInSector * 2.0);
  let streakProximity = max(max(proximityToCurrent, max(proximityToPrev, 0.0)), max(proximityToNext, 0.0));

  let streakRand = hash(sectorIdx);
  let streakPhase = fract(sp.z * 0.1 - u.time * 3.0 + streakRand);
  let streakFade = smoothstep(0.0, 0.2, streakPhase) * smoothstep(1.0, 0.5, streakPhase);

  let starUV = vec2f(angle * 20.0, sp.z * 2.0);
  let starID = glsl_mod_f(floor(starUV), 1000.0);
  let star = step(0.995, hash2(starID));
  let twinkle = 0.5 + 0.5 * sin(u.time * 8.0 + hash2(starID) * 100.0);

  var col = vec3f(0.0, 0.01, 0.02);
  col += vec3f(0.5, 0.55, 0.6) * star * twinkle;

  let truchetFade = 1.0 - smoothstep(0.0, 0.6, streakProximity);
  let pattern = truchetPattern(localPos, sp.z);
  col += vec3f(0.35, 0.45, 0.55) * pattern * 0.25 * truchetFade;

  let streakColor = mix(vec3f(0.3, 0.4, 0.5), vec3f(0.6), streakRand);
  let streakMask = currentStreak * streakFade;
  col = mix(col, streakColor, streakMask);

  col += cableGlow;
  col += cableGI * 0.1;

  return col * fog;
}

@fragment
fn fs(@builtin(position) fragCoord: vec4f, @location(0) texCoord: vec2f) -> @location(0) vec4f {
  var uv = (fragCoord.xy - u.resolution * 0.5) / u.resolution.y;
  uv.y = -uv.y;

  let time = u.time * u.speed + u.boostTime;
  var lookAt = vec3f(0.0, 0.0, time * 4.0);
  var camPos = lookAt + vec3f(0.0, 0.0, -0.1);

  let pL = path(lookAt.z);
  lookAt = vec3f(lookAt.xy + pL, lookAt.z);
  let pC = path(camPos.z);
  camPos = vec3f(camPos.xy + pC, camPos.z);

  let FOV = PI / 3.0;
  let forward = normalize(lookAt - camPos);
  let right = normalize(vec3f(forward.z, 0.0, -forward.x));
  let up = cross(forward, right);

  let twist = sin(time * 0.4) * 0.3 + sin(time * 0.17) * 0.15;
  let right2 = right * cos(twist) + up * sin(twist);
  let up2 = -right * sin(twist) + up * cos(twist);

  let rd = normalize(forward + FOV * uv.x * right2 + FOV * uv.y * up2);

  var t: f32 = 0.0;
  var dt: f32 = 0.0;
  var hitSurface: i32 = 0;

  for (var i: i32 = 0; i < u.maxSteps; i++) {
    let sdf = sdfMapFast(camPos + rd * t);
    dt = sdf.dist;
    hitSurface = sdf.surface;
    if (dt < 0.002 || t > u.maxDist) { break; }
    t += dt * u.stepScale;
  }

  var col = vec3f(0.0);

  if (dt < 0.002) {
    let sp = camPos + rd * t;

    var sn: vec3f;
    var hitType: i32 = 0;

    if (hitSurface == 1) {
      hitType = getCableHitType(sp);
      sn = getNormal(sp);
    } else {
      sn = getTunnelNormal(sp);
    }

    let glowGI = calcCableGlowGI(sp, sn, time);
    let cableGlow = glowGI.glow;
    let cableGI = glowGI.gi;

    if (hitType > 0) {
      let depthVal = t / 60.0;
      let fog = exp(-depthVal * depthVal * 0.6);

      let diff = max(dot(sn, -rd), 0.0) * 0.3 + 0.3;
      let rim = pow(1.0 - abs(dot(sn, rd)), 3.0);

      if (hitType == 3) {
        let connBase = vec3f(0.02, 0.02, 0.025);
        let connHighlight = vec3f(0.05, 0.05, 0.06);

        let pulse = sin(time * 3.0 + sp.z * 0.5) * 0.5 + 0.5;
        let indicatorColor = mix(vec3f(0.1, 0.4, 0.8), vec3f(0.2, 0.8, 1.0), pulse);

        col = mix(connBase, connHighlight, diff + rim * 0.3);
        col += indicatorColor * pulse * 0.3;
        col += cableGlow * 0.5 + cableGI * 0.05;
      } else if (hitType == 2) {
        let ringBase = vec3f(0.12, 0.14, 0.18);
        let ringHighlight = vec3f(0.3, 0.35, 0.45);

        let spec = pow(max(dot(reflect(rd, sn), -rd), 0.0), 32.0);
        col = mix(ringBase, ringHighlight, diff) + vec3f(0.5) * spec * 0.3;
        col += cableGlow * 1.2 + cableGI * 0.08;
      } else {
        let cableBase = vec3f(0.04, 0.05, 0.06);
        col = cableBase * diff + cableGlow * 2.0 + cableGI * 0.1;
      }

      col *= fog;
    } else {
      col = styleWarp(sp, sn, rd, t, cableGlow, cableGI);
    }
  } else {
    let fadeFog = exp(-t * 0.02);

    col = vec3f(0.0, 0.005, 0.01) * fadeFog;
  }

  return vec4f(col, 1.0);
}
