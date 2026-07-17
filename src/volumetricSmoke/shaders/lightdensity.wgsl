// ライト視点のボリューム密度マップ生成 (単一散乱の光源側入力)
// 各パーティクルを orthographic なライト空間へ投影し、ソフトなガウシアン密度を
// 加算合成する。得られる R チャンネルは「その方向に積み上がった煙の厚み」の近似で、
// カメラ描画時にこの値から透過率 (self-shadow) を求める。
// インスタンスドquad。ortho 投影なので w=1。

struct LParams {
  lightViewProj: mat4x4<f32>,
  pointSize: f32,
  mapSize: f32,
  densityScale: f32,
  softness: f32,
};

@group(0) @binding(0) var<storage, read> positions: array<vec4<f32>>;
@group(0) @binding(1) var<uniform> p: LParams;

struct VOut {
  @builtin(position) position: vec4<f32>,
  @location(0) corner: vec2<f32>,
  @location(1) life: f32,
  @location(2) sizeRandom: f32,
};

@vertex
fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  let posData = positions[ii];
  let pos = posData.xyz;
  let life = posData.w;

  // particle 描画と同じ 2D ハッシュで粒径のばらつきを合わせる。
  let texCoord = vec2<f32>(
    (f32(ii % 512u) + 0.5) / 512.0,
    (f32(ii / 512u) + 0.5) / 512.0
  );
  let rnd = fract(sin(dot(texCoord, vec2<f32>(12.9898, 78.233))) * 43758.5453);
  let sizeRandom = mix(0.5, 2.0, pow(rnd, 5.0));

  let fadeIn = smoothstep(0.0, 0.18, life);
  let fadeOut = smoothstep(0.0, 0.08, 1.0 - life);
  let pointPx = max(p.pointSize * sizeRandom * fadeIn * fadeOut, 0.0);

  let clip = p.lightViewProj * vec4<f32>(pos, 1.0);

  var corners = array<vec2<f32>, 4>(
    vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, -1.0),
    vec2<f32>(-1.0, 1.0), vec2<f32>(1.0, 1.0)
  );
  let corner = corners[vi];

  // ortho (w=1): ピクセルサイズ -> クリップ空間オフセット
  let offset = corner * pointPx / p.mapSize;

  var out: VOut;
  out.position = vec4<f32>(clip.x + offset.x, clip.y + offset.y, clip.z, 1.0);
  out.corner = corner;
  out.life = life;
  out.sizeRandom = sizeRandom;
  return out;
}

@fragment
fn fs(in: VOut) -> @location(0) vec4<f32> {
  let r2 = dot(in.corner, in.corner);
  if (r2 > 1.0 || in.life < 0.01 || in.life > 0.99) { discard; }

  let fadeIn = smoothstep(0.0, 0.18, in.life);
  let fadeOut = smoothstep(0.0, 0.08, 1.0 - in.life);
  let density = exp(-r2 * p.softness) * fadeIn * fadeOut * p.densityScale;

  // R に密度を加算 (加算ブレンド)。他チャンネルは未使用。
  return vec4<f32>(density, 0.0, 0.0, density);
}
