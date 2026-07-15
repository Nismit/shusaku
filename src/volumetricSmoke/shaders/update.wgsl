// パーティクル更新 (compute)
// 4D シンプレックスノイズ由来のカールノイズで各パーティクルを移流。
// positionsIn (read) -> positionsOut (write) のピンポン方式。

struct Params {
  count: u32,
  time: f32,
  deltaFrames: f32,
  noiseScale: f32,
  noiseStrength: f32,
  lifetime: f32,
  expandSpeed: f32,
  _pad0: f32,
  burst: vec4<f32>,        // xyz = タップ位置(世界座標), w = 経過時間
  burstParams: vec4<f32>,  // x = 強さ, y = 波の速度, z = 殻の厚み, w = 減衰率
};

@group(0) @binding(0) var<storage, read> positionsIn: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read_write> positionsOut: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> defaultPositions: array<vec4<f32>>;
@group(0) @binding(3) var<uniform> params: Params;

// --- 4D Simplex Noise with Analytical Derivatives ---

fn mod289v(x: vec4<f32>) -> vec4<f32> {
  return x - floor(x * (1.0 / 289.0)) * 289.0;
}

fn mod289f(x: f32) -> f32 {
  return x - floor(x * (1.0 / 289.0)) * 289.0;
}

fn permutev(x: vec4<f32>) -> vec4<f32> {
  return mod289v(((x * 34.0) + 1.0) * x);
}

fn permutef(x: f32) -> f32 {
  return mod289f(((x * 34.0) + 1.0) * x);
}

fn taylorInvSqrtv(r: vec4<f32>) -> vec4<f32> {
  return 1.79284291400159 - 0.85373472095314 * r;
}

fn taylorInvSqrtf(r: f32) -> f32 {
  return 1.79284291400159 - 0.85373472095314 * r;
}

fn grad4(j: f32, ip: vec4<f32>) -> vec4<f32> {
  let ones = vec4<f32>(1.0, 1.0, 1.0, -1.0);
  var p: vec4<f32>;
  var s: vec4<f32>;
  let pxyz = floor(fract(vec3<f32>(j) * ip.xyz) * 7.0) * ip.z - 1.0;
  p = vec4<f32>(pxyz, 0.0);
  p.w = 1.5 - dot(abs(p.xyz), ones.xyz);
  s = vec4<f32>(vec4<bool>(p.x < 0.0, p.y < 0.0, p.z < 0.0, p.w < 0.0));
  let adj = p.xyz + (s.xyz * 2.0 - 1.0) * s.www;
  p = vec4<f32>(adj, p.w);
  return p;
}

const F4: f32 = 0.309016994374947451;

fn simplexNoiseDerivatives(v: vec4<f32>) -> vec4<f32> {
  let C = vec4<f32>(
    0.138196601125011,
    0.276393202250021,
    0.414589803375032,
    -0.447213595499958
  );

  var i = floor(v + dot(v, vec4<f32>(F4)));
  let x0 = v - i + dot(i, C.xxxx);

  var i0: vec4<f32>;
  let isX = step(x0.yzw, x0.xxx);
  let isYZ = step(x0.zww, x0.yyz);
  i0.x = isX.x + isX.y + isX.z;
  i0 = vec4<f32>(i0.x, 1.0 - isX);
  i0.y += isYZ.x + isYZ.y;
  let zw = i0.zw + (1.0 - isYZ.xy);
  i0.z = zw.x;
  i0.w = zw.y;
  i0.z += isYZ.z;
  i0.w += 1.0 - isYZ.z;

  let i3 = clamp(i0, vec4<f32>(0.0), vec4<f32>(1.0));
  let i2 = clamp(i0 - 1.0, vec4<f32>(0.0), vec4<f32>(1.0));
  let i1 = clamp(i0 - 2.0, vec4<f32>(0.0), vec4<f32>(1.0));

  let x1 = x0 - i1 + C.xxxx;
  let x2 = x0 - i2 + C.yyyy;
  let x3 = x0 - i3 + C.zzzz;
  let x4 = x0 + C.wwww;

  i = mod289v(i);
  let j0 = permutef(permutef(permutef(permutef(i.w) + i.z) + i.y) + i.x);
  let j1 = permutev(permutev(permutev(permutev(
      i.w + vec4<f32>(i1.w, i2.w, i3.w, 1.0))
    + i.z + vec4<f32>(i1.z, i2.z, i3.z, 1.0))
    + i.y + vec4<f32>(i1.y, i2.y, i3.y, 1.0))
    + i.x + vec4<f32>(i1.x, i2.x, i3.x, 1.0));

  let ip = vec4<f32>(1.0 / 294.0, 1.0 / 49.0, 1.0 / 7.0, 0.0);

  var p0 = grad4(j0, ip);
  var p1 = grad4(j1.x, ip);
  var p2 = grad4(j1.y, ip);
  var p3 = grad4(j1.z, ip);
  var p4 = grad4(j1.w, ip);

  let norm = taylorInvSqrtv(vec4<f32>(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x;
  p1 *= norm.y;
  p2 *= norm.z;
  p3 *= norm.w;
  p4 *= taylorInvSqrtf(dot(p4, p4));

  let values0 = vec3<f32>(dot(p0, x0), dot(p1, x1), dot(p2, x2));
  let values1 = vec2<f32>(dot(p3, x3), dot(p4, x4));

  let m0 = max(0.5 - vec3<f32>(dot(x0, x0), dot(x1, x1), dot(x2, x2)), vec3<f32>(0.0));
  let m1 = max(0.5 - vec2<f32>(dot(x3, x3), dot(x4, x4)), vec2<f32>(0.0));

  let temp0 = -6.0 * m0 * m0 * values0;
  let temp1 = -6.0 * m1 * m1 * values1;

  let mmm0 = m0 * m0 * m0;
  let mmm1 = m1 * m1 * m1;

  let dx = temp0[0] * x0.x + temp0[1] * x1.x + temp0[2] * x2.x + temp1[0] * x3.x + temp1[1] * x4.x + mmm0[0] * p0.x + mmm0[1] * p1.x + mmm0[2] * p2.x + mmm1[0] * p3.x + mmm1[1] * p4.x;
  let dy = temp0[0] * x0.y + temp0[1] * x1.y + temp0[2] * x2.y + temp1[0] * x3.y + temp1[1] * x4.y + mmm0[0] * p0.y + mmm0[1] * p1.y + mmm0[2] * p2.y + mmm1[0] * p3.y + mmm1[1] * p4.y;
  let dz = temp0[0] * x0.z + temp0[1] * x1.z + temp0[2] * x2.z + temp1[0] * x3.z + temp1[1] * x4.z + mmm0[0] * p0.z + mmm0[1] * p1.z + mmm0[2] * p2.z + mmm1[0] * p3.z + mmm1[1] * p4.z;
  let dw = temp0[0] * x0.w + temp0[1] * x1.w + temp0[2] * x2.w + temp1[0] * x3.w + temp1[1] * x4.w + mmm0[0] * p0.w + mmm0[1] * p1.w + mmm0[2] * p2.w + mmm1[0] * p3.w + mmm1[1] * p4.w;

  return vec4<f32>(dx, dy, dz, dw) * 49.0;
}

// --- 3 オクターブ FBM ベースのカールノイズ ---
fn curl(p: vec3<f32>, noiseTime: f32, persistence: f32) -> vec3<f32> {
  var xDeriv = vec4<f32>(0.0);
  var yDeriv = vec4<f32>(0.0);
  var zDeriv = vec4<f32>(0.0);

  for (var i = 0; i < 3; i++) {
    let twoPowI = pow(2.0, f32(i));
    let scale = 0.5 * twoPowI * pow(persistence, f32(i));

    xDeriv += simplexNoiseDerivatives(vec4<f32>(p * twoPowI, noiseTime)) * scale;
    yDeriv += simplexNoiseDerivatives(vec4<f32>((p + vec3<f32>(123.4, 129845.6, -1239.1)) * twoPowI, noiseTime)) * scale;
    zDeriv += simplexNoiseDerivatives(vec4<f32>((p + vec3<f32>(-9519.0, 9051.0, -123.0)) * twoPowI, noiseTime)) * scale;
  }

  return vec3<f32>(
    zDeriv[1] - yDeriv[2],
    xDeriv[2] - zDeriv[0],
    yDeriv[0] - xDeriv[1]
  );
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let idx = id.x;
  if (idx >= params.count) { return; }

  let posData = positionsIn[idx];
  var pos = posData.xyz;
  var life = posData.w;

  let lifeStep = 1.0 / (params.lifetime * 60.0);
  life += lifeStep * params.deltaFrames;

  if (life >= 1.0) {
    let defaultPos = defaultPositions[idx];
    pos = defaultPos.xyz;
    life = fract(defaultPos.w * 21.4131 + params.time) * 0.02;
  }

  let radialDir = normalize(pos + vec3<f32>(0.0001));
  pos += radialDir * params.expandSpeed * params.deltaFrames;

  let birthPhase = 1.0 - smoothstep(0.08, 0.30, life);
  let curlPhase = smoothstep(0.12, 0.35, life) * (1.0 - smoothstep(0.72, 0.96, life));
  let decayPhase = smoothstep(0.68, 0.96, life);

  // ドメインワーピング: 粗いスケール・遅い時間のカールで座標を歪めてからメインカールをサンプリング。
  // 渦の内部が折り畳まれた複雑な形状（銀河腕・雲状）になる。
  let persistence = 0.15 + life * 0.15;
  let warp = curl(pos * params.noiseScale * 0.38, params.time * 0.21, 0.28);
  let warpedPos = pos + warp * 0.17;
  var flow = curl(warpedPos * params.noiseScale, params.time, persistence);
  flow /= sqrt(length(flow) + 1e-4);

  // ねじれヘリックス: スワール方向が高さ (pos.y) に応じて回転し、螺旋状の軌跡を生む。
  // 単純な水平スワールよりも立体感・非対称性が出る。
  let helixAngle = pos.y * 2.8 + params.time * 0.19;
  let helixDir = normalize(vec3<f32>(-sin(helixAngle), 0.22, cos(helixAngle)));

  let radialFlow = radialDir * birthPhase - radialDir * decayPhase * 0.55;
  flow = flow * mix(0.40, 1.05, curlPhase)
       + helixDir * mix(0.12, 0.40, curlPhase)
       + radialFlow * 0.65;

  pos += flow * params.noiseStrength * params.deltaFrames;

  // タップ衝撃波: タップ位置を中心に膨張する球殻が粒を外側へ押し出す。
  // 波面 (waveR) は時間とともに広がり、時間減衰でリップルがフェードする。
  let burstStrength = params.burstParams.x;
  if (burstStrength > 0.0) {
    let toP = pos - params.burst.xyz;
    let d = length(toP) + 1e-5;
    let dir = toP / d;
    let age = params.burst.w;
    let waveR = params.burstParams.y * age;
    let shell = exp(-pow((d - waveR) / max(params.burstParams.z, 1e-3), 2.0));
    let decay = exp(-age * params.burstParams.w);
    pos += dir * (burstStrength * shell * decay) * params.deltaFrames;
  }

  positionsOut[idx] = vec4<f32>(pos, life);
}
