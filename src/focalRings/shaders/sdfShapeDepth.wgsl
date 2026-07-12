struct Uniforms {
  viewProj: mat4x4f,
  cameraPos: vec3f,
  farPlane: f32,
  time: f32,
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
  let spin = rot2(u.time * 0.5, rp.xz);
  rp = vec3f(spin.x, rp.y, spin.y);
  rp.y *= 0.7;
  return sdOctahedron(rp, 1.8);
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

  let depth = length(hitPos - u.cameraPos) / u.farPlane;
  return vec4f(depth, 0.0, 0.0, 1.0);
}
