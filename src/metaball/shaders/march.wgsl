struct Params {
  gridSize: u32,
  numBalls: u32,
  maxVertices: u32,
  threshold: f32,
}

struct Ball {
  position: vec3f,
  radius: f32,
}

@group(0) @binding(0) var<storage, read> field: array<f32>;
@group(0) @binding(1) var<uniform> params: Params;
@group(0) @binding(2) var<storage, read> edgeTable: array<u32>;
@group(0) @binding(3) var<storage, read> triTable: array<i32>;
@group(0) @binding(4) var<storage, read_write> vertices: array<f32>;
@group(0) @binding(5) var<storage, read_write> indirect: array<atomic<u32>>;
@group(0) @binding(6) var<storage, read> balls: array<Ball>;

fn fieldIdx(x: u32, y: u32, z: u32) -> u32 {
  let gs = params.gridSize + 1u;
  return x + y * gs + z * gs * gs;
}

fn toWorld(x: u32, y: u32, z: u32) -> vec3f {
  let gs = f32(params.gridSize);
  return vec3f(f32(x) / gs * 4.0 - 2.0, f32(y) / gs * 4.0 - 2.0, f32(z) / gs * 4.0 - 2.0);
}

fn computeNormal(p: vec3f) -> vec3f {
  var grad = vec3f(0.0);
  for (var i = 0u; i < params.numBalls; i++) {
    let ball = balls[i];
    let d = p - ball.position;
    let dist2 = dot(d, d) + 0.0001;
    grad += -2.0 * ball.radius * ball.radius * d / (dist2 * dist2);
  }
  let len = length(grad);
  if (len < 0.0001) { return vec3f(0.0, 1.0, 0.0); }
  return -grad / len;
}

fn interpolate(p1: vec3f, p2: vec3f, v1: f32, v2: f32) -> vec3f {
  let dv = v2 - v1;
  let t = select((params.threshold - v1) / dv, 0.5, abs(dv) < 0.0001);
  return mix(p1, p2, clamp(t, 0.0, 1.0));
}

fn writeVertex(baseF: u32, pos: vec3f, n: vec3f) {
  vertices[baseF]      = pos.x;
  vertices[baseF + 1u] = pos.y;
  vertices[baseF + 2u] = pos.z;
  vertices[baseF + 3u] = n.x;
  vertices[baseF + 4u] = n.y;
  vertices[baseF + 5u] = n.z;
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let gs = params.gridSize;
  let cellIdx = id.x;
  if (cellIdx >= gs * gs * gs) { return; }

  let cx = cellIdx % gs;
  let cy = (cellIdx / gs) % gs;
  let cz = cellIdx / (gs * gs);

  let vals = array<f32, 8>(
    field[fieldIdx(cx,     cy,     cz    )],
    field[fieldIdx(cx + 1, cy,     cz    )],
    field[fieldIdx(cx + 1, cy + 1, cz    )],
    field[fieldIdx(cx,     cy + 1, cz    )],
    field[fieldIdx(cx,     cy,     cz + 1)],
    field[fieldIdx(cx + 1, cy,     cz + 1)],
    field[fieldIdx(cx + 1, cy + 1, cz + 1)],
    field[fieldIdx(cx,     cy + 1, cz + 1)],
  );

  var cubeIndex = 0u;
  if (vals[0] > params.threshold) { cubeIndex |= 1u; }
  if (vals[1] > params.threshold) { cubeIndex |= 2u; }
  if (vals[2] > params.threshold) { cubeIndex |= 4u; }
  if (vals[3] > params.threshold) { cubeIndex |= 8u; }
  if (vals[4] > params.threshold) { cubeIndex |= 16u; }
  if (vals[5] > params.threshold) { cubeIndex |= 32u; }
  if (vals[6] > params.threshold) { cubeIndex |= 64u; }
  if (vals[7] > params.threshold) { cubeIndex |= 128u; }

  let edges = edgeTable[cubeIndex];
  if (edges == 0u) { return; }

  let corners = array<vec3f, 8>(
    toWorld(cx,     cy,     cz    ),
    toWorld(cx + 1, cy,     cz    ),
    toWorld(cx + 1, cy + 1, cz    ),
    toWorld(cx,     cy + 1, cz    ),
    toWorld(cx,     cy,     cz + 1),
    toWorld(cx + 1, cy,     cz + 1),
    toWorld(cx + 1, cy + 1, cz + 1),
    toWorld(cx,     cy + 1, cz + 1),
  );

  var ev: array<vec3f, 12>;
  if ((edges & 1u)    != 0u) { ev[0]  = interpolate(corners[0], corners[1], vals[0], vals[1]); }
  if ((edges & 2u)    != 0u) { ev[1]  = interpolate(corners[1], corners[2], vals[1], vals[2]); }
  if ((edges & 4u)    != 0u) { ev[2]  = interpolate(corners[2], corners[3], vals[2], vals[3]); }
  if ((edges & 8u)    != 0u) { ev[3]  = interpolate(corners[3], corners[0], vals[3], vals[0]); }
  if ((edges & 16u)   != 0u) { ev[4]  = interpolate(corners[4], corners[5], vals[4], vals[5]); }
  if ((edges & 32u)   != 0u) { ev[5]  = interpolate(corners[5], corners[6], vals[5], vals[6]); }
  if ((edges & 64u)   != 0u) { ev[6]  = interpolate(corners[6], corners[7], vals[6], vals[7]); }
  if ((edges & 128u)  != 0u) { ev[7]  = interpolate(corners[7], corners[4], vals[7], vals[4]); }
  if ((edges & 256u)  != 0u) { ev[8]  = interpolate(corners[0], corners[4], vals[0], vals[4]); }
  if ((edges & 512u)  != 0u) { ev[9]  = interpolate(corners[1], corners[5], vals[1], vals[5]); }
  if ((edges & 1024u) != 0u) { ev[10] = interpolate(corners[2], corners[6], vals[2], vals[6]); }
  if ((edges & 2048u) != 0u) { ev[11] = interpolate(corners[3], corners[7], vals[3], vals[7]); }

  let triBase = cubeIndex * 16u;
  for (var i = 0u; i < 15u; i += 3u) {
    let e0 = triTable[triBase + i];
    if (e0 < 0) { break; }
    let e1 = triTable[triBase + i + 1u];
    let e2 = triTable[triBase + i + 2u];

    let p0 = ev[e0]; let p1 = ev[e1]; let p2 = ev[e2];

    let vertIdx = atomicAdd(&indirect[0], 3u);
    if (vertIdx + 3u > params.maxVertices) { return; }

    writeVertex(vertIdx * 6u,       p0, computeNormal(p0));
    writeVertex((vertIdx + 1u) * 6u, p1, computeNormal(p1));
    writeVertex((vertIdx + 2u) * 6u, p2, computeNormal(p2));
  }
}
