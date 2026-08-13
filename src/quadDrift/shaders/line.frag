#version 300 es
precision highp float;

out vec4 fragColor;

uniform float uAlpha;

void main() {
  fragColor = vec4(1.0, 1.0, 1.0, uAlpha);
}
