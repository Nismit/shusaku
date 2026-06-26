// シャドウマップ生成 (ライト視点のデプスを R チャンネルに格納)
// インスタンスドquad。orthographic 投影なので w=1。

struct ShadowParams {
  lightViewProj: mat4x4<f32>,
  shadowPointSize: f32,
  shadowMapSize: f32,
  depthOffset: f32,
  _pad: f32,
};

@group(0) @binding(0) var<storage, read> positions: array<vec4<f32>>;
@group(0) @binding(1) var<uniform> s: ShadowParams;

struct VOut {
  @builtin(position) position: vec4<f32>,
  @location(0) corner: vec2<f32>,
  @location(1) life: f32,
};

@vertex
fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  let posData = positions[ii];
  let pos = posData.xyz;
  let life = posData.w;

  let fadeIn = smoothstep(0.0, 0.18, life);
  let fadeOut = smoothstep(0.0, 0.08, 1.0 - life);
  let pointPx = s.shadowPointSize * fadeIn * fadeOut;

  var clip = s.lightViewProj * vec4<f32>(pos, 1.0);
  clip.z += s.depthOffset;

  var corners = array<vec2<f32>, 4>(
    vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, -1.0),
    vec2<f32>(-1.0, 1.0), vec2<f32>(1.0, 1.0)
  );
  let corner = corners[vi];

  // ortho なので w=1: ピクセルサイズ -> クリップオフセット
  let offset = corner * pointPx / s.shadowMapSize;

  var out: VOut;
  out.position = vec4<f32>(clip.x + offset.x, clip.y + offset.y, clip.z, clip.w);
  out.corner = corner;
  out.life = life;
  return out;
}

@fragment
fn fs(in: VOut) -> @location(0) vec4<f32> {
  if (dot(in.corner, in.corner) > 1.0) { discard; }
  if (in.life < 0.01 || in.life > 0.99) { discard; }
  return vec4<f32>(in.position.z, 0.0, 0.0, 1.0);
}
