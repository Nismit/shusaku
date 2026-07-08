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
  @location(0) worldPos: vec3f,
  @location(1) shadowCoord: vec3f,
};

@vertex fn vs(@location(0) pos: vec3f) -> VOut {
  let s = u.groundSize;
  let worldPos = vec3f(pos.x * s, 0.0, pos.z * s);

  let lightClip = u.lightViewProj * vec4f(worldPos, 1.0);
  let shadowCoord = vec3f(
    lightClip.x / lightClip.w * 0.5 + 0.5,
    lightClip.y / lightClip.w * -0.5 + 0.5,
    lightClip.z / lightClip.w,
  );

  var out: VOut;
  out.position = u.viewProj * vec4f(worldPos, 1.0);
  out.worldPos = worldPos;
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
  let bias = 0.003;
  let shadow = pcfShadow(v.shadowCoord, bias);

  let groundColor = vec3f(0.72, 0.70, 0.66);
  let shadowStrength = 0.4;
  let col = groundColor * (1.0 - shadowStrength * (1.0 - shadow));

  return vec4f(col, 1.0);
}
