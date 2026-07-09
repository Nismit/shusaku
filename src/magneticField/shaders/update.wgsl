struct UpdateParams {
  count: u32,
  time: f32,
  deltaFrames: f32,
  poleCount: u32,
  speed: f32,
  maxSpeed: f32,
  lifetime: f32,
  spawnRadius: f32,
  poles: array<vec4<f32>, 8>,
};

@group(0) @binding(0) var<storage, read> positionsIn: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read_write> positionsOut: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> defaultPositions: array<vec4<f32>>;
@group(0) @binding(3) var<uniform> params: UpdateParams;
@group(0) @binding(4) var<storage, read_write> auxOut: array<vec4<f32>>;

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

  let posData = positionsIn[idx];
  var pos = posData.xyz;
  var life = posData.w;

  let lifeStep = 1.0 / (params.lifetime * 60.0);
  life += lifeStep * params.deltaFrames;

  if (life >= 1.0) {
    let defPos = defaultPositions[idx];
    pos = defPos.xyz;
    life = fract(defPos.w * 21.4131 + params.time) * 0.02;
  }

  var B = vec3<f32>(0.0);
  for (var i = 0u; i < params.poleCount; i++) {
    let polePos = params.poles[i].xyz;
    let charge = params.poles[i].w;
    let r = pos - polePos;
    let d2 = dot(r, r);
    let safeD = max(sqrt(d2), 0.02);
    B += charge * r / (safeD * safeD * safeD);
  }

  let fieldStrength = length(B);
  let fieldDir = B / max(fieldStrength, 1e-6);
  let speed = clamp(fieldStrength * params.speed, 0.0, params.maxSpeed);
  pos += fieldDir * speed * params.deltaFrames;

  // 極に近すぎたら吸収→リスポーン
  var absorbed = false;
  for (var i = 0u; i < params.poleCount; i++) {
    if (length(pos - params.poles[i].xyz) < 0.018) {
      absorbed = true;
      break;
    }
  }
  if (absorbed) {
    let seed = idx * 13u + u32(params.time * 1000.0);
    let theta = random(seed) * 6.28318;
    let phi = acos(random(seed + 1u) * 2.0 - 1.0);
    let rr = pow(random(seed + 2u), 0.333) * params.spawnRadius;
    pos = vec3<f32>(
      rr * sin(phi) * cos(theta),
      rr * sin(phi) * sin(theta),
      rr * cos(phi),
    );
    life = 0.0;
  }

  // サドルポイント停滞を回避する微小擾乱
  let nSeed = idx * 3u + u32(params.time * 60.0);
  let nx = random(nSeed) - 0.5;
  let ny = random(nSeed + 1u) - 0.5;
  let nz = random(nSeed + 2u) - 0.5;
  pos += vec3<f32>(nx, ny, nz) * 0.00004 * params.deltaFrames;

  // どの極グループが支配的かを計算（0-1: primary, 2+: secondary）
  var primaryStr = 0.0;
  var secondaryStr = 0.0;
  for (var j = 0u; j < params.poleCount; j++) {
    let d = length(pos - params.poles[j].xyz);
    let s = abs(params.poles[j].w) / max(d * d, 0.0004);
    if (j < 2u) {
      primaryStr += s;
    } else {
      secondaryStr += s;
    }
  }
  let colorMix = secondaryStr / max(primaryStr + secondaryStr, 1e-6);

  positionsOut[idx] = vec4<f32>(pos, life);
  auxOut[idx] = vec4<f32>(colorMix, 0.0, 0.0, 0.0);
}
