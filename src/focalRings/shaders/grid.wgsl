struct Uniforms {
  viewProj: mat4x4f,
  cameraPos: vec3f,
  farPlane: f32,
  time: f32,
};

@group(0) @binding(0) var<uniform> u: Uniforms;

struct VOut {
  @builtin(position) position: vec4f,
  @location(0) worldPos: vec3f,
};

@vertex fn vs(@location(0) pos: vec3f, @location(1) alpha: f32, @location(2) speed: f32) -> VOut {
  var out: VOut;
  out.position = u.viewProj * vec4f(pos, 1.0);
  out.worldPos = pos;
  return out;
}

const GRID_SPACING: f32 = 2.0;
const LINE_BASE_ALPHA: f32 = 0.12;
const LINE_COLOR: vec3f = vec3f(0.35, 0.35, 0.35);

@fragment fn fs(v: VOut) -> @location(0) vec4f {
  let coord = v.worldPos.xz / GRID_SPACING;
  let grid = abs(fract(coord - 0.5) - 0.5);
  let line = min(grid.x, grid.y);
  let fw = fwidth(line);
  let mask = 1.0 - smoothstep(0.0, fw * 1.5, line);

  let dist = length(v.worldPos.xz);
  let fade = 1.0 - smoothstep(3.0, 10.0, dist);

  let alpha = mask * LINE_BASE_ALPHA * fade;
  return vec4f(LINE_COLOR, alpha);
}
