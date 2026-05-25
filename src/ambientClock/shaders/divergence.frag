#version 300 es
precision highp float;

uniform sampler2D uVelocity;
uniform vec2 uTexelSize;

in vec2 vTexCoord;
out vec4 fragColor;

void main() {
    float L = texture(uVelocity, vTexCoord - vec2(uTexelSize.x, 0.0)).x;
    float R = texture(uVelocity, vTexCoord + vec2(uTexelSize.x, 0.0)).x;
    float T = texture(uVelocity, vTexCoord + vec2(0.0, uTexelSize.y)).y;
    float B = texture(uVelocity, vTexCoord - vec2(0.0, uTexelSize.y)).y;
    float div = 0.5 * (R - L + T - B);
    fragColor = vec4(div, 0.0, 0.0, 1.0);
}
