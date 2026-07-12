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
const CROSS_RADIUS: f32 = 0.1;
const CROSS_WIDTH_MULT: f32 = 7.0;
const CROSS_ALPHA_MULT: f32 = 3.0;
const CROSS_COLOR: vec3f = vec3f(0.7, 0.7, 0.7);

@fragment fn fs(v: VOut) -> @location(0) vec4f {
  let coord = v.worldPos.xz / GRID_SPACING;
  let grid = abs(fract(coord - 0.5) - 0.5);
  let line = min(grid.x, grid.y);
  let fw = fwidth(line);

  let interDist = max(grid.x, grid.y);
  let crossFactor = 1.0 - smoothstep(0.0, CROSS_RADIUS, interDist);

  let aaWidth = fw * 1.5;
  let lineWidth = aaWidth * mix(1.0, CROSS_WIDTH_MULT, crossFactor);
  let mask = 1.0 - smoothstep(max(lineWidth - aaWidth, 0.0), lineWidth, line);

  let dist = length(v.worldPos.xz);
  let fade = 1.0 - smoothstep(3.0, 10.0, dist);

  let color = mix(LINE_COLOR, CROSS_COLOR, crossFactor);
  let alpha = mask * LINE_BASE_ALPHA * mix(1.0, CROSS_ALPHA_MULT, crossFactor) * fade;
  return vec4f(color, alpha);
}
