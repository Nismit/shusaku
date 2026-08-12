#version 300 es

layout(location = 0) in vec2 aPos; // clip space
layout(location = 1) in vec2 aUv;  // atlas uv, 0..1

out vec2 vUv;

void main() {
  vUv = aUv;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
