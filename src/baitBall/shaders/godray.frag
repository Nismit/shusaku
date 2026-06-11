#version 300 es
precision highp float;

in vec2 vTexCoord;
out vec4 fragColor;

uniform sampler2D uTexture;
uniform sampler2D uBloom;
uniform sampler2D uDepth;
uniform float iTime;
uniform float iBloomStrength;
uniform float iGodrayStrength;
uniform float iGodraySpeed;
uniform float iGodrayScale;
uniform float iGodrayFalloff;
uniform vec3 iGodrayColor;
uniform float iFogStrength;
uniform vec3 iFogColor;

float hash(float n) {
    return fract(sin(n) * 43758.5453);
}

float noise(float x) {
    float i = floor(x);
    float f = fract(x);
    float u = f * f * (3.0 - 2.0 * f);
    return mix(hash(i), hash(i + 1.0), u);
}

float fbm(float x, int octaves) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < octaves; i++) {
        v += a * noise(x);
        x *= 2.0;
        a *= 0.5;
    }
    return v;
}

float godRays(vec2 uv, float time) {
    // Light source above screen center
    vec2 lightPos = vec2(0.5, 1.3);
    vec2 toLight = lightPos - uv;
    float dist = length(toLight);
    float angle = atan(toLight.x, toLight.y);

    // Radial rays emanating from light source
    float rays = 0.0;
    float rayCount = iGodrayScale * 8.0;

    for (int i = 0; i < 3; i++) {
        float fi = float(i);

        // Noise-based ray modulation
        float rayAngle = angle * rayCount + fi * 2.1;
        float rayNoise = fbm(rayAngle, 3);

        // Flickering intensity - each ray fades in and out independently
        float flickerPhase = rayAngle * 0.5 + fi * 3.7;
        float flicker = sin(time * iGodraySpeed * 3.0 + flickerPhase);
        flicker += sin(time * iGodraySpeed * 1.7 + flickerPhase * 1.3) * 0.5;
        flicker += fbm(flickerPhase + time * iGodraySpeed * 0.5, 2) * 0.8;
        flicker = flicker * 0.3 + 0.5;
        flicker = clamp(flicker, 0.0, 1.0);

        rayNoise *= flicker;

        rays += rayNoise * (0.4 - fi * 0.1);
    }

    // Vertical falloff - stronger at top, fades toward bottom
    float verticalFade = pow(uv.y, iGodrayFalloff * 0.5);

    // Radial falloff from center
    float centerDist = abs(uv.x - 0.5);
    float radialFade = 1.0 - smoothstep(0.0, 0.5, centerDist);

    // Combine
    rays *= verticalFade * radialFade;
    rays = max(rays, 0.0);

    return rays * 0.5;
}

void main() {
    vec4 original = texture(uTexture, vTexCoord);
    vec4 bloom = texture(uBloom, vTexCoord);
    float depth = texture(uDepth, vTexCoord).r;

    // Fog based on depth
    float fogFactor = smoothstep(0.3, 1.0, depth) * iFogStrength;
    vec3 fogged = mix(original.rgb, iFogColor, fogFactor);

    float rays = godRays(vTexCoord, iTime);
    vec3 godrayContribution = iGodrayColor * rays * iGodrayStrength;

    vec3 result = fogged + bloom.rgb * iBloomStrength + godrayContribution;

    fragColor = vec4(result, 1.0);
}
