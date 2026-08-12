#version 300 es
precision highp float;

uniform sampler2D uTexture;
uniform vec2 uTexelSize;
uniform vec2 uDirection;

in vec2 vTexCoord;
out vec4 fragColor;

void main() {
    // 5-tap Gaussian blur (sigma ~1.4)
    vec4 sum = vec4(0.0);
    sum += texture(uTexture, vTexCoord - 2.0 * uDirection * uTexelSize) * 0.06136;
    sum += texture(uTexture, vTexCoord - 1.0 * uDirection * uTexelSize) * 0.24477;
    sum += texture(uTexture, vTexCoord) * 0.38774;
    sum += texture(uTexture, vTexCoord + 1.0 * uDirection * uTexelSize) * 0.24477;
    sum += texture(uTexture, vTexCoord + 2.0 * uDirection * uTexelSize) * 0.06136;
    fragColor = sum;
}
