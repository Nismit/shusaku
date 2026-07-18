// 移流 (advection) — BFECC で誤差補正した半ラグランジュ法 (fullscreen)
// WebGL 版 advection.frag の WGSL 移植。

struct Params {
  texelSize: vec2<f32>,
  dt: f32,
  dissipation: f32,
};

@group(0) @binding(0) var uSampler: sampler;
@group(0) @binding(1) var uSource: texture_2d<f32>;
@group(0) @binding(2) var uVelocity: texture_2d<f32>;
@group(0) @binding(3) var<uniform> p: Params;

@fragment
fn fs(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  let px = p.texelSize;

  // 境界: 1px の壁
  if (uv.x < px.x || uv.x > 1.0 - px.x || uv.y < px.y || uv.y > 1.0 - px.y) {
    return vec4<f32>(0.0);
  }

  // BFECC (Back-and-Forth Error Correction and Compensation)
  let vel0 = textureSampleLevel(uVelocity, uSampler, uv, 0.0).xy;

  // Back trace
  let pos1 = uv - vel0 * p.dt;
  let vel1 = textureSampleLevel(uVelocity, uSampler, pos1, 0.0).xy;

  // Forward trace
  let pos2 = pos1 + vel1 * p.dt;

  // Error correction
  let error = pos2 - uv;
  let pos3 = uv - error * 0.5;
  let vel2 = textureSampleLevel(uVelocity, uSampler, pos3, 0.0).xy;

  // Back trace again with corrected position
  let pos4 = pos3 - vel2 * p.dt;
  let result = textureSampleLevel(uSource, uSampler, pos4, 0.0);

  let decay = 1.0 / (1.0 + p.dissipation * p.dt);
  return result * decay;
}
