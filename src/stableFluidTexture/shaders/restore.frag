#version 300 es
precision highp float;

uniform sampler2D uUVField;
uniform float uRestoreRate;

in vec2 vTexCoord;
out vec4 fragColor;

void main() {
    vec2 current = texture(uUVField, vTexCoord).xy;
    vec2 restored = mix(current, vTexCoord, uRestoreRate);
    fragColor = vec4(restored, 0.0, 1.0);
}
