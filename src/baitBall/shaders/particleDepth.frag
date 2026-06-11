#version 300 es
precision highp float;

in float vLife;
in float vLinearDepth;

out vec4 fragColor;

void main() {
    float alpha = smoothstep(0.0, 0.15, vLife) * smoothstep(0.0, 0.25, 1.0 - vLife);
    if (alpha < 0.1) discard;
    fragColor = vec4(vec3(vLinearDepth), 1.0);
}
