struct PoleParams {
  resolution: vec2<f32>,
  rotation: vec2<f32>,
  zoom: f32,
  glowSize: f32,
  _pad: vec2<f32>,
};

@group(0) @binding(0) var<storage, read> poles: array<vec4<f32>>;
@group(0) @binding(1) var<uniform> p: PoleParams;

struct VOut {
  @builtin(position) position: vec4<f32>,
  @location(0) corner: vec2<f32>,
  @location(1) charge: f32,
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
  let pole = poles[ii];
  let pos = pole.xyz;

  let cameraRot = rotateX(p.rotation.x) * rotateY(p.rotation.y);
  let viewPos = cameraRot * pos;

  let fov = 1.5;
  let z = viewPos.z + 3.0;
  let perspective = fov / max(z, 0.1);
  var projected = viewPos.xy * perspective * p.zoom;
  projected.x *= p.resolution.y / p.resolution.x;

  var corners = array<vec2<f32>, 4>(
    vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, -1.0),
    vec2<f32>(-1.0, 1.0), vec2<f32>(1.0, 1.0)
  );
  let corner = corners[vi];

  let pointPx = p.glowSize * perspective * p.zoom;
  let offset = corner * pointPx / p.resolution;

  let depth = (viewPos.z + 3.0) / 6.0;

  var out: VOut;
  out.position = vec4<f32>(projected + offset, depth, 1.0);
  out.corner = corner;
  out.charge = pole.w;
  return out;
}

@fragment
fn fs(in: VOut) -> @location(0) vec4<f32> {
  let r2 = dot(in.corner, in.corner);
  if (r2 > 1.0) { discard; }

  let r = sqrt(r2);

  let core = smoothstep(0.2, 0.0, r);
  let glow = exp(-r2 * 4.0);
  let halo = exp(-r2 * 1.0) * 0.3;
  let intensity = core + glow * 0.5 + halo;

  let warm = vec3<f32>(1.0, 0.55, 0.15);
  let cool = vec3<f32>(0.2, 0.5, 1.0);
  let baseColor = select(cool, warm, in.charge > 0.0);
  let color = mix(baseColor, vec3<f32>(1.0, 0.97, 0.92), core * 0.6);

  return vec4<f32>(color * intensity * 0.06, 1.0);
}
