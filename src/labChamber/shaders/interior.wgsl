struct SceneUniforms {
  viewProj: mat4x4f,
  cameraPos: vec3f,
  ambient: f32,
  lightDir: vec3f,
  _pad: f32,
};

struct BoxInstance {
  center: vec3f,
  material: f32,
  halfSize: vec3f,
  _pad: f32,
  rotation: vec4f,
};

@group(0) @binding(0) var<uniform> u: SceneUniforms;
@group(0) @binding(1) var<storage, read> instances: array<BoxInstance>;

struct VOut {
  @builtin(position) position: vec4f,
  @location(0) worldPos: vec3f,
  @location(1) @interpolate(flat) center: vec3f,
  @location(2) @interpolate(flat) halfSize: vec3f,
};

@vertex fn vs(
  @location(0) position: vec3f,
  @location(1) normal: vec3f,
  @builtin(instance_index) instanceId: u32,
) -> VOut {
  let inst = instances[instanceId];
  let worldPos = inst.center + position * inst.halfSize * 2.0;
  var out: VOut;
  out.position = u.viewProj * vec4f(worldPos, 1.0);
  out.worldPos = worldPos;
  out.center = inst.center;
  out.halfSize = inst.halfSize;
  return out;
}

fn rayBox(ro: vec3f, rd: vec3f, center: vec3f, halfSize: vec3f) -> vec2f {
  let safeRd = sign(rd) * max(abs(rd), vec3f(0.00001));
  let inv = 1.0 / safeRd;
  let t0 = (center - halfSize - ro) * inv;
  let t1 = (center + halfSize - ro) * inv;
  let near3 = min(t0, t1);
  let far3 = max(t0, t1);
  return vec2f(max(max(near3.x, near3.y), near3.z), min(min(far3.x, far3.y), far3.z));
}

// Add future chamber-only SDFs here. The proxy limits marching to the cube.
fn mapInterior(_p: vec3f) -> f32 {
  return 1000.0;
}

@fragment fn fs(_v: VOut) -> @location(0) vec4f {
  // The interior is intentionally empty for now; keeping this dedicated pass
  // avoids bringing back a full-screen ray marcher when content is added.
  discard;
  return vec4f(0.0);
}
