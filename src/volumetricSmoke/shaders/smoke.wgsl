// ボリュメトリック煙の描画 (カメラ視点)
// 各パーティクルを柔らかなガウシアン密度の「パフ (puff)」として描き、
// 順序非依存の加重加算 (weighted OIT) で蓄積する:
//   出力 = vec4(litColor * density, density)  を ONE/ONE 加算
//   後段の composite で avgColor = rgb / a, coverage = 1 - exp(-a * k) を解く。
// ライティングはライト空間の密度マップ (lightdensity.wgsl) をサンプルした
// 透過率 (self-shadow) と、パフ法線によるソフトな指向性シェーディングで与える。

struct VParams {
  lightViewProj: mat4x4<f32>,
  resolution: vec2<f32>,
  rotation: vec2<f32>,
  zoom: f32,
  puffSize: f32,
  lightDir: vec3<f32>,
};

struct FParams {
  lightColor: vec3<f32>,
  ambient: f32,
  absorption: f32,
  scatter: f32,
  lightMapSize: f32,
  shadowSoftness: f32,
  wrap: f32,
  density: f32,
  softness: f32,
  _pad0: f32,
  smokeColorA: vec3<f32>,   // 誕生 (life ≈ 0)
  smokeColorB: vec3<f32>,   // ピーク (life ≈ 0.5)
  smokeColorC: vec3<f32>,   // 消滅 (life ≈ 1)
};

@group(0) @binding(0) var<storage, read> positions: array<vec4<f32>>;
@group(0) @binding(1) var<uniform> v: VParams;
@group(0) @binding(2) var<uniform> f: FParams;
@group(0) @binding(3) var densitySampler: sampler;
@group(0) @binding(4) var densityMap: texture_2d<f32>;

struct VOut {
  @builtin(position) position: vec4<f32>,
  @location(0) corner: vec2<f32>,
  @location(1) life: f32,
  @location(2) color: vec3<f32>,
  @location(3) lightUV: vec2<f32>,
  @location(4) viewLightDir: vec3<f32>,
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

fn sRGBToLinear(c: vec3<f32>) -> vec3<f32> {
  return pow(c, vec3<f32>(2.2));
}

@vertex
fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  let posData = positions[ii];
  let pos = posData.xyz;
  let life = posData.w;

  let texCoord = vec2<f32>(
    (f32(ii % 512u) + 0.5) / 512.0,
    (f32(ii / 512u) + 0.5) / 512.0
  );
  let rnd = fract(sin(dot(texCoord, vec2<f32>(12.9898, 78.233))) * 43758.5453);
  let sizeRandom = mix(0.5, 2.0, pow(rnd, 5.0));

  // ライフサイクルに沿った3点グラデーション: 誕生 → ピーク → 消滅
  let youngPhase = smoothstep(0.0, 0.38, life);
  let oldPhase   = smoothstep(0.52, 0.92, life);
  let color = mix(mix(f.smokeColorA, f.smokeColorB, youngPhase), f.smokeColorC, oldPhase);

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

  let pointPx = max(v.puffSize * sizeRandom * scale * perspective * v.zoom, 0.0);
  let offset = corner * pointPx / v.resolution;

  let lightPos = normalize(v.lightDir) * 3.0;
  let viewLightDir = normalize(cameraRot * (lightPos - pos));

  // ライト空間 UV (ortho: w=1)。密度マップのサンプルに使う。
  let lightClip = v.lightViewProj * vec4<f32>(pos, 1.0);
  let lightUV = vec2<f32>(lightClip.x * 0.5 + 0.5, lightClip.y * -0.5 + 0.5);

  var out: VOut;
  out.position = vec4<f32>(projected + offset, depth, 1.0);
  out.corner = corner;
  out.life = life;
  out.color = color;
  out.lightUV = lightUV;
  out.viewLightDir = viewLightDir;
  return out;
}

// ライト空間密度マップを 5 タップでソフトサンプルし、光源方向の厚みを返す。
fn sampleThickness(uv: vec2<f32>) -> f32 {
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) { return 0.0; }
  let t = (1.0 / f.lightMapSize) * f.shadowSoftness;
  var s = textureSampleLevel(densityMap, densitySampler, uv, 0.0).r * 0.4;
  s += textureSampleLevel(densityMap, densitySampler, uv + vec2<f32>( t, 0.0), 0.0).r * 0.15;
  s += textureSampleLevel(densityMap, densitySampler, uv + vec2<f32>(-t, 0.0), 0.0).r * 0.15;
  s += textureSampleLevel(densityMap, densitySampler, uv + vec2<f32>(0.0,  t), 0.0).r * 0.15;
  s += textureSampleLevel(densityMap, densitySampler, uv + vec2<f32>(0.0, -t), 0.0).r * 0.15;
  return s;
}

@fragment
fn fs(in: VOut) -> @location(0) vec4<f32> {
  let r2 = dot(in.corner, in.corner);
  if (r2 > 1.0 || in.life < 0.01) {
    discard;
  }

  // 柔らかいガウシアンのパフ密度。fade は頂点段で反映済みのスケールと別に
  // フラグメントでも端を落として粒感を消す。
  let fadeIn = smoothstep(0.0, 0.18, in.life);
  let fadeOut = smoothstep(0.0, 0.08, 1.0 - in.life);
  let puff = exp(-r2 * f.softness);
  let density = puff * fadeIn * fadeOut * f.density;
  if (density < 1e-4) { discard; }

  // パフ球面の法線 (ビルボード) — ソフトな指向性シェーディング用。
  let zc = sqrt(max(1.0 - r2, 0.0));
  let normal = vec3<f32>(in.corner, zc);

  let baseColor = sRGBToLinear(in.color);
  let lightCol = sRGBToLinear(f.lightColor);

  // self-shadow: ライト空間の厚みから透過率を求める。自己寄与を差し引いて
  // 孤立した薄いパフが過剰に暗くならないようにする。
  let thick = sampleThickness(in.lightUV);
  let transmit = exp(-max(thick - density * 0.5, 0.0) * f.absorption);

  // 光源方向へのソフトなラップライティング (立体感)。
  let ndl = dot(normal, normalize(in.viewLightDir)) * 0.5 + 0.5;
  let form = mix(1.0, ndl, f.wrap);

  let received = lightCol * (transmit * f.scatter);
  let lit = baseColor * (f.ambient + received) * form;

  // 加重加算: 色は density で重み付けし、A に density を蓄積。
  return vec4<f32>(lit * density, density);
}
