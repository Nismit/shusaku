#version 300 es
precision highp float;

in vec2 vTexCoord;
out vec4 fragColor;

uniform sampler2D uTexture;
uniform vec2 uTexelSize;
uniform float uIteration; // Kawase iteration index (0, 1, 2, ...)

// Kawase Blur - samples 4 diagonal corners at half-pixel offsets
// Each pass uses increasing offset based on iteration index
// Ref: Masaki Kawase, "Frame Buffer Postprocessing Effects in DOUBLE-S.T.E.A.L" (GDC 2003)
void main() {
  float offset = uIteration + 0.5;
  vec2 ofs = uTexelSize * offset;

  vec4 color = texture(uTexture, vTexCoord + vec2(-ofs.x,  ofs.y));
  color     += texture(uTexture, vTexCoord + vec2( ofs.x,  ofs.y));
  color     += texture(uTexture, vTexCoord + vec2( ofs.x, -ofs.y));
  color     += texture(uTexture, vTexCoord + vec2(-ofs.x, -ofs.y));

  fragColor = color * 0.25;
}
