struct Camera {
  resolution: vec2f,
  rotation: vec2f,
  zoom: f32,
  _pad0: f32,
  _pad1: f32,
  _pad2: f32,
  lightDir: vec3f,
  _pad3: f32,
}

struct Material {
  baseColor: vec3f,
  ambient: f32,
  specColor: vec3f,
  shininess: f32,
  fresnelColor: vec3f,
  fresnelPower: f32,
  lightColor: vec3f,
  exposure: f32,
}

@group(0) @binding(0) var<storage, read> vertices: array<f32>;
@group(0) @binding(1) var<uniform> camera: Camera;
@group(0) @binding(2) var<uniform> material: Material;

struct VOut {
  @builtin(position) position: vec4f,
  @location(0) viewPos: vec3f,
  @location(1) viewNormal: vec3f,
}

fn rotateY(v: vec3f, a: f32) -> vec3f {
  let c = cos(a); let s = sin(a);
  return vec3f(c * v.x + s * v.z, v.y, -s * v.x + c * v.z);
}

fn rotateX(v: vec3f, a: f32) -> vec3f {
  let c = cos(a); let s = sin(a);
  return vec3f(v.x, c * v.y - s * v.z, s * v.y + c * v.z);
}

@vertex fn vs(@builtin(vertex_index) vi: u32) -> VOut {
  let base = vi * 6u;
  let pos = vec3f(vertices[base], vertices[base + 1u], vertices[base + 2u]);
  let normal = vec3f(vertices[base + 3u], vertices[base + 4u], vertices[base + 5u]);

  let viewPos = rotateX(rotateY(pos, camera.rotation.y), camera.rotation.x);
  let viewNormal = rotateX(rotateY(normal, camera.rotation.y), camera.rotation.x);

  let aspect = camera.resolution.x / camera.resolution.y;
  let fov = 1.5;
  let z = viewPos.z + camera.zoom;
  let proj = vec2f(viewPos.x, viewPos.y) * fov / z;

  var out: VOut;
  out.position = vec4f(proj.x / aspect, proj.y, (z - 1.0) / 20.0, 1.0);
  out.viewPos = viewPos;
  out.viewNormal = viewNormal;
  return out;
}

@fragment fn fs(in: VOut) -> @location(0) vec4f {
  let N = normalize(in.viewNormal);
  let V = normalize(-in.viewPos);
  let L = normalize(camera.lightDir);
  let H = normalize(L + V);

  let NdotL = max(dot(N, L), 0.0);
  let NdotH = max(dot(N, H), 0.0);
  let NdotV = max(dot(N, V), 0.0);

  let diffuse = material.baseColor * NdotL;
  let spec = material.specColor * pow(NdotH, material.shininess);

  let fresnel = pow(1.0 - NdotV, material.fresnelPower);
  let rim = material.fresnelColor * fresnel;

  let sssWrap = max(0.0, dot(N, L) * 0.5 + 0.5);
  let sss = material.baseColor * sssWrap * 0.15;

  let color = material.baseColor * material.ambient
            + diffuse * material.lightColor
            + spec * material.lightColor
            + rim
            + sss;

  return vec4f(color * material.exposure, 1.0);
}
