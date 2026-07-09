struct Camera {
  resolution: vec2f,
  rotation: vec2f,
  zoom: f32,
  numBalls: f32,
  colorBlend: f32,
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

struct Ball {
  position: vec3f,
  radius: f32,
}

@group(0) @binding(0) var<storage, read> vertices: array<f32>;
@group(0) @binding(1) var<uniform> camera: Camera;
@group(0) @binding(2) var<uniform> material: Material;
@group(0) @binding(3) var<storage, read> balls: array<Ball>;
@group(0) @binding(4) var<storage, read> ballColors: array<vec4f>;

struct VOut {
  @builtin(position) position: vec4f,
  @location(0) worldPos: vec3f,
  @location(1) viewPos: vec3f,
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

  let viewPos = rotateX(rotateY(pos, camera.rotation.y), camera.rotation.x);

  let aspect = camera.resolution.x / camera.resolution.y;
  let fov = 1.5;
  let z = viewPos.z + camera.zoom;
  let proj = vec2f(viewPos.x, viewPos.y) * fov / z;

  var out: VOut;
  out.position = vec4f(proj.x / aspect, proj.y, (z - 1.0) / 20.0, 1.0);
  out.worldPos = pos;
  out.viewPos = viewPos;
  return out;
}

@fragment fn fs(in: VOut) -> @location(0) vec4f {
  let numBalls = u32(camera.numBalls);
  var grad = vec3f(0.0);
  var colorAccum = vec3f(0.0);
  var weightSum = 0.0;
  for (var i = 0u; i < numBalls; i++) {
    let ball = balls[i];
    let d = in.worldPos - ball.position;
    let dist2 = dot(d, d) + 0.0001;
    grad += -2.0 * ball.radius * ball.radius * d / (dist2 * dist2);
    let w = ball.radius * ball.radius / dist2;
    colorAccum += w * ballColors[i].rgb;
    weightSum += w;
  }
  let gradLen = length(grad);
  let worldNormal = select(-grad / gradLen, vec3f(0.0, 1.0, 0.0), gradLen < 0.0001);
  let blendedColor = select(material.baseColor, colorAccum / weightSum, weightSum > 0.0001);
  let tintedBase = mix(material.baseColor, blendedColor, camera.colorBlend);

  let N = normalize(rotateX(rotateY(worldNormal, camera.rotation.y), camera.rotation.x));
  let V = normalize(-in.viewPos);
  let L = normalize(camera.lightDir);
  let H = normalize(L + V);

  let NdotL = max(dot(N, L), 0.0);
  let NdotH = max(dot(N, H), 0.0);
  let NdotV = max(dot(N, V), 0.0);

  let diffuse = tintedBase * NdotL;
  let tintedSpec = mix(material.specColor, tintedBase, camera.colorBlend * 0.5);
  let spec = tintedSpec * pow(NdotH, material.shininess);

  let fresnel = pow(1.0 - NdotV, material.fresnelPower);
  let tintedFresnel = mix(material.fresnelColor, tintedBase, camera.colorBlend);
  let rim = tintedFresnel * fresnel;

  let ao = smoothstep(1.0, 8.0, gradLen) * 0.6 + 0.4;

  let hemiBlend = N.y * 0.5 + 0.5;
  let hemiAmbient = tintedBase * material.ambient * (0.6 + 0.4 * hemiBlend);

  let color = (hemiAmbient + diffuse * material.lightColor) * ao
            + spec * material.lightColor
            + rim;

  return vec4f(color * material.exposure, 1.0);
}
