#version 300 es
precision highp float;

uniform sampler2D uInk;

in vec2 vTexCoord;
out vec4 fragColor;

// Same 16-bit split as probe.frag. The quadtree compares this against a
// per-depth threshold, and at 8 bits the comparison flips a whole ring of
// cells at once every time the trail fades past a quantisation step.
vec2 pack16(float v) {
    float x = clamp(v, 0.0, 1.0) * 255.0;
    float hi = floor(x);
    return vec2(hi / 255.0, x - hi);
}

void main() {
    fragColor = vec4(pack16(texture(uInk, vTexCoord).r), 0.0, 1.0);
}
