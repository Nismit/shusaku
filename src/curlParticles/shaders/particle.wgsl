// パーティクル描画 (step3: ライティング + パレットカラー + シャドウマップ PCF)
// インスタンスドquad: 1パーティクル = 1インスタンス x 4頂点(triangle-strip)。

struct VParams {
  resolution: vec2<f32>,
  rotation: vec2<f32>,
  zoom: f32,
  particleSize: f32,
  colorSpeed: f32,
  time: f32,
  lightDir: vec3<f32>,
  palette0: vec3<f32>,
  palette1: vec3<f32>,
  palette2: vec3<f32>,
  palette3: vec3<f32>,
  palette4: vec3<f32>,
};

struct FParams {
  lightColor: vec3<f32>,
  ambient: f32,
  shininess: f32,
  saturation: f32,
  contrast: f32,
  exposure: f32,
  shadowColor: vec3<f32>,
};

struct SParams {
  lightViewProj: mat4x4<f32>,
  shadowMapSize: f32,
  shadowBlurRadius: f32,
  shadowEnabled: f32,
  _pad: f32,
};

@group(0) @binding(0) var<storage, read> positions: array<vec4<f32>>;
@group(0) @binding(1) var<uniform> v: VParams;
@group(0) @binding(2) var<uniform> f: FParams;
@group(0) @binding(3) var<uniform> s: SParams;
@group(0) @binding(4) var shadowSampler: sampler;
@group(0) @binding(5) var shadowMap: texture_2d<f32>;

struct VOut {
  @builtin(position) position: vec4<f32>,
  @location(0) corner: vec2<f32>,
  @location(1) life: f32,
  @location(2) color: vec3<f32>,
  @location(3) viewLightDir: vec3<f32>,
  @location(4) viewDir: vec3<f32>,
  @location(5) shadowCoord: vec3<f32>,
};

fn rotateX(angle: f32) -> mat3x3<f32> {
  let c = cos(angle);
  let si = sin(angle);
  return mat3x3<f32>(1.0, 0.0, 0.0, 0.0, c, -si, 0.0, si, c);
}

fn rotateY(angle: f32) -> mat3x3<f32> {
  let c = cos(angle);
  let si = sin(angle);
  return mat3x3<f32>(c, 0.0, si, 0.0, 1.0, 0.0, -si, 0.0, c);
}

fn hueShift(col: vec3<f32>, angle: f32) -> vec3<f32> {
  let k = vec3<f32>(0.57735026919);
  let c = cos(angle);
  let si = sin(angle);
  return col * c + cross(k, col) * si + k * dot(k, col) * (1.0 - c);
}

fn sRGBToLinear(c: vec3<f32>) -> vec3<f32> {
  return pow(c, vec3<f32>(2.2));
}

@vertex
fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  let posData = positions[ii];
  let pos = posData.xyz;
  let life = posData.w;

  // 元の WebGL 版と同じ 2D テクスチャ座標ベースのハッシュ (均一分布)
  let texCoord = vec2<f32>(
    (f32(ii % 512u) + 0.5) / 512.0,
    (f32(ii / 512u) + 0.5) / 512.0
  );
  let rnd = fract(sin(dot(texCoord, vec2<f32>(12.9898, 78.233))) * 43758.5453);
  let sizeRandom = mix(0.5, 2.0, pow(rnd, 5.0));

  let rnd2 = fract(sin(dot(texCoord, vec2<f32>(93.9898, 67.345))) * 28461.6521);
  let paletteIdx = i32(floor(rnd2 * 5.0));
  var baseColor: vec3<f32>;
  if (paletteIdx == 0) { baseColor = v.palette0; }
  else if (paletteIdx == 1) { baseColor = v.palette1; }
  else if (paletteIdx == 2) { baseColor = v.palette2; }
  else if (paletteIdx == 3) { baseColor = v.palette3; }
  else { baseColor = v.palette4; }

  let hueAngle = v.colorSpeed * (v.time + rnd * 6.2831853);
  let color = hueShift(baseColor, hueAngle);

  let cameraRot = rotateX(v.rotation.x) * rotateY(v.rotation.y);
  let viewPos = cameraRot * pos;

  let fov = 1.5;
  let z = viewPos.z + 3.0;
  let perspective = fov / max(z, 0.1);
  var projected = viewPos.xy * perspective * v.zoom;
  projected.x *= v.resolution.y / v.resolution.x;

  let fadeIn = smoothstep(0.0, 0.18, life);
  let fadeOut = smoothstep(0.0, 0.08, 1.0 - life);
  let scale = fadeIn * fadeOut;

  let depth = (viewPos.z + 3.0) / 6.0;

  var corners = array<vec2<f32>, 4>(
    vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, -1.0),
    vec2<f32>(-1.0, 1.0), vec2<f32>(1.0, 1.0)
  );
  let corner = corners[vi];

  let pointPx = max(v.particleSize * sizeRandom * scale * perspective * v.zoom, 0.0);
  let offset = corner * pointPx / v.resolution;

  let lightPos = normalize(v.lightDir) * 3.0;
  let viewLightDir = normalize(cameraRot * (lightPos - pos));
  let viewDir = normalize(vec3<f32>(-viewPos.xy, viewPos.z + 3.0));

  // シャドウ座標 (ライトクリップ空間, ortho なので w=1)
  let shadowClip = s.lightViewProj * vec4<f32>(pos, 1.0);

  var out: VOut;
  out.position = vec4<f32>(projected + offset, depth, 1.0);
  out.corner = corner;
  out.life = life;
  out.color = color;
  out.viewLightDir = viewLightDir;
  out.viewDir = viewDir;
  out.shadowCoord = shadowClip.xyz;
  return out;
}

const PCF_TAPS = 12;

fn pcfRotationNoise(p: vec2<f32>) -> f32 {
  return fract(52.9829189 * fract(dot(p, vec2<f32>(0.06711056, 0.00583715))));
}

fn sampleShadow(shadowCoord: vec3<f32>, fragCoord: vec2<f32>) -> f32 {
  // ライトクリップ -> シャドウマップ UV (y は WebGPU の上下反転を補正)
  let uv = vec2<f32>(shadowCoord.x * 0.5 + 0.5, shadowCoord.y * -0.5 + 0.5);
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) { return 1.0; }

  let currentDepth = shadowCoord.z;
  let texelSize = 1.0 / s.shadowMapSize;
  let phi = pcfRotationNoise(fragCoord) * 6.28318;
  var sum = 0.0;

  for (var i = 0; i < PCF_TAPS; i++) {
    let r = sqrt((f32(i) + 0.5) / f32(PCF_TAPS));
    let theta = f32(i) * 2.39996323 + phi;
    let off = r * vec2<f32>(cos(theta), sin(theta)) * texelSize * s.shadowBlurRadius;
    let storedDepth = textureSampleLevel(shadowMap, shadowSampler, uv + off, 0.0).r;
    sum += step(currentDepth, storedDepth);
  }

  return sum / f32(PCF_TAPS);
}

@fragment
fn fs(in: VOut) -> @location(0) vec4<f32> {
  let r2 = dot(in.corner, in.corner);
  if (r2 > 1.0 || in.life < 0.01) {
    discard;
  }

  let zc = sqrt(1.0 - r2);
  let normal = vec3<f32>(in.corner, zc);

  let lightDir = in.viewLightDir;
  let viewDir = normalize(in.viewDir);

  let baseColor = sRGBToLinear(in.color);
  let lightCol = sRGBToLinear(f.lightColor);
  let shadowCol = sRGBToLinear(f.shadowColor);

  let NdotL = dot(normal, lightDir);
  var diff = max(NdotL * 0.5 + 0.5, 0.0);
  diff *= diff;

  let halfDir = normalize(lightDir + viewDir);
  let spec = pow(max(dot(normal, halfDir), 0.0), f.shininess);

  let fresnel = pow(1.0 - max(dot(normal, viewDir), 0.0), 1.0);

  var shadowMask = 1.0;
  if (s.shadowEnabled > 0.5) {
    shadowMask = sampleShadow(in.shadowCoord, in.position.xy);
  }
  shadowMask = pow(shadowMask, 3.0);

  let ambient = baseColor * f.ambient;
  let diffuseTerm = baseColor * (0.8 * diff);
  let specularTerm = lightCol * (0.6 * spec);
  let rimTerm = baseColor * (0.4 * fresnel);

  var color = ambient + (diffuseTerm + specularTerm + rimTerm) * shadowMask;

  let shadowAmount = 1.0 - shadowMask;
  color = mix(color, shadowCol, shadowAmount);

  let luma = dot(color, vec3<f32>(0.299, 0.587, 0.114));
  color = mix(vec3<f32>(luma), color, f.saturation);
  color = (color - 0.5) * f.contrast + 0.5;
  color = max(color, vec3<f32>(0.0)) * f.exposure;

  return vec4<f32>(color, 1.0);
}
