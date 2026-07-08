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

@group(0) @binding(0) var<uniform> u: SceneUniforms;
@group(0) @binding(1) var shadowSamp: sampler;
@group(0) @binding(2) var shadowMap: texture_2d<f32>;

struct VOut {
  @builtin(position) position: vec4f,
  @location(0) worldNormal: vec3f,
  @location(1) shadowCoord: vec3f,
};

@vertex fn vs(@location(0) pos: vec3f, @location(1) norm: vec3f) -> VOut {
  let lightClip = u.lightViewProj * vec4f(pos, 1.0);
  let shadowCoord = vec3f(
    lightClip.x / lightClip.w * 0.5 + 0.5,
    lightClip.y / lightClip.w * -0.5 + 0.5,
    lightClip.z / lightClip.w,
  );

  var out: VOut;
  out.position = u.viewProj * vec4f(pos, 1.0);
  out.worldNormal = norm;
  out.shadowCoord = shadowCoord;
  return out;
}

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

  let bias = 0.003;
  let shadow = pcfShadow(v.shadowCoord, bias);

  let shadowStrength = 0.55;
  let lit = u.ambient + ndotl * (1.0 - shadowStrength + shadowStrength * shadow);
  let color = vec3f(0.72, 0.68, 0.62);

  return vec4f(color * lit, 1.0);
}
