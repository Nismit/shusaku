#version 300 es
precision highp float;

uniform sampler2D uDye;
uniform float uCheckerScale;
uniform float uDispScale;
uniform float uShimmerScale;
uniform float uChromaStrength;

in vec2 vTexCoord;
out vec4 fragColor;

float checkerVal(vec2 uv) {
    vec2 p = uv * uCheckerScale;
    vec2 fw = clamp(fwidth(p), 0.0, 0.45);
    vec2 i = smoothstep(0.5 - fw, 0.5 + fw, fract(p));
    return i.x + i.y - 2.0 * i.x * i.y;
}

void main() {
    vec3 dye = texture(uDye, vTexCoord).rgb;
    vec2 disp = dye.rg * uDispScale;

    // Chromatic aberration: R/G/B channels sampled at slightly different displacements.
    // When disp is zero there is no split, so the effect only appears on active ripples.
    float r = checkerVal(vTexCoord + disp * (1.0 + uChromaStrength));
    float g = checkerVal(vTexCoord + disp);
    float b = checkerVal(vTexCoord + disp * (1.0 - uChromaStrength));

    vec3 colorA = vec3(0.95);
    vec3 colorB = vec3(0.12);
    vec3 base = vec3(
        mix(colorA.r, colorB.r, r),
        mix(colorA.g, colorB.g, g),
        mix(colorA.b, colorB.b, b)
    );

    float shimmer = clamp(dye.b * uShimmerScale, 0.0, 0.4);
    base = mix(base, vec3(1.0), shimmer);

    fragColor = vec4(base, 1.0);
}
