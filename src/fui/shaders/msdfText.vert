#version 300 es
precision highp float;

// Static unit-quad corner (0,0)=glyph top-left .. (1,1)=glyph bottom-right
layout(location = 0) in vec2 aCorner;

// Per-instance attributes
layout(location = 1) in vec4 aScreenRect;  // x, y, w, h  (device pixels, y-down)
layout(location = 2) in vec4 aAtlasRect;   // u0, vTop, u1, vBottom (normalized atlas UV)
layout(location = 3) in float aAlpha;

uniform vec2 uResolution;

out vec2 vAtlasUv;
out float vAlpha;

void main() {
  // Glyph quad corner in device pixels (top-left origin, y-down)
  vec2 px = aScreenRect.xy + aCorner * aScreenRect.zw;

  // Pixel -> clip space (flip Y so y-down pixels map to GL's y-up clip)
  vec2 clip = vec2(
    px.x / uResolution.x * 2.0 - 1.0,
    1.0 - px.y / uResolution.y * 2.0
  );
  gl_Position = vec4(clip, 0.0, 1.0);

  vAtlasUv = vec2(
    mix(aAtlasRect.x, aAtlasRect.z, aCorner.x),
    mix(aAtlasRect.y, aAtlasRect.w, aCorner.y)
  );
  vAlpha = aAlpha;
}
