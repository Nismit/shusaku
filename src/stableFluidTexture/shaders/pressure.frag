#version 300 es
precision highp float;

uniform sampler2D uPressure;
uniform sampler2D uDivergence;
uniform vec2 uTexelSize;

in vec2 vTexCoord;
out vec4 fragColor;

void main() {
    float L = texture(uPressure, vTexCoord - vec2(uTexelSize.x, 0.0)).x;
    float R = texture(uPressure, vTexCoord + vec2(uTexelSize.x, 0.0)).x;
    float T = texture(uPressure, vTexCoord + vec2(0.0, uTexelSize.y)).x;
    float B = texture(uPressure, vTexCoord - vec2(0.0, uTexelSize.y)).x;
    float div = texture(uDivergence, vTexCoord).x;
    float pressure = (L + R + B + T - div) * 0.25;
    fragColor = vec4(pressure, 0.0, 0.0, 1.0);
}
