#version 300 es
precision highp float;

uniform sampler2D uGolState;      // R=new state, G=old state
uniform sampler2D uVelocity;
uniform vec2 uGolTexelSize;
uniform float uVelocityStrength;

in vec2 vTexCoord;
out vec4 fragColor;

void main() {
    vec2 uv = vTexCoord;
    vec4 gol = texture(uGolState, uv);
    float newState = step(0.5, gol.r);
    float oldState = step(0.5, gol.g);
    float birth = newState * (1.0 - oldState);

    vec4 vel = texture(uVelocity, uv);

    // For birth cells, push fluid away from the center of old alive neighbors
    vec2 dir = vec2(0.0);
    for (int dy = -1; dy <= 1; dy++) {
        for (int dx = -1; dx <= 1; dx++) {
            if (dx == 0 && dy == 0) continue;
            vec2 offset = vec2(float(dx), float(dy));
            float neighborOld = step(0.5, texture(uGolState, fract(uv + offset * uGolTexelSize)).g);
            dir -= offset * neighborOld;
        }
    }
    float len = length(dir);
    vec2 normDir = dir / max(len, 0.001);

    vel.xy += normDir * uVelocityStrength * birth;
    fragColor = vel;
}
