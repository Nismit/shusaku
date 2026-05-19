#version 300 es
precision highp float;

uniform sampler2D uUVField;
uniform float uCheckerScale;

in vec2 vTexCoord;
out vec4 fragColor;

void main() {
    vec2 uv = texture(uUVField, vTexCoord).xy;

    vec2 p = uv * uCheckerScale;
    // fwidth-based anti-aliasing; clamp to avoid complete blur when heavily distorted
    vec2 fw = clamp(fwidth(p), 0.0, 0.45);
    vec2 i = smoothstep(0.5 - fw, 0.5 + fw, fract(p));
    float checker = i.x + i.y - 2.0 * i.x * i.y;

    vec3 colorA = vec3(0.95);
    vec3 colorB = vec3(0.12);
    fragColor = vec4(mix(colorA, colorB, checker), 1.0);
}
