struct Scene {
  viewProj: mat4x4f,
  lightViewProj: mat4x4f,
  lightDir: vec3f,
  ambient: f32,
  shadowMapSize: f32,
  pcfRadius: f32,
  shadowStrength: f32,
  time: f32,
};

@group(0) @binding(0) var<uniform> u: Scene;
@group(0) @binding(1) var<storage, read> parts: array<mat4x4f>;
@group(0) @binding(2) var shadowSamp: sampler;
@group(0) @binding(3) var shadowMap: texture_2d<f32>;

// Pre-gamma values. Primary-heavy so the machine reads as a graphic object,
// not a rendering. Index order must match the C_* constants in main.js.
const PALETTE = array<vec3f, 7>(
  vec3f(0.965, 0.950, 0.915), // 0 off-white
  vec3f(0.860, 0.130, 0.105), // 1 red
  vec3f(0.960, 0.735, 0.100), // 2 yellow
  vec3f(0.085, 0.200, 0.660), // 3 blue
  vec3f(0.095, 0.090, 0.085), // 4 ink
  vec3f(0.830, 0.810, 0.755), // 5 plate
  vec3f(0.430, 0.410, 0.380), // 6 steel
);

struct VOut {
  @builtin(position) position: vec4f,
  @location(0) worldNormal: vec3f,
  @location(1) shadowCoord: vec3f,
  @location(2) color: vec3f,
};

@vertex fn vs(
  @location(0) pos: vec3f,
  @location(1) norm: vec3f,
  @location(2) partId: f32,
  @location(3) colorIdx: f32,
) -> VOut {
  let m = parts[u32(partId)];
  let world = m * vec4f(pos, 1.0);
  let lclip = u.lightViewProj * world;

  var out: VOut;
  out.position = u.viewProj * world;
  out.worldNormal = (m * vec4f(norm, 0.0)).xyz;
  // The light uses an orthographic projection, so w is always 1 here.
  out.shadowCoord = vec3f(lclip.xy * vec2f(0.5, -0.5) + vec2f(0.5), lclip.z);
  out.color = PALETTE[min(u32(colorIdx), 6u)];
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

  let shadow = pcfShadow(v.shadowCoord, 0.0035);
  let lit = u.ambient + ndotl * (1.0 - u.shadowStrength + u.shadowStrength * shadow);

  // Warm key, cool shade. Keeps a flat primary palette from going muddy where
  // it falls off, which is the usual failure mode of single-light flat shading.
  let warm = vec3f(1.05, 1.01, 0.93);
  let cool = vec3f(0.85, 0.89, 1.03);
  let tint = mix(cool, warm, saturate(ndotl * shadow));

  var col = v.color * lit * tint;
  col += v.color * max(n.y, 0.0) * 0.07; // sky bounce on up-facing edges

  return vec4f(col, 1.0);
}
