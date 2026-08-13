#version 300 es
precision highp float;

uniform sampler2D uVelocity;
uniform float uRange;

in vec2 vTexCoord;
out vec4 fragColor;

// Splits a 0..1 value across two 8-bit channels, giving the RGBA8 probe target
// ~16 bits per velocity component. Plain 8-bit quantisation is visible in this
// sketch: the drifters low-pass the field they read, so every step in it lands
// as a whole ring of cells snapping in or out at once.
vec2 pack16(float v) {
    float x = clamp(v, 0.0, 1.0) * 255.0;
    float hi = floor(x);
    return vec2(hi / 255.0, x - hi);
}

void main() {
    vec2 velocity = texture(uVelocity, vTexCoord).xy;
    vec2 unit = clamp(velocity / uRange, -1.0, 1.0) * 0.5 + 0.5;
    fragColor = vec4(pack16(unit.x), pack16(unit.y));
}
