#version 300 es
precision highp float;

uniform sampler2D uSource;
uniform sampler2D uVelocity;
uniform float uDt;
uniform float uDissipation;
uniform vec2 uTexelSize;

in vec2 vTexCoord;
out vec4 fragColor;

void main() {
    vec2 uv = vTexCoord;
    vec2 px = uTexelSize;

    // Boundary: 1px wall
    if (uv.x < px.x || uv.x > 1.0 - px.x || uv.y < px.y || uv.y > 1.0 - px.y) {
        fragColor = vec4(0.0);
        return;
    }

    // BFECC (Back-and-Forth Error Correction and Compensation)
    vec2 vel0 = texture(uVelocity, uv).xy;

    // Back trace
    vec2 pos1 = uv - vel0 * uDt;
    vec4 val1 = texture(uSource, pos1);
    vec2 vel1 = texture(uVelocity, pos1).xy;

    // Forward trace
    vec2 pos2 = pos1 + vel1 * uDt;

    // Error correction
    vec2 error = pos2 - uv;
    vec2 pos3 = uv - error * 0.5;
    vec2 vel2 = texture(uVelocity, pos3).xy;

    // Back trace again with corrected position
    vec2 pos4 = pos3 - vel2 * uDt;
    vec4 result = texture(uSource, pos4);

    float decay = 1.0 / (1.0 + uDissipation * uDt);
    fragColor = result * decay;
}
