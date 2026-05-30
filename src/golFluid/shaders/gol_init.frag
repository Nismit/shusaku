#version 300 es
precision highp float;

uniform float uSeed;

in vec2 vTexCoord;
out vec4 fragColor;

float hash(vec2 p) {
    p = fract(p * vec2(234.34, 435.345) + uSeed * 0.001);
    p += dot(p, p + 34.23);
    return fract(p.x * p.y);
}

void main() {
    float alive = step(0.65, hash(vTexCoord));
    // R = new state, G = old state (same at init so no spurious birth/death)
    fragColor = vec4(alive, alive, 0.0, 1.0);
}
