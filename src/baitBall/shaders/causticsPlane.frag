#version 300 es
precision highp float;

in vec2 vUV;
in float vDepthFade;

uniform float iTime;
uniform float iCausticsScale;
uniform float iCausticsSpeed;
uniform float iCausticsIntensity;
uniform float iCausticsAberration;
uniform vec3 iCausticsColor;

out vec4 fragColor;

vec2 rotate2D(vec2 v, float a) {
    float c = cos(a);
    float s = sin(a);
    return vec2(v.x * c - v.y * s, v.x * s + v.y * c);
}

// Based on neuro-noise by zozuar
float neuroNoise(vec2 uv, float t) {
    vec2 sineAcc = vec2(0.0);
    vec2 res = vec2(0.0);
    float scale = 8.0;

    for (int j = 0; j < 15; j++) {
        uv = rotate2D(uv, 1.0);
        sineAcc = rotate2D(sineAcc, 1.0);
        vec2 layer = uv * scale + float(j) + sineAcc - t;
        sineAcc += sin(layer);
        res += (0.5 + 0.5 * cos(layer)) / scale;
        scale *= 1.2;
    }
    return res.x + res.y;
}

float causticsPattern(vec2 uv, float t) {
    float noise = neuroNoise(uv, t);
    noise = noise * noise;
    noise = pow(noise, 0.8);
    return min(1.0, noise);
}

void main() {
    // Center UV from 0-1 to -1 to 1
    vec2 uv = (vUV - 0.5) * 2.0;

    // Circular fade
    float dist = length(uv);
    float fade = 1.0 - smoothstep(0.6, 1.0, dist);

    // Caustics
    float t = iTime * iCausticsSpeed;
    vec2 scaledUV = uv * iCausticsScale;

    float r = causticsPattern(scaledUV + vec2(iCausticsAberration, 0.0), t);
    float g = causticsPattern(scaledUV, t);
    float b = causticsPattern(scaledUV - vec2(iCausticsAberration, 0.0), t);

    vec3 caust = vec3(r, g, b) * iCausticsColor * iCausticsIntensity;
    caust *= fade;

    // Apply depth fade (fade into background at distance)
    caust *= vDepthFade;

    // Premultiplied alpha for additive blending
    fragColor = vec4(caust, fade * iCausticsIntensity * vDepthFade);
}
