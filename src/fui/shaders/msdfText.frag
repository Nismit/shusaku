#version 300 es
precision highp float;

in vec2 vAtlasUv;
in float vAlpha;
out vec4 fragColor;

uniform sampler2D uAtlas;
uniform vec2 uAtlasSize;
uniform vec4 uColor;

float median(float r, float g, float b) {
  return max(min(r, g), min(max(r, g), b));
}

void main() {
  vec3 msdf = texture(uAtlas, vAtlasUv).rgb;
  float sd = median(msdf.r, msdf.g, msdf.b);

  vec2 unitRange = vec2(2.0) / uAtlasSize;
  vec2 screenTexSize = vec2(1.0) / max(fwidth(vAtlasUv), vec2(1e-4));
  float screenPxRange = max(0.5 * dot(unitRange, screenTexSize), 1.0);

  float screenPxDistance = screenPxRange * (sd - 0.5);
  float opacity = clamp(screenPxDistance + 0.5, 0.0, 1.0);
  if (opacity < 0.001) discard;

  fragColor = vec4(uColor.rgb, vAlpha * opacity);
}
