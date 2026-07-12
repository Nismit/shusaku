struct Uniforms {
  viewProj: mat4x4f,
  cameraPos: vec3f,
  farPlane: f32,
  time: f32,
  kick: f32,
};

@group(0) @binding(0) var<uniform> u: Uniforms;

struct VOut {
  @builtin(position) position: vec4f,
  @location(0) worldPos: vec3f,
};

@vertex fn vs(@location(0) pos: vec3f, @location(1) alpha: f32, @location(2) speed: f32) -> VOut {
  var out: VOut;
  out.position = u.viewProj * vec4f(pos, 1.0);
  out.worldPos = pos;
  return out;
}

fn rot2(a: f32, v: vec2f) -> vec2f {
  let c = cos(a);
  let s = sin(a);
  return vec2f(c * v.x - s * v.y, s * v.x + c * v.y);
}

fn sdOctahedron(p: vec3f, s: f32) -> f32 {
  let q = abs(p);
  return (q.x + q.y + q.z - s) * 0.57735027;
}

fn sdfScene(p: vec3f) -> f32 {
  var rp = p - vec3f(-0.8, 2.0, -0.8);
  let spin = rot2(u.time * 0.6, rp.xz);
  rp = vec3f(spin.x, rp.y, spin.y);
  rp.y *= 0.7;
  return sdOctahedron(rp, 1.8 + u.kick * 0.6);
}

fn calcNormal(p: vec3f) -> vec3f {
  let e = vec2f(0.001, 0.0);
  return normalize(vec3f(
    sdfScene(p + e.xyy) - sdfScene(p - e.xyy),
    sdfScene(p + e.yxy) - sdfScene(p - e.yxy),
    sdfScene(p + e.yyx) - sdfScene(p - e.yyx),
  ));
}

const MAX_STEPS: i32 = 80;
const MAX_DIST: f32 = 40.0;
const SURF_DIST: f32 = 0.001;

@fragment fn fs(v: VOut) -> @location(0) vec4f {
  let ro = u.cameraPos;
  let rd = normalize(v.worldPos - ro);
  var t = length(v.worldPos - ro);

  for (var i = 0; i < MAX_STEPS; i++) {
    let p = ro + rd * t;
    let d = sdfScene(p);
    if (d < SURF_DIST) { break; }
    t += d;
    if (t > MAX_DIST) { discard; }
  }

  let hitPos = ro + rd * t;
  if (sdfScene(hitPos) > SURF_DIST) { discard; }

  let n = calcNormal(hitPos);
  let V = -rd;
  let lightDir = normalize(vec3f(0.5, 1.0, 0.3));
  let H = normalize(lightDir + V);

  let fresnel = pow(1.0 - max(dot(n, V), 0.0), 3.0);
  let spec = pow(max(dot(n, H), 0.0), 80.0);
  let spec2 = pow(max(dot(n, normalize(vec3f(-0.3, 0.8, -0.5) + V)), 0.0), 60.0);

  let R = reflect(rd, n);
  let dispersion = dot(R, vec3f(0.7, 0.3, -0.5));
  let rainbow = vec3f(
    smoothstep(-0.3, 0.4, sin(dispersion * 4.0 + 0.0)),
    smoothstep(-0.3, 0.4, sin(dispersion * 4.0 + 2.1)),
    smoothstep(-0.3, 0.4, sin(dispersion * 4.0 + 4.2)),
  );
  let prismStrength = fresnel * 0.9;

  let edge = smoothstep(0.0, 0.4, fresnel);
  let baseCol = mix(vec3f(0.9), rainbow, prismStrength) + spec * 0.8 + spec2 * 0.4;
  let alpha = 0.08 + edge * 0.5 + spec * 0.6 + spec2 * 0.3 + prismStrength * 0.3;

  const SATURATION_BOOST: f32 = 1.7;
  let luma = dot(baseCol, vec3f(0.299, 0.587, 0.114));
  let col = luma + (baseCol - luma) * SATURATION_BOOST;

  const BLOOM_BOOST: f32 = 1.8;
  let flash = 1.0 + u.kick * 1.3;
  return vec4f(col * BLOOM_BOOST * flash, saturate(alpha));
}
