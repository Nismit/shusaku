// パーティクル初期化 (compute)
// 球面上にランダム配置し、position バッファ (xyz + life) に書き込む。

struct Params {
  count: u32,
  seed: f32,
  spawnRadius: f32,
  _pad: f32,
};

@group(0) @binding(0) var<storage, read_write> positions: array<vec4<f32>>;
@group(0) @binding(1) var<uniform> params: Params;

fn hash(x: u32) -> u32 {
  var v = x;
  v ^= v >> 16u;
  v *= 0x85ebca6bu;
  v ^= v >> 13u;
  v *= 0xc2b2ae35u;
  v ^= v >> 16u;
  return v;
}

fn random(seed: u32) -> f32 {
  return f32(hash(seed)) / f32(0xffffffffu);
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let idx = id.x;
  if (idx >= params.count) { return; }

  let seed = idx * 7u + u32(params.seed);

  let theta = random(seed) * 6.28318;
  let phi = acos(random(seed + 1u) * 2.0 - 1.0);
  let r = pow(random(seed + 2u), 0.333) * params.spawnRadius;

  var pos: vec3<f32>;
  pos.x = r * sin(phi) * cos(theta);
  pos.y = r * sin(phi) * sin(theta);
  pos.z = r * cos(phi);

  let life = random(seed + 3u);

  positions[idx] = vec4<f32>(pos, life);
}
