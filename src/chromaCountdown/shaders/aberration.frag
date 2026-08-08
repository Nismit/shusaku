#version 300 es
precision highp float;

in vec2 vTexCoord;
out vec4 fragColor;

uniform sampler2D uText;     // glyph coverage in .a
uniform vec2 uResolution;
uniform vec3 uBgColor;
uniform vec3 uTextColor;
uniform float uAmount;       // 0..1 tick impulse — everything below scales by this
uniform float uRadial;       // px: split growing outward from screen center
uniform float uLateral;      // px: constant sideways split (keeps the centre alive)
uniform float uBlur;         // px: symmetric smear applied to every channel
uniform float uSmear;        // 0..1: 0 = clean split, 1 = split drags a trail
uniform float uTear;         // px: per-row horizontal glitch
uniform float uTime;
uniform float uGrain;        // luminance grain laid over the whole frame
uniform float uGrainBite;    // how much grain eats into the glyph coverage
uniform float uGrainScale;   // grain cell size in device px

const int TAPS = 8;

float hash(float n) { return fract(sin(n) * 43758.5453123); }

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

// One colour channel: taps walk from the channel's split offset back toward
// zero (uSmear), plus a symmetric blur along the split direction (uBlur).
float sampleChannel(vec2 uv, vec2 offPx, vec2 blurDir, float blurPx, float chan) {
  vec2 texel = 1.0 / uResolution;
  float acc = 0.0;

  for (int i = 0; i < TAPS; i++) {
    float t = float(i) / float(TAPS - 1);
    vec2 o = offPx * chan * mix(1.0, t, uSmear) + blurDir * (t - 0.5) * blurPx;
    acc += texture(uText, uv + o * texel).a;
  }

  return acc / float(TAPS);
}

void main() {
  vec2 uv = vTexCoord;

  if (uTear > 0.0 && uAmount > 0.001) {
    float row = floor(vTexCoord.y * 48.0);
    float n = hash(row * 7.13 + floor(uTime * 60.0) * 1.7) * 2.0 - 1.0;
    uv.x += n * uTear * uAmount / uResolution.x;
  }

  vec2 rel = (vTexCoord - 0.5) * 2.0;
  vec2 offPx = (rel * uRadial + vec2(uLateral, 0.0)) * uAmount;
  float blurPx = uBlur * uAmount;

  float len = length(offPx);
  vec2 blurDir = len > 1e-4 ? offPx / len : vec2(1.0, 0.0);

  vec3 cov = vec3(
    sampleChannel(uv, offPx, blurDir, blurPx,  1.0),
    sampleChannel(uv, offPx, blurDir, blurPx,  0.0),
    sampleChannel(uv, offPx, blurDir, blurPx, -1.0)
  );

  // Static grain — no time term, so it sits on the image like film stock or
  // paper rather than crawling. Two octaves so it doesn't read as a regular
  // dither pattern. Normalised to roughly ±1.
  vec2 cell = floor(gl_FragCoord.xy / max(uGrainScale, 1.0));
  float g = ((hash21(cell) - 0.5) + (hash21(cell * 1.7 + 31.4) - 0.5) * 0.5) / 0.75;

  // Bite: the grain eats into the coverage itself, so the glyph fill goes
  // mottled and its edges go ragged. This is what actually reads as a rough
  // surface — a purely additive overlay just looks like faint video noise.
  // Masked to where there is ink, so the background stays clean of speckle.
  float ink = (cov.r + cov.g + cov.b) / 3.0;
  float inkMask = smoothstep(0.0, 0.08, ink);
  cov = clamp(cov + g * uGrainBite * inkMask, 0.0, 1.0);

  vec3 color = mix(uBgColor, uTextColor, cov);

  // Luminance grain over everything, a little stronger on the type.
  color += g * uGrain * mix(0.5, 1.0, ink);

  fragColor = vec4(color, 1.0);
}
