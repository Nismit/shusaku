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

fn rotateByQuat(v: vec3f, q: vec4f) -> vec3f {
  return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v);
}

struct VOut {
  @builtin(position) position: vec4f,
  @location(0) worldPos: vec3f,
  @location(1) worldNormal: vec3f,
  @location(2) @interpolate(flat) material: f32,
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
  out.material = inst.material;
  return out;
}

fn materialColor(material: u32) -> vec3f {
  switch material {
    case 0u: { return vec3f(0.22, 0.23, 0.25); }
    case 1u: { return vec3f(0.18, 0.19, 0.22); }
    case 2u: { return vec3f(0.15, 0.16, 0.18); }
    case 3u: { return vec3f(0.52, 0.54, 0.57); }
    case 4u: { return vec3f(0.27, 0.29, 0.32); }
    case 5u: { return vec3f(0.72, 0.88, 1.0); }
    case 6u: { return vec3f(0.075, 0.08, 0.095); }
    default: { return vec3f(0.5); }
  }
  return vec3f(0.5);
}

fn contactShadow(p: vec3f) -> f32 {
  let pedestalDelta = max(abs(p.xz) - vec2f(1.45), vec2f(0.0));
  let pedestal = 1.0 - smoothstep(0.0, 0.55, length(pedestalDelta));
  let psu = 1.0 - smoothstep(0.12, 0.65, distance(p.xz, vec2f(1.375, 0.6)));
  return 1.0 - max(pedestal * 0.18, psu * 0.12);
}

@fragment fn fs(v: VOut) -> @location(0) vec4f {
  let material = u32(v.material + 0.5);
  if (material == 5u) {
    return vec4f(materialColor(material), 1.0);
  }

  let n = normalize(v.worldNormal);
  let l = normalize(u.lightDir);
  let viewDir = normalize(u.cameraPos - v.worldPos);
  let diffuse = max(dot(n, l), 0.0);
  let hemi = n.y * 0.5 + 0.5;
  let base = materialColor(material);
  var light = u.ambient + diffuse * 0.58 + hemi * 0.12;

  if (material == 0u && n.y > 0.8) {
    light *= contactShadow(v.worldPos);
  }

  var color = base * light;
  if (material == 1u || material == 2u) {
    let halfDir = normalize(l + viewDir);
    let specular = pow(max(dot(n, halfDir), 0.0), 28.0);
    color += vec3f(specular * 0.18);
  }

  color = color / (color + vec3f(0.72));
  color = pow(color, vec3f(1.0 / 2.2));
  return vec4f(color, 1.0);
}
