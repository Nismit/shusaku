#version 300 es
precision highp float;

in float vLinearDepth;

out vec4 fragColor;

void main() {
    fragColor = vec4(vec3(vLinearDepth), 1.0);
}
