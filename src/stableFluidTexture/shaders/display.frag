#version 300 es
precision highp float;

uniform sampler2D uDye;
uniform float uCheckerScale;
uniform float uDispScale;
uniform float uShimmerScale;

in vec2 vTexCoord;
out vec4 fragColor;

void main() {
    vec3 dye = texture(uDye, vTexCoord).rgb;

    // Displace sampling position by the fluid's flow direction — water-refraction effect
    vec2 sampleUV = vTexCoord + dye.rg * uDispScale;

    // Anti-aliased checker pattern sampled at the displaced position
    vec2 p = sampleUV * uCheckerScale;
    vec2 fw = clamp(fwidth(p), 0.0, 0.45);
    vec2 i = smoothstep(0.5 - fw, 0.5 + fw, fract(p));
    float checker = i.x + i.y - 2.0 * i.x * i.y;

    vec3 colorA = vec3(0.95);
    vec3 colorB = vec3(0.12);
    vec3 base = mix(colorA, colorB, checker);

    // Subtle white shimmer where the fluid is moving fast (water-surface highlight)
    float shimmer = clamp(dye.b * uShimmerScale, 0.0, 0.4);
    base = mix(base, vec3(1.0), shimmer);

    fragColor = vec4(base, 1.0);
}
