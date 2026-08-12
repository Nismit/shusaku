#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uAtlas;
uniform vec2 uAtlasSize;
uniform float uDistanceRange;
uniform float uAlpha;

float median(float r, float g, float b) {
  return max(min(r, g), min(max(r, g), b));
}

// Writes coverage into alpha only. The buffer is blended with MAX, so a digit
// crossing a cell border never double-darkens the ink.
void main() {
  vec3 msdf = texture(uAtlas, vUv).rgb;
  float sd = median(msdf.r, msdf.g, msdf.b);

  // Derivative-based screenPxRange: the same glyph quad may be 8px or 300px
  // tall depending on how deep its cell sits, so the range has to be measured
  // per fragment rather than derived from a single font size.
  vec2 unitRange = vec2(uDistanceRange) / uAtlasSize;
  vec2 screenTexSize = vec2(1.0) / max(fwidth(vUv), vec2(1e-6));
  float screenPxRange = max(0.5 * dot(unitRange, screenTexSize), 1.0);

  float coverage = clamp(screenPxRange * (sd - 0.5) + 0.5, 0.0, 1.0);

  fragColor = vec4(1.0, 1.0, 1.0, coverage * uAlpha);
}
