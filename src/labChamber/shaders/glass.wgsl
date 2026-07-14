struct SceneUniforms {
  viewProj: mat4x4f,
  cameraPos: vec3f,
  ambient: f32,
  lightDir: vec3f,
  _pad: f32,
};

struct BoxInstance {
  center: vec3f,
  nearPane: f32,
  halfSize: vec3f,
  _pad: f32,
  rotation: vec4f,
};

@group(0) @binding(0) var<uniform> u: SceneUniforms;
@group(0) @binding(1) var<storage, read> instances: array<BoxInstance>;

fn rotateByQuat(v: vec3f, q: vec4f) -> vec3f {
  return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v);
}

struct VOut {
  @builtin(position) position: vec4f,
  @location(0) worldPos: vec3f,
  @location(1) worldNormal: vec3f,
  @location(2) @interpolate(flat) nearPane: f32,
};

@vertex fn vs(
  @location(0) position: vec3f,
  @location(1) normal: vec3f,
  @builtin(instance_index) instanceId: u32,
) -> VOut {
  let inst = instances[instanceId];
  let localPos = position * inst.halfSize * 2.0;
  let worldPos = inst.center + rotateByQuat(localPos, inst.rotation);

  var out: VOut;
  out.position = u.viewProj * vec4f(worldPos, 1.0);
  out.worldPos = worldPos;
  out.worldNormal = rotateByQuat(normal, inst.rotation);
  out.nearPane = inst.nearPane;
  return out;
}

@fragment fn fs(v: VOut) -> @location(0) vec4f {
  let n = normalize(v.worldNormal);
  let viewDir = normalize(u.cameraPos - v.worldPos);
  let fresnel = pow(1.0 - abs(dot(n, viewDir)), 2.2);
  let tint = mix(vec3f(0.15, 0.37, 0.50), vec3f(0.045, 0.34, 0.78), v.nearPane);
  let alpha = mix(0.035, 0.14, v.nearPane) + fresnel * mix(0.075, 0.23, v.nearPane);
  let highlight = pow(max(dot(reflect(-viewDir, n), normalize(vec3f(0.3, 1.0, 0.4))), 0.0), 32.0);
  let color = tint * (0.72 + fresnel * 0.42) + vec3f(highlight * 0.2);
  return vec4f(color, clamp(alpha, 0.0, 0.42));
}
