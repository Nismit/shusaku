#version 300 es
precision highp float;

uniform sampler2D uDye;
uniform sampler2D uGolState;
uniform vec2 uGolTexelSize;
uniform float uCellBrightness;
uniform float uShowCells;

in vec2 vTexCoord;
out vec4 fragColor;

void main() {
    vec2 uv = vTexCoord;
    vec3 color = texture(uDye, uv).rgb;

    if (uShowCells > 0.5) {
        // Soft 3x3 glow from living cells
        float glow = 0.0;
        for (int dy = -1; dy <= 1; dy++) {
            for (int dx = -1; dx <= 1; dx++) {
                vec2 offset = vec2(float(dx), float(dy));
                float s = step(0.5, texture(uGolState, uv + offset * uGolTexelSize).r);
                float falloff = 1.0 / (1.0 + length(offset) * 0.8);
                glow += s * falloff;
            }
        }
        color += vec3(0.3, 0.7, 1.0) * glow * uCellBrightness;
    }

    // Exposure tone mapping
    color = 1.0 - exp(-color * 1.2);

    fragColor = vec4(color, 1.0);
}
