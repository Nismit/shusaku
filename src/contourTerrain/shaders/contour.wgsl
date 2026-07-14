struct Params {
  resolution: vec2f,
  time: f32,
  _pad: f32,
};

@group(0) @binding(0) var<uniform> u: Params;

const MAX_STEPS: i32 = 80;
const MAX_DIST: f32 = 30.0;
const TERRAIN_HEIGHT: f32 = 1.8;

fn hash(p: vec2f) -> f32 {
  var h = dot(p, vec2f(127.1, 311.7));
  return fract(sin(h) * 43758.5453123);
}

fn noise(p: vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);

  return mix(
    mix(hash(i + vec2f(0.0, 0.0)), hash(i + vec2f(1.0, 0.0)), u.x),
    mix(hash(i + vec2f(0.0, 1.0)), hash(i + vec2f(1.0, 1.0)), u.x),
    u.y
  );
}

fn fbm4(p: vec2f) -> f32 {
  var value = 0.0;
  var amplitude = 0.5;
  var freq = 1.0;

  for (var i = 0; i < 4; i++) {
    value += amplitude * noise(p * freq);
    freq *= 2.0;
    amplitude *= 0.5;
  }

  return value;
}

fn fbm6(p: vec2f) -> f32 {
  var value = 0.0;
  var amplitude = 0.5;
  var freq = 1.0;

  for (var i = 0; i < 6; i++) {
    value += amplitude * noise(p * freq);
    freq *= 2.0;
    amplitude *= 0.5;
  }

  return value;
}

fn terrainOffset(p: vec2f) -> vec2f {
  let drift = u.time * 0.06;
  return p + vec2f(drift, drift * 0.7);
}

fn terrainHeightCoarse(p: vec2f) -> f32 {
  return fbm4(terrainOffset(p)) * TERRAIN_HEIGHT;
}

fn terrainHeight(p: vec2f) -> f32 {
  return fbm6(terrainOffset(p)) * TERRAIN_HEIGHT;
}

fn raymarchTerrain(ro: vec3f, rd: vec3f) -> f32 {
  var t = 0.0;
  var lastH = 0.0;
  var lastY = 0.0;

  for (var i = 0; i < MAX_STEPS; i++) {
    if (t > MAX_DIST) { break; }
    let p = ro + rd * t;
    let h = terrainHeightCoarse(p.xz);
    if (p.y < h) {
      return t - (lastY - lastH) / ((p.y - h) - (lastY - lastH)) * (t - max(0.0, t - max(0.05, (lastY - lastH) * 0.5)));
    }
    lastH = h;
    lastY = p.y;
    t += max(0.05, (p.y - h) * 0.5);
  }

  return -1.0;
}

fn contourLines(height: f32, gradient: vec2f) -> f32 {
  let interval = mix(0.04, 0.18, pow(1.0 - clamp(height / TERRAIN_HEIGHT, 0.0, 1.0), 2.0));

  // Signed height offset from the nearest contour level.
  let f = height - round(height / interval) * interval;

  // First-order Taylor approximation of the true Euclidean distance to the
  // contour line: d = f(p) / |grad f(p)|.
  // https://iquilezles.org/articles/distance/
  let dist = f / max(length(gradient), 1e-4);

  // Anti-alias using the screen-space footprint of that distance, so the
  // line stays a crisp, constant pixel width regardless of terrain slope.
  let aa = max(fwidth(dist), 1e-4);
  return 1.0 - smoothstep(0.0, aa, abs(dist));
}

@fragment
fn fs(@location(0) uv: vec2f) -> @location(0) vec4f {
  let aspect = u.resolution.x / u.resolution.y;
  let screen = vec2f((uv.x - 0.5) * aspect, 0.5 - uv.y) * 2.0;

  // Camera
  let camAngle = u.time * 0.08;
  let camDist = 1.5;
  let camHeight = 1.2;
  let ro = vec3f(cos(camAngle) * camDist, camHeight, sin(camAngle) * camDist);
  let lookAt = vec3f(0.0, 0.6, 0.0);

  let forward = normalize(lookAt - ro);
  let right = normalize(cross(forward, vec3f(0.0, 1.0, 0.0)));
  let up = cross(right, forward);
  let rd = normalize(forward * 1.5 + right * screen.x + up * screen.y);

  let t = raymarchTerrain(ro, rd);

  if (t < 0.0) {
    return vec4f(0.0, 0.0, 0.0, 1.0);
  }

  let pos = ro + rd * t;

  // Full-detail height + normal + contour at hit point only
  let height = terrainHeight(pos.xz);
  let eps = 0.02;
  let hx = terrainHeight(pos.xz + vec2f(eps, 0.0));
  let hz = terrainHeight(pos.xz + vec2f(0.0, eps));
  let n = normalize(vec3f(height - hx, eps, height - hz));
  let grad = vec2f(hx - height, hz - height) / eps;
  let line = contourLines(height, grad);

  // Lighting
  let lightDir = normalize(vec3f(0.5, 0.8, 0.3));
  let diff = max(dot(n, lightDir), 0.0);
  let lighting = 0.15 + diff * 0.25;

  // Fog
  let fog = 1.0 - exp(-t * 0.05);

  let color = vec3f(line);
  let final_color = mix(color, vec3f(0.0), fog);

  return vec4f(final_color, 1.0);
}
