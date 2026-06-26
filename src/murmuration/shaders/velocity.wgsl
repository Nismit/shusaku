// スクリーンスペース速度バッファ (モーションブラー用)
// 現在位置と前フレーム位置を投影し、画面上の移動ベクトルを RG に出力。

struct Camera {
  resolution: vec2<f32>,
  rotation: vec2<f32>,
  zoom: f32,
  particleSize: f32,
  _pad0: f32,
  _pad1: f32,
};

@group(0) @binding(0) var<storage, read> positions: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read> prevPositions: array<vec4<f32>>;
@group(0) @binding(2) var<uniform> cam: Camera;

struct VOut {
  @builtin(position) position: vec4<f32>,
  @location(0) corner: vec2<f32>,
  @location(1) motion: vec2<f32>,
  @location(2) life: f32,
};

fn rotateX(angle: f32) -> mat3x3<f32> {
  let c = cos(angle);
  let s = sin(angle);
  return mat3x3<f32>(1.0, 0.0, 0.0, 0.0, c, -s, 0.0, s, c);
}

fn rotateY(angle: f32) -> mat3x3<f32> {
  let c = cos(angle);
  let s = sin(angle);
  return mat3x3<f32>(c, 0.0, s, 0.0, 1.0, 0.0, -s, 0.0, c);
}

// 投影 (particle.wgsl と同じ規約、w=1)
fn projectPoint(pos: vec3<f32>, cameraRot: mat3x3<f32>) -> vec4<f32> {
  let viewPos = cameraRot * pos;
  let fov = 1.5;
  let z = viewPos.z + 3.0;
  let perspective = fov / max(z, 0.1);
  var projected = viewPos.xy * perspective * cam.zoom;
  projected.x *= cam.resolution.y / cam.resolution.x;
  let depth = (viewPos.z + 3.0) / 6.0;
  return vec4<f32>(projected, depth, 1.0);
}

@vertex
fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  let posData = positions[ii];
  let prevData = prevPositions[ii];
  let life = posData.w;

  let texCoord = vec2<f32>(
    (f32(ii % 512u) + 0.5) / 512.0,
    (f32(ii / 512u) + 0.5) / 512.0
  );
  let rnd = fract(sin(dot(texCoord, vec2<f32>(12.9898, 78.233))) * 43758.5453);
  let sizeRandom = mix(0.75, 2.0, pow(rnd, 5.0));

  let cameraRot = rotateX(cam.rotation.x) * rotateY(cam.rotation.y);
  let currClip = projectPoint(posData.xyz, cameraRot);
  let prevClip = projectPoint(prevData.xyz, cameraRot);

  let viewPos = cameraRot * posData.xyz;
  let perspective = 1.5 / max(viewPos.z + 3.0, 0.1);
  let fadeIn = smoothstep(0.0, 0.18, life);
  let fadeOut = smoothstep(0.0, 0.08, 1.0 - life);
  let scale = fadeIn * fadeOut;
  let pointPx = max(cam.particleSize * sizeRandom * scale * perspective * cam.zoom, 0.0);

  var corners = array<vec2<f32>, 4>(
    vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, -1.0),
    vec2<f32>(-1.0, 1.0), vec2<f32>(1.0, 1.0)
  );
  let corner = corners[vi];
  let offset = corner * pointPx / cam.resolution;

  let motion = (currClip.xy - prevClip.xy) * 0.5 * step(prevData.w, life);

  var out: VOut;
  out.position = vec4<f32>(currClip.xy + offset, currClip.z, 1.0);
  out.corner = corner;
  out.motion = motion;
  out.life = life;
  return out;
}

@fragment
fn fs(in: VOut) -> @location(0) vec4<f32> {
  if (dot(in.corner, in.corner) > 1.0 || in.life < 0.01) {
    discard;
  }
  return vec4<f32>(in.motion, 0.0, 1.0);
}
