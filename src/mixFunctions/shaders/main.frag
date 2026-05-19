#version 300 es
precision highp float;
precision highp int;

in vec2 vTexCoord;
out vec4 fragColor;

uniform float iTime;
uniform vec2 iResolution;
uniform vec2 iOffset;
uniform float iCellSize;
uniform float iStride;
uniform vec4 iColorA;  // RGBA
uniform vec4 iColorB;  // RGBA
uniform int iShowLabels;
uniform int iAnimate;

// ============================================
// Hash Functions (high quality integer-based)
// ============================================

const uint UINT_MAX = 0xffffffffu;
uvec3 k = uvec3(0x456789abu, 0x6789ab45u, 0x89ab4567u);
uvec3 u = uvec3(1, 2, 3);

uvec2 uhash22(uvec2 n) {
  n ^= (n.yx << u.xy);
  n ^= (n.yx >> u.xy);
  n *= k.xy;
  n ^= (n.yx << u.xy);
  return n * k.xy;
}

uvec3 uhash33(uvec3 n) {
  n ^= (n.yzx << u);
  n ^= (n.yzx >> u);
  n *= k;
  n ^= (n.yzx << u);
  return n * k;
}

vec2 hash22(vec2 p) {
  uvec2 n = floatBitsToUint(p);
  return vec2(uhash22(n)) / vec2(UINT_MAX);
}

vec3 hash33(vec3 p) {
  uvec3 n = floatBitsToUint(p);
  return vec3(uhash33(n)) / vec3(UINT_MAX);
}

float hash21(vec2 p) {
  uvec2 n = floatBitsToUint(p);
  return float(uhash22(n).x) / float(UINT_MAX);
}

float hash31(vec3 p) {
  uvec3 n = floatBitsToUint(p);
  return float(uhash33(n).x) / float(UINT_MAX);
}

// ============================================
// Noise Functions
// ============================================

float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);

  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));

  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// 3D value noise for domain warping
float valueNoise3D(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);

  float a = hash31(i);
  float b = hash31(i + vec3(1.0, 0.0, 0.0));
  float c = hash31(i + vec3(0.0, 1.0, 0.0));
  float d = hash31(i + vec3(1.0, 1.0, 0.0));
  float e = hash31(i + vec3(0.0, 0.0, 1.0));
  float f1 = hash31(i + vec3(1.0, 0.0, 1.0));
  float g = hash31(i + vec3(0.0, 1.0, 1.0));
  float h = hash31(i + vec3(1.0, 1.0, 1.0));

  vec3 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(a, b, u.x), mix(c, d, u.x), u.y),
    mix(mix(e, f1, u.x), mix(g, h, u.x), u.y),
    u.z
  );
}

float fbm(vec2 p, int octaves) {
  float value = 0.0;
  float amplitude = 0.5;
  float frequency = 1.0;

  for (int i = 0; i < 6; i++) {
    if (i >= octaves) break;
    value += amplitude * valueNoise(p * frequency);
    frequency *= 2.0;
    amplitude *= 0.5;
  }
  return value;
}

float fbm3D(vec3 p, int octaves) {
  float value = 0.0;
  float amplitude = 0.5;
  float frequency = 1.0;

  for (int i = 0; i < 6; i++) {
    if (i >= octaves) break;
    value += amplitude * valueNoise3D(p * frequency);
    frequency *= 2.0;
    amplitude *= 0.5;
  }
  return value;
}

// Gradient Noise (Perlin-style)
float gradientNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);

  // Get gradient vectors from hash
  vec2 ga = hash22(i) * 2.0 - 1.0;
  vec2 gb = hash22(i + vec2(1.0, 0.0)) * 2.0 - 1.0;
  vec2 gc = hash22(i + vec2(0.0, 1.0)) * 2.0 - 1.0;
  vec2 gd = hash22(i + vec2(1.0, 1.0)) * 2.0 - 1.0;

  // Distance vectors to corners
  vec2 pa = f;
  vec2 pb = f - vec2(1.0, 0.0);
  vec2 pc = f - vec2(0.0, 1.0);
  vec2 pd = f - vec2(1.0, 1.0);

  // Dot products
  float va = dot(ga, pa);
  float vb = dot(gb, pb);
  float vc = dot(gc, pc);
  float vd = dot(gd, pd);

  // Quintic interpolation (smoother than cubic)
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);

  float noise = mix(mix(va, vb, u.x), mix(vc, vd, u.x), u.y);
  return noise * 0.5 + 0.5; // Remap to 0-1
}

float fbmGradient(vec2 p, int octaves) {
  float value = 0.0;
  float amplitude = 0.5;
  float frequency = 1.0;

  for (int i = 0; i < 6; i++) {
    if (i >= octaves) break;
    value += amplitude * (gradientNoise(p * frequency) * 2.0 - 1.0);
    frequency *= 2.0;
    amplitude *= 0.5;
  }
  return value * 0.5 + 0.5;
}

// Turbulence - abs(noise) を重ねる
float turbulence(vec2 p, int octaves) {
  float value = 0.0;
  float amplitude = 0.5;
  float frequency = 1.0;

  for (int i = 0; i < 6; i++) {
    if (i >= octaves) break;
    value += amplitude * abs(gradientNoise(p * frequency) * 2.0 - 1.0);
    frequency *= 2.0;
    amplitude *= 0.5;
  }
  return value;
}

// Ridged fBM - 山脈のような尖った形状
float ridgedFbm(vec2 p, int octaves) {
  float value = 0.0;
  float amplitude = 0.5;
  float frequency = 1.0;
  float prev = 1.0;

  for (int i = 0; i < 6; i++) {
    if (i >= octaves) break;
    float n = 1.0 - abs(gradientNoise(p * frequency) * 2.0 - 1.0);
    n = n * n;
    value += n * amplitude * prev;
    prev = n;
    frequency *= 2.0;
    amplitude *= 0.5;
  }
  return value;
}

// Worley F2-F1 (cellular edges)
float worleyF2F1(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);

  float f1 = 1.0;
  float f2 = 1.0;

  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 neighbor = vec2(float(x), float(y));
      vec2 point = hash22(i + neighbor);
      float d = length(neighbor + point - f);

      if (d < f1) {
        f2 = f1;
        f1 = d;
      } else if (d < f2) {
        f2 = d;
      }
    }
  }
  return f2 - f1;
}

// ============================================
// Mix Functions (0-1 range)
// ============================================

// Basic
float fn_linear(vec2 uv) {
  return uv.x;
}

float fn_step(vec2 uv) {
  return step(0.5, uv.x);
}

float fn_smoothstep(vec2 uv) {
  return smoothstep(0.0, 1.0, uv.x);
}

// Easing - Quadratic
float fn_easeInQuad(vec2 uv) {
  float t = uv.x;
  return t * t;
}

float fn_easeOutQuad(vec2 uv) {
  float t = uv.x;
  return 1.0 - (1.0 - t) * (1.0 - t);
}

float fn_easeInOutQuad(vec2 uv) {
  float t = uv.x;
  return t < 0.5 ? 2.0 * t * t : 1.0 - pow(-2.0 * t + 2.0, 2.0) / 2.0;
}

// Easing - Cubic
float fn_easeInCubic(vec2 uv) {
  float t = uv.x;
  return t * t * t;
}

float fn_easeOutCubic(vec2 uv) {
  float t = uv.x;
  return 1.0 - pow(1.0 - t, 3.0);
}

// Easing - Exponential
float fn_easeInExpo(vec2 uv) {
  float t = uv.x;
  return t == 0.0 ? 0.0 : pow(2.0, 10.0 * t - 10.0);
}

float fn_easeOutExpo(vec2 uv) {
  float t = uv.x;
  return t == 1.0 ? 1.0 : 1.0 - pow(2.0, -10.0 * t);
}

// Trigonometric
float fn_sinWave(vec2 uv) {
  return sin(uv.x * 3.14159265) * 0.5 + 0.5;
}

float fn_cosWave(vec2 uv) {
  return (1.0 - cos(uv.x * 3.14159265)) * 0.5;
}

// Vector-based
float fn_dot(vec2 uv) {
  vec2 dir = normalize(vec2(1.0, 0.5));
  return dot(uv, dir) * 0.5 + 0.5;
}

float fn_length(vec2 uv) {
  return length(uv - 0.5) * 2.0;
}

float fn_distance(vec2 uv) {
  return 1.0 - length(uv - 0.5) * 2.0;
}

// Noise-based
float fn_noise(vec2 uv, float time) {
  return valueNoise(uv * 4.0 + time * 0.5);
}

float fn_fbm3(vec2 uv, float time) {
  return fbm(uv * 3.0 + time * 0.3, 3);
}

float fn_fbm6(vec2 uv, float time) {
  return fbm(uv * 3.0 + time * 0.2, 6);
}

// Pattern-based
float fn_checker(vec2 uv) {
  vec2 grid = floor(uv * 4.0);
  return mod(grid.x + grid.y, 2.0);
}

float fn_gradientNoise(vec2 uv, float time) {
  return gradientNoise(uv * 4.0 + time * 0.5);
}

float fn_gradient_radial(vec2 uv) {
  return smoothstep(0.0, 0.7, 1.0 - length(uv - 0.5) * 2.0);
}

float fn_gradient_angle(vec2 uv) {
  vec2 centered = uv - 0.5;
  return (atan(centered.y, centered.x) / 3.14159265) * 0.5 + 0.5;
}

// Domain Warping
float fn_domainWarp(vec2 uv, float time) {
  vec2 p = uv * 3.0;
  vec2 q = vec2(
    fbm(p + vec2(0.0, 0.0) + time * 0.2, 4),
    fbm(p + vec2(5.2, 1.3) + time * 0.2, 4)
  );
  return fbm(p + q * 2.0, 4);
}

// Voronoi
float fn_voronoi(vec2 uv, float time) {
  vec2 p = uv * 4.0;
  vec2 i = floor(p);
  vec2 f = fract(p);

  float minDist = 1.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 neighbor = vec2(float(x), float(y));
      vec2 point = hash22(i + neighbor);
      point = 0.5 + 0.5 * sin(time * 0.5 + 6.28318 * point);
      float d = length(neighbor + point - f);
      minDist = min(minDist, d);
    }
  }
  return minDist;
}

// --- Row 5: New additions ---

// Turbulence
float fn_turbulence(vec2 uv, float time) {
  return turbulence(uv * 3.0 + time * 0.2, 5);
}

// Ridged fBM
float fn_ridged(vec2 uv, float time) {
  return ridgedFbm(uv * 3.0 + time * 0.15, 5);
}

// Worley F2-F1 (cellular edges)
float fn_worleyEdge(vec2 uv, float time) {
  vec2 p = uv * 4.0;
  vec2 i = floor(p);
  vec2 f = fract(p);

  float f1 = 1.0;
  float f2 = 1.0;

  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 neighbor = vec2(float(x), float(y));
      vec2 point = hash22(i + neighbor);
      point = 0.5 + 0.5 * sin(time * 0.5 + 6.28318 * point);
      float d = length(neighbor + point - f);

      if (d < f1) {
        f2 = f1;
        f1 = d;
      } else if (d < f2) {
        f2 = d;
      }
    }
  }
  return clamp((f2 - f1) * 2.0, 0.0, 1.0);
}

// Posterize (quantize)
float fn_posterize(vec2 uv) {
  float levels = 5.0;
  float t = uv.x;
  return floor(t * levels) / (levels - 1.0);
}

// Fract repeat
float fn_fractRepeat(vec2 uv) {
  return fract(uv.x * 4.0);
}

// Sine grid
float fn_sineGrid(vec2 uv, float time) {
  float sx = sin(uv.x * 12.566 + time) * 0.5 + 0.5;
  float sy = sin(uv.y * 12.566 + time) * 0.5 + 0.5;
  return sx * sy;
}

// ============================================
// Wave Functions
// ============================================

float fn_squareWave(vec2 uv) {
  return step(0.5, fract(uv.x * 4.0));
}

float fn_triangleWave(vec2 uv) {
  float t = fract(uv.x * 4.0);
  return 1.0 - abs(t * 2.0 - 1.0);
}

float fn_sawtooth(vec2 uv) {
  return fract(uv.x * 4.0);
}

// uv.y controls duty cycle: top=narrow, bottom=full
float fn_pulse(vec2 uv) {
  return step(1.0 - uv.y, fract(uv.x * 4.0));
}

// ============================================
// Additional Noise
// ============================================

float fn_worleyF1(vec2 uv, float time) {
  vec2 p = uv * 4.0;
  vec2 i = floor(p);
  vec2 f = fract(p);
  float minDist = 1.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 neighbor = vec2(float(x), float(y));
      vec2 point = hash22(i + neighbor);
      point = 0.5 + 0.5 * sin(time * 0.5 + 6.28318 * point);
      minDist = min(minDist, length(neighbor + point - f));
    }
  }
  return clamp(minDist, 0.0, 1.0);
}

float fn_curlNoise(vec2 uv, float time) {
  float eps = 0.01;
  vec2 p = uv * 3.0 + vec2(time * 0.15, time * 0.1);
  float dfdx = (valueNoise(p + vec2(eps, 0.0)) - valueNoise(p - vec2(eps, 0.0))) / (2.0 * eps);
  float dfdy = (valueNoise(p + vec2(0.0, eps)) - valueNoise(p - vec2(0.0, eps))) / (2.0 * eps);
  vec2 curl = vec2(-dfdy, dfdx);
  return valueNoise(p + curl * 0.2);
}

float fn_caustics(vec2 uv, float time) {
  vec2 p = uv * 3.5;
  float c = 0.0;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float scale = 1.0 + fi * 0.6;
    vec2 shift = vec2(fi * 1.7, fi * 2.3);
    vec2 anim = vec2(sin(time * (0.3 - fi * 0.05)), cos(time * (0.25 - fi * 0.04))) * 0.4;
    c += worleyF2F1((p + shift + anim) * scale) / scale;
  }
  return clamp(c * 1.3, 0.0, 1.0);
}

float fn_smoothVoronoi(vec2 uv, float time) {
  vec2 p = uv * 4.0;
  vec2 i = floor(p);
  vec2 f = fract(p);
  float k = 8.0;
  float wSum = 0.0;
  float dSum = 0.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 neighbor = vec2(float(x), float(y));
      vec2 point = hash22(i + neighbor);
      point = 0.5 + 0.5 * sin(time * 0.5 + 6.28318 * point);
      float d = length(neighbor + point - f);
      float w = exp(-k * d);
      dSum += d * w;
      wSum += w;
    }
  }
  return clamp(dSum / wSum, 0.0, 1.0);
}

// ============================================
// Polar Coordinate Functions
// ============================================

float fn_spiral(vec2 uv, float time) {
  vec2 p = uv - 0.5;
  float r = length(p) * 2.0;
  float theta = atan(p.y, p.x);
  float bands = fract(r * 4.0 - theta / (2.0 * 3.14159265) + time * 0.3);
  return smoothstep(0.2, 0.8, bands);
}

float fn_roseCurve(vec2 uv, float time) {
  vec2 p = uv - 0.5;
  float r = length(p) * 2.0;
  float theta = atan(p.y, p.x);
  float rose = abs(cos(3.0 * theta + time * 0.3));
  return smoothstep(0.06, 0.0, r - rose * 0.88);
}

float fn_lissajous(vec2 uv, float time) {
  float sx = sin(3.0 * uv.x * 6.28318 + time);
  float sy = sin(2.0 * uv.y * 6.28318 + time * 0.7);
  return sx * sy * 0.5 + 0.5;
}

float fn_polarFbm(vec2 uv, float time) {
  vec2 p = uv - 0.5;
  float r = length(p) * 2.0;
  float theta = atan(p.y, p.x) / 3.14159265;
  return fbm(vec2(r * 3.0, theta * 2.0) + time * 0.15, 4);
}

// ============================================
// Grid Layout
// ============================================

#define NUM_COLS 6
#define NUM_ROWS 7
#define TOTAL_FUNCTIONS 42

struct FunctionResult {
  float value;
  int id;
};

FunctionResult getMixValue(int id, vec2 uv, float time) {
  FunctionResult result;
  result.id = id;

  // Clamp uv to 0-1 for most functions
  vec2 cuv = clamp(uv, 0.0, 1.0);

  if (id == 0) result.value = fn_linear(cuv);
  else if (id == 1) result.value = fn_step(cuv);
  else if (id == 2) result.value = fn_smoothstep(cuv);
  else if (id == 3) result.value = fn_easeInQuad(cuv);
  else if (id == 4) result.value = fn_easeOutQuad(cuv);
  else if (id == 5) result.value = fn_easeInOutQuad(cuv);
  else if (id == 6) result.value = fn_easeInCubic(cuv);
  else if (id == 7) result.value = fn_easeOutCubic(cuv);
  else if (id == 8) result.value = fn_easeInExpo(cuv);
  else if (id == 9) result.value = fn_easeOutExpo(cuv);
  else if (id == 10) result.value = fn_sinWave(cuv);
  else if (id == 11) result.value = fn_cosWave(cuv);
  else if (id == 12) result.value = fn_dot(cuv);
  else if (id == 13) result.value = fn_length(cuv);
  else if (id == 14) result.value = fn_distance(cuv);
  else if (id == 15) result.value = fn_noise(cuv, time);
  else if (id == 16) result.value = fn_fbm3(cuv, time);
  else if (id == 17) result.value = fn_fbm6(cuv, time);
  else if (id == 18) result.value = fn_checker(cuv);
  else if (id == 19) result.value = fn_gradientNoise(cuv, time);
  else if (id == 20) result.value = fn_gradient_radial(cuv);
  else if (id == 21) result.value = fn_gradient_angle(cuv);
  else if (id == 22) result.value = fn_domainWarp(cuv, time);
  else if (id == 23) result.value = fn_voronoi(cuv, time);
  // Row 5
  else if (id == 24) result.value = fn_turbulence(cuv, time);
  else if (id == 25) result.value = fn_ridged(cuv, time);
  else if (id == 26) result.value = fn_worleyEdge(cuv, time);
  else if (id == 27) result.value = fn_posterize(cuv);
  else if (id == 28) result.value = fn_fractRepeat(cuv);
  else if (id == 29) result.value = fn_sineGrid(cuv, time);
  // Row 6: Waves + Noise
  else if (id == 30) result.value = fn_squareWave(cuv);
  else if (id == 31) result.value = fn_triangleWave(cuv);
  else if (id == 32) result.value = fn_sawtooth(cuv);
  else if (id == 33) result.value = fn_pulse(cuv);
  else if (id == 34) result.value = fn_worleyF1(cuv, time);
  else if (id == 35) result.value = fn_curlNoise(cuv, time);
  // Row 7: Noise + Polar
  else if (id == 36) result.value = fn_caustics(cuv, time);
  else if (id == 37) result.value = fn_smoothVoronoi(cuv, time);
  else if (id == 38) result.value = fn_spiral(cuv, time);
  else if (id == 39) result.value = fn_roseCurve(cuv, time);
  else if (id == 40) result.value = fn_lissajous(cuv, time);
  else if (id == 41) result.value = fn_polarFbm(cuv, time);
  else result.value = 0.0;

  result.value = clamp(result.value, 0.0, 1.0);
  return result;
}

// ============================================
// SDF Text Rendering (simplified)
// ============================================

float sdBox(vec2 p, vec2 b) {
  vec2 d = abs(p) - b;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}

float sdSegment(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}

// ============================================
// Main
// ============================================

void main() {
  // Screen pixel coords: origin top-left, Y increases downward
  vec2 screenPx = vec2(vTexCoord.x, 1.0 - vTexCoord.y) * iResolution;
  vec2 worldPx = screenPx + iOffset;

  // Slot index and position within slot
  vec2 slotIdx = floor(worldPx / iStride);
  vec2 slotUV  = fract(worldPx / iStride);

  float cellFrac = iCellSize / iStride;

  // Gap between cells → background
  if (slotUV.x >= cellFrac || slotUV.y >= cellFrac) {
    fragColor = vec4(0.1, 0.1, 0.1, 1.0);
    return;
  }

  // Remap to 0-1 within just the cell area
  vec2 cellUV = slotUV / cellFrac;

  // Infinite tiling via modulo (handles negative indices correctly)
  int col = int(mod(slotIdx.x, float(NUM_COLS)));
  int row = int(mod(slotIdx.y, float(NUM_ROWS)));
  int funcId = row * NUM_COLS + col;

  // Inner padding
  float padding = 0.04;
  vec2 paddedUV = (cellUV - padding) / (1.0 - 2.0 * padding);

  float time = iAnimate == 1 ? iTime : 0.0;

  FunctionResult fn = getMixValue(funcId, paddedUV, time);
  vec4 col4 = mix(iColorA, iColorB, fn.value);

  float borderWidth = 0.008;
  float border = 1.0 - step(borderWidth, cellUV.x) * step(borderWidth, cellUV.y)
                     * step(borderWidth, 1.0 - cellUV.x) * step(borderWidth, 1.0 - cellUV.y);

  float inPadding = step(padding, cellUV.x) * step(padding, cellUV.y)
                  * step(padding, 1.0 - cellUV.x) * step(padding, 1.0 - cellUV.y);

  vec4 paddingColor = vec4(0.15, 0.15, 0.15, 1.0);
  vec4 borderColor  = vec4(0.3, 0.3, 0.3, 1.0);

  vec4 finalColor = col4 * inPadding + paddingColor * (1.0 - inPadding);
  finalColor = mix(finalColor, borderColor, border);

  fragColor = finalColor;
}
