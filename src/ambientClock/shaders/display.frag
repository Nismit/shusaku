#version 300 es
precision highp float;

uniform sampler2D uDye;
uniform sampler2D uBgImage;
uniform sampler2D uBgImageNext;
uniform float uFadeProgress;
uniform float uDispScale;
uniform float uChromaStrength;
uniform float uOverlayOpacity;
uniform float uVideoAspect;
uniform float uVideoAspectNext;
uniform float uCanvasAspect;

in vec2 vTexCoord;
out vec4 fragColor;

// object-fit: cover — always fills the canvas, crops overflow
vec2 coverUV(vec2 uv, float canvasAspect, float videoAspect) {
    if (canvasAspect > videoAspect) {
        // Canvas wider: fit width, crop height
        uv.y = (uv.y - 0.5) * (videoAspect / canvasAspect) + 0.5;
    } else {
        // Canvas taller (portrait): fit height, crop width
        uv.x = (uv.x - 0.5) * (canvasAspect / videoAspect) + 0.5;
    }
    return uv;
}

vec3 sampleWithChroma(sampler2D tex, vec2 uv, vec2 disp, float chroma) {
    float r = texture(tex, uv + disp * (1.0 + chroma)).r;
    float g = texture(tex, uv + disp).g;
    float b = texture(tex, uv + disp * (1.0 - chroma)).b;
    return vec3(r, g, b);
}

void main() {
    vec3 dye = texture(uDye, vTexCoord).rgb;
    vec2 disp = dye.rg * uDispScale;

    vec2 baseUV = vec2(vTexCoord.x, 1.0 - vTexCoord.y);

    vec2 bgUV     = coverUV(baseUV, uCanvasAspect, uVideoAspect);
    vec2 bgUVNext = coverUV(baseUV, uCanvasAspect, uVideoAspectNext);

    vec3 colorCurrent = sampleWithChroma(uBgImage,     bgUV,     disp, uChromaStrength);
    vec3 colorNext    = sampleWithChroma(uBgImageNext, bgUVNext, disp, uChromaStrength);

    vec3 base = mix(colorCurrent, colorNext, uFadeProgress);

    // Dark overlay
    base = mix(base, vec3(0.0), uOverlayOpacity);

    fragColor = vec4(base, 1.0);
}
