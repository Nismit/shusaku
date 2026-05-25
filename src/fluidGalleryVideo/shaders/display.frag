#version 300 es
precision highp float;

uniform sampler2D uDye;
uniform sampler2D uBgImage;
uniform sampler2D uBgImageNext;
uniform float uFadeProgress;
uniform float uDispScale;
uniform float uChromaStrength;
uniform float uOverlayOpacity;

in vec2 vTexCoord;
out vec4 fragColor;

vec3 sampleWithChroma(sampler2D tex, vec2 uv, vec2 disp, float chroma) {
    float r = texture(tex, uv + disp * (1.0 + chroma)).r;
    float g = texture(tex, uv + disp).g;
    float b = texture(tex, uv + disp * (1.0 - chroma)).b;
    return vec3(r, g, b);
}

void main() {
    vec3 dye = texture(uDye, vTexCoord).rgb;
    vec2 disp = dye.rg * uDispScale;

    vec2 bgUV = vec2(vTexCoord.x, 1.0 - vTexCoord.y);

    vec3 colorCurrent = sampleWithChroma(uBgImage, bgUV, disp, uChromaStrength);
    vec3 colorNext = sampleWithChroma(uBgImageNext, bgUV, disp, uChromaStrength);

    vec3 base = mix(colorCurrent, colorNext, uFadeProgress);

    // Dark overlay
    base = mix(base, vec3(0.0), uOverlayOpacity);

    fragColor = vec4(base, 1.0);
}
