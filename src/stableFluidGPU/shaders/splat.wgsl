// 速度/染料フィールドへガウシアンの「点」を加算する (fullscreen)
// WebGL 版 splat.frag の WGSL 移植。

struct Params {
  point: vec2<f32>,   // 注入位置 (uv, 0..1)
  radius: f32,        // ガウシアンの広がり
  aspect: f32,        // canvas のアスペクト比 (円形補正)
  color: vec3<f32>,   // 加算する値 (速度 or 染料色)
  _pad: f32,
};

@group(0) @binding(0) var uSampler: sampler;
@group(0) @binding(1) var uTarget: texture_2d<f32>;
@group(0) @binding(2) var<uniform> p: Params;

@fragment
fn fs(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  var d = uv - p.point;
  d.x *= p.aspect;
  let g = exp(-dot(d, d) / p.radius);
  let base = textureSampleLevel(uTarget, uSampler, uv, 0.0).rgb;
  return vec4<f32>(base + p.color * g, 1.0);
}
