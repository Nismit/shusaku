#version 300 es
precision highp float;

in vec2 vTexCoord;
out vec4 fragColor;

uniform sampler2D uAtlas;
uniform vec4 uGlyphBounds[16];  // atlasBounds for each character (max 16 chars)
uniform vec4 uGlyphPlane[16];   // planeBounds for each character
uniform vec2 uGlyphPos[16];     // screen position for each character
uniform int uGlyphCount;
uniform vec2 uResolution;
uniform float uFontSize;
uniform vec4 uColor;
uniform vec2 uAtlasSize;

float median(float r, float g, float b) {
  return max(min(r, g), min(max(r, g), b));
}

void main() {
  vec2 pixelCoord = vec2(vTexCoord.x, 1.0 - vTexCoord.y) * uResolution;
  vec4 color = vec4(0.0);

  for (int i = 0; i < 16; i++) {
    if (i >= uGlyphCount) break;

    vec4 atlas = uGlyphBounds[i];  // left, bottom, right, top in atlas pixels
    vec4 plane = uGlyphPlane[i];   // left, bottom, right, top in em units
    vec2 pos = uGlyphPos[i];       // position in pixels (screen coords: 0,0 at top-left)

    vec2 glyphMin = pos + vec2(plane.x, -plane.w) * uFontSize;
    vec2 glyphMax = pos + vec2(plane.z, -plane.y) * uFontSize;

    if (pixelCoord.x >= glyphMin.x && pixelCoord.x <= glyphMax.x &&
        pixelCoord.y >= glyphMin.y && pixelCoord.y <= glyphMax.y) {

      vec2 localUv = (pixelCoord - glyphMin) / (glyphMax - glyphMin);

      vec2 atlasUv = vec2(
        (atlas.x + localUv.x * (atlas.z - atlas.x)) / uAtlasSize.x,
        1.0 - (atlas.y + (1.0 - localUv.y) * (atlas.w - atlas.y)) / uAtlasSize.y
      );

      vec3 msdf = texture(uAtlas, atlasUv).rgb;
      float sd = median(msdf.r, msdf.g, msdf.b);

      // Derivative-based screenPxRange: accurate at any resolution/DPR/zoom level.
      // distanceRange=2 (from atlas JSON), uAtlasSize in atlas pixels.
      // unitRange = how many UV units one distance-range spans in the atlas.
      // screenTexSize = how many screen pixels one UV unit spans (via fwidth).
      vec2 unitRange = vec2(2.0) / uAtlasSize;
      vec2 screenTexSize = vec2(1.0) / max(fwidth(atlasUv), vec2(1e-4));
      float screenPxRange = max(0.5 * dot(unitRange, screenTexSize), 1.0);

      float screenPxDistance = screenPxRange * (sd - 0.5);
      float opacity = clamp(screenPxDistance + 0.5, 0.0, 1.0);

      color = max(color, vec4(uColor.rgb, uColor.a * opacity));
    }
  }

  fragColor = color;
}
