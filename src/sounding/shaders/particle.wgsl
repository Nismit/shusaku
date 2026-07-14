struct Scene {
  viewProj: mat4x4f,
  camRight: vec3f,
  time: f32,
  camUp: vec3f,
  particleSize: f32,
  densityScale: f32,
  _pad0: f32,
  _pad1: f32,
  _pad2: f32,
};

@group(0) @binding(0) var<uniform> u: Scene;
@group(0) @binding(1) var<storage, read> positions: array<vec4f>;

struct VOut {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
  @location(1) life: f32,
};

@vertex fn vs(@builtin(vertex_index) vid: u32, @builtin(instance_index) iid: u32) -> VOut {
  let posData = positions[iid];
  let center = posData.xyz;
  let life = posData.w;

  let offsets = array<vec2f, 4>(
    vec2f(-1, -1), vec2f(1, -1), vec2f(-1, 1), vec2f(1, 1)
  );
  let uv = offsets[vid];

  let lifeFade = smoothstep(0.0, 0.15, life) * (1.0 - smoothstep(0.85, 1.0, life));
  let size = u.particleSize * mix(0.4, 1.0, lifeFade);
  let worldPos = center + (u.camRight * uv.x + u.camUp * uv.y) * size;

  var out: VOut;
  out.position = u.viewProj * vec4f(worldPos, 1.0);
  out.uv = uv;
  out.life = life;
  return out;
}

const BIRTH_COL: vec3f = vec3f(0.2, 0.55, 0.9);
const PEAK_COL: vec3f  = vec3f(0.65, 0.88, 1.0);
const DEATH_COL: vec3f = vec3f(0.08, 0.12, 0.28);

@fragment fn fs(v: VOut) -> @location(0) vec4f {
  let d = length(v.uv);
  if (d > 1.0) { discard; }

  let alpha = exp(-d * d * 3.5) * 0.6;

  var col = mix(BIRTH_COL, PEAK_COL, smoothstep(0.0, 0.25, v.life));
  col = mix(col, DEATH_COL, smoothstep(0.6, 1.0, v.life));

  return vec4f(col * alpha, alpha);
}
