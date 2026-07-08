struct SceneUniforms {
  viewProj: mat4x4f,
  lightViewProj: mat4x4f,
  lightDir: vec3f,
  ambient: f32,
  shadowMapSize: f32,
  pcfRadius: f32,
  time: f32,
  groundSize: f32,
  gridScale: f32,
  colorMix: f32,
};

struct CubeInstance {
  posX: f32,
  posZ: f32,
  height: f32,
  colorIndex: f32,
  cellScale: f32,
};

@group(0) @binding(0) var<uniform> u: SceneUniforms;
@group(0) @binding(1) var<storage, read> instances: array<CubeInstance>;
@group(0) @binding(2) var shadowSamp: sampler;
@group(0) @binding(3) var shadowMap: texture_2d<f32>;

const PALETTE = array<vec3f, 4>(
  vec3f(0.98, 0.97, 0.94),
  vec3f(0.85, 0.12, 0.10),
  vec3f(0.96, 0.82, 0.12),
  vec3f(0.10, 0.18, 0.65),
);

struct VOut {
  @builtin(position) position: vec4f,
  @location(0) worldNormal: vec3f,
  @location(1) worldPos: vec3f,
  @location(2) shadowCoord: vec3f,
  @location(3) color: vec3f,
  @location(4) ao: f32,
  @location(5) faceUV: vec2f,
};

@vertex fn vs(
  @location(0) pos: vec3f,
  @location(1) norm: vec3f,
  @location(2) uv: vec2f,
  @builtin(instance_index) iid: u32,
) -> VOut {
  let inst = instances[iid];
  let scaleY = max(inst.height, 0.001);

  let worldPos = vec3f(
    (pos.x + inst.posX) * inst.cellScale,
    pos.y * scaleY * inst.cellScale,
    (pos.z + inst.posZ) * inst.cellScale,
  );

  var worldNorm = norm;
  if (abs(norm.y) < 0.5) {
    worldNorm = normalize(vec3f(norm.x, norm.y / max(scaleY, 0.001), norm.z));
  }

  let lightClip = u.lightViewProj * vec4f(worldPos, 1.0);
  let shadowCoord = vec3f(
    lightClip.x / lightClip.w * 0.5 + 0.5,
    lightClip.y / lightClip.w * -0.5 + 0.5,
    lightClip.z / lightClip.w,
  );

  let ci = u32(inst.colorIndex);
  let colorMix = 1.0 - smoothstep(0.0, 0.2, scaleY);
  let color = mix(PALETTE[min(ci, 3u)], PALETTE[0], colorMix);

  var out: VOut;
  out.position = u.viewProj * vec4f(worldPos, 1.0);
  out.worldNormal = worldNorm;
  out.worldPos = worldPos;
  out.shadowCoord = shadowCoord;
  out.color = color;
  out.ao = pos.y;
  out.faceUV = uv;
  return out;
}

// Vogel disk PCF
const GOLDEN_ANGLE: f32 = 2.399963;

fn pcfShadow(coord: vec3f, bias: f32) -> f32 {
  let texelSize = 1.0 / u.shadowMapSize;
  let taps = 8;
  var shadow = 0.0;

  for (var i = 0; i < taps; i++) {
    let fi = f32(i);
    let r = sqrt((fi + 0.5) / f32(taps)) * u.pcfRadius;
    let theta = fi * GOLDEN_ANGLE;
    let offset = vec2f(cos(theta), sin(theta)) * r * texelSize;
    let sampleDepth = textureSample(shadowMap, shadowSamp, coord.xy + offset).r;
    shadow += select(0.0, 1.0, coord.z - bias <= sampleDepth);
  }

  return shadow / f32(taps);
}

@fragment fn fs(v: VOut) -> @location(0) vec4f {
  let n = normalize(v.worldNormal);
  let l = normalize(u.lightDir);

  let ndotl = max(dot(n, l), 0.0);
  let diffuse = ndotl;

  let bias = 0.003;
  let shadow = pcfShadow(v.shadowCoord, bias);

  let ao = mix(0.55, 1.0, smoothstep(0.0, 0.3, v.ao));

  let edgeDist = min(min(v.faceUV.x, 1.0 - v.faceUV.x), min(v.faceUV.y, 1.0 - v.faceUV.y));
  let edgeLine = smoothstep(0.0, 0.03, edgeDist);
  let edgeFactor = mix(0.88, 1.0, edgeLine);

  let shadowStrength = 0.55;
  let lit = u.ambient + diffuse * (1.0 - shadowStrength + shadowStrength * shadow);
  let col = v.color * lit * ao * edgeFactor;

  return vec4f(col, 1.0);
}
