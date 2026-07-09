struct VParams {
  resolution: vec2<f32>,
  rotation: vec2<f32>,
  zoom: f32,
  particleSize: f32,
  colorA: vec3<f32>,
  colorB: vec3<f32>,
  colorC: vec3<f32>,
  colorA2: vec3<f32>,
  colorB2: vec3<f32>,
  colorC2: vec3<f32>,
};

@group(0) @binding(0) var<storage, read> positions: array<vec4<f32>>;
@group(0) @binding(1) var<uniform> v: VParams;
@group(0) @binding(2) var<storage, read> aux: array<vec4<f32>>;

struct VOut {
  @builtin(position) position: vec4<f32>,
  @location(0) corner: vec2<f32>,
  @location(1) life: f32,
  @location(2) color: vec3<f32>,
};

fn rotateX(a: f32) -> mat3x3<f32> {
  let c = cos(a); let s = sin(a);
  return mat3x3<f32>(1.0, 0.0, 0.0, 0.0, c, -s, 0.0, s, c);
}

fn rotateY(a: f32) -> mat3x3<f32> {
  let c = cos(a); let s = sin(a);
  return mat3x3<f32>(c, 0.0, s, 0.0, 1.0, 0.0, -s, 0.0, c);
}

@vertex
fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  let posData = positions[ii];
  let pos = posData.xyz;
  let life = posData.w;

  let colorMix = aux[ii].x;

  let youngPhase = smoothstep(0.0, 0.35, life);
  let oldPhase = smoothstep(0.5, 0.9, life);
  let primary = mix(mix(v.colorA, v.colorB, youngPhase), v.colorC, oldPhase);
  let secondary = mix(mix(v.colorA2, v.colorB2, youngPhase), v.colorC2, oldPhase);
  let color = mix(primary, secondary, colorMix);

  let cameraRot = rotateX(v.rotation.x) * rotateY(v.rotation.y);
  let viewPos = cameraRot * pos;

  let fov = 1.5;
  let z = viewPos.z + 3.0;
  let perspective = fov / max(z, 0.1);
  var projected = viewPos.xy * perspective * v.zoom;
  projected.x *= v.resolution.y / v.resolution.x;

  let fadeIn = smoothstep(0.0, 0.15, life);
  let fadeOut = smoothstep(0.0, 0.1, 1.0 - life);
  let scale = fadeIn * fadeOut;

  let depth = (viewPos.z + 3.0) / 6.0;

  let texCoord = vec2<f32>(
    (f32(ii % 256u) + 0.5) / 256.0,
    (f32(ii / 256u) + 0.5) / 256.0
  );
  let rnd = fract(sin(dot(texCoord, vec2<f32>(12.9898, 78.233))) * 43758.5453);
  let sizeRandom = mix(0.5, 1.5, rnd);

  var corners = array<vec2<f32>, 4>(
    vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, -1.0),
    vec2<f32>(-1.0, 1.0), vec2<f32>(1.0, 1.0)
  );
  let corner = corners[vi];

  let pointPx = max(v.particleSize * sizeRandom * scale * perspective * v.zoom, 0.0);
  let offset = corner * pointPx / v.resolution;

  var out: VOut;
  out.position = vec4<f32>(projected + offset, depth, 1.0);
  out.corner = corner;
  out.life = life;
  out.color = color;
  return out;
}

fn sRGBToLinear(c: vec3<f32>) -> vec3<f32> {
  return pow(c, vec3<f32>(2.2));
}

@fragment
fn fs(in: VOut) -> @location(0) vec4<f32> {
  let r2 = dot(in.corner, in.corner);
  if (r2 > 1.0 || in.life < 0.01) {
    discard;
  }

  let glow = exp(-r2 * 5.0);
  let color = sRGBToLinear(in.color) * glow * 0.12;

  return vec4<f32>(color, 1.0);
}
