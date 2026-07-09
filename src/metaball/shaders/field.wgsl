struct Params {
  gridSize: u32,
  numBalls: u32,
  _pad0: u32,
  _pad1: u32,
}

struct Ball {
  position: vec3f,
  radius: f32,
}

@group(0) @binding(0) var<storage, read_write> field: array<f32>;
@group(0) @binding(1) var<uniform> params: Params;
@group(0) @binding(2) var<storage, read> balls: array<Ball>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let gs = params.gridSize + 1u;
  let total = gs * gs * gs;
  let idx = id.x;
  if (idx >= total) { return; }

  let x = idx % gs;
  let y = (idx / gs) % gs;
  let z = idx / (gs * gs);

  let gsf = f32(params.gridSize);
  let worldPos = vec3f(
    f32(x) / gsf * 6.0 - 3.0,
    f32(y) / gsf * 6.0 - 3.0,
    f32(z) / gsf * 6.0 - 3.0,
  );

  var value = 0.0;
  for (var i = 0u; i < params.numBalls; i++) {
    let ball = balls[i];
    let d = worldPos - ball.position;
    let dist2 = dot(d, d) + 0.0001;
    value += ball.radius * ball.radius / dist2;
  }

  field[idx] = value;
}
