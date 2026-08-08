#version 300 es
precision highp float;

in vec2 vTexCoord;
out vec4 fragColor;

uniform sampler2D uAtlas;
uniform vec4 uGlyphBounds[8];  // atlasBounds per glyph (left, bottom, right, top) in atlas px
uniform vec4 uGlyphPlane[8];   // planeBounds per glyph, in em units
uniform vec2 uGlyphPos[8];     // baseline origin per glyph, screen px (y-down)
uniform int uGlyphCount;
uniform vec2 uResolution;
uniform vec2 uAtlasSize;
uniform float uFontSize;
uniform float uDistanceRange;
uniform float uAlpha;

float median(float r, float g, float b) {
  return max(min(r, g), min(max(r, g), b));
}

// Writes coverage into alpha only — the composite pass does the coloring,
// so it can sample R/G/B at different offsets for chromatic aberration.
void main() {
  vec2 p = vec2(vTexCoord.x, 1.0 - vTexCoord.y) * uResolution;
  float coverage = 0.0;

  for (int i = 0; i < 8; i++) {
    if (i >= uGlyphCount) break;

    vec4 atlas = uGlyphBounds[i];
    vec4 plane = uGlyphPlane[i];
    vec2 pos = uGlyphPos[i];

    vec2 gMin = pos + vec2(plane.x, -plane.w) * uFontSize;
    vec2 gMax = pos + vec2(plane.z, -plane.y) * uFontSize;

    if (p.x >= gMin.x && p.x <= gMax.x && p.y >= gMin.y && p.y <= gMax.y) {
      vec2 local = (p - gMin) / (gMax - gMin);

      vec2 atlasUv = vec2(
        (atlas.x + local.x * (atlas.z - atlas.x)) / uAtlasSize.x,
        1.0 - (atlas.y + (1.0 - local.y) * (atlas.w - atlas.y)) / uAtlasSize.y
      );

      vec3 msdf = texture(uAtlas, atlasUv).rgb;
      float sd = median(msdf.r, msdf.g, msdf.b);

      // Derivative-based screenPxRange: stays crisp at any resolution / DPR / font size.
      vec2 unitRange = vec2(uDistanceRange) / uAtlasSize;
      vec2 screenTexSize = vec2(1.0) / max(fwidth(atlasUv), vec2(1e-4));
      float screenPxRange = max(0.5 * dot(unitRange, screenTexSize), 1.0);

      float opacity = clamp(screenPxRange * (sd - 0.5) + 0.5, 0.0, 1.0);
      coverage = max(coverage, opacity);
    }
  }

  fragColor = vec4(1.0, 1.0, 1.0, coverage * uAlpha);
}
