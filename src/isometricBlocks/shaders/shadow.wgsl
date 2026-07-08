struct ShadowUniforms {
  lightViewProj: mat4x4f,
  gridScale: f32,
  colorMix: f32,
};

struct CubeInstance {
  posX: f32,
  posZ: f32,
  height: f32,
  colorIndex: f32,
  cellScale: f32,
};

@group(0) @binding(0) var<uniform> u: ShadowUniforms;
@group(0) @binding(1) var<storage, read> instances: array<CubeInstance>;

struct VOut {
  @builtin(position) position: vec4f,
  @location(0) depth: f32,
};

@vertex fn vs(
  @location(0) pos: vec3f,
  @location(1) norm: vec3f,
  @builtin(instance_index) iid: u32,
) -> VOut {
  let inst = instances[iid];
  let scaleY = max(inst.height, 0.001);
  let worldPos = vec3f(
    (pos.x + inst.posX) * inst.cellScale,
    pos.y * scaleY * inst.cellScale,
    (pos.z + inst.posZ) * inst.cellScale,
  );
  let clip = u.lightViewProj * vec4f(worldPos, 1.0);
  var out: VOut;
  out.position = clip;
  out.depth = clip.z / clip.w;
  return out;
}

@fragment fn fs(v: VOut) -> @location(0) vec4f {
  return vec4f(v.depth, 0.0, 0.0, 1.0);
}
