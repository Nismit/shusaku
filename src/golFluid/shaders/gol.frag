#version 300 es
precision highp float;

uniform sampler2D uGolState;
uniform vec2 uTexelSize;

in vec2 vTexCoord;
out vec4 fragColor;

void main() {
    vec2 uv = vTexCoord;
    float current = texture(uGolState, uv).r;

    // Count live Moore neighbors with toroidal wrap via fract()
    float n = 0.0;
    for (int dy = -1; dy <= 1; dy++) {
        for (int dx = -1; dx <= 1; dx++) {
            if (dx == 0 && dy == 0) continue;
            vec2 offset = vec2(float(dx), float(dy)) * uTexelSize;
            n += step(0.5, texture(uGolState, fract(uv + offset)).r);
        }
    }

    // B3/S23 (Conway's Life)
    float alive = step(0.5, current);
    float survives = alive * step(1.5, n) * step(n, 3.5);
    float born    = (1.0 - alive) * step(2.5, n) * step(n, 3.5);
    float next = survives + born;

    // R = new state, G = old state (for birth/death detection in injection shaders)
    fragColor = vec4(next, alive, 0.0, 1.0);
}
