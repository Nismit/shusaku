#version 300 es
precision highp float;

in vec2 vTexCoord;
out vec4 fragColor;

uniform vec2 uTexSize;
uniform float uSeed;
uniform float uRingRadius;
uniform float uRingThickness;

const float TWO_PI = 6.28318530718;

uint hash(uint x) {
    x ^= x >> 16u;
    x *= 0x85ebca6bu;
    x ^= x >> 13u;
    x *= 0xc2b2ae35u;
    x ^= x >> 16u;
    return x;
}

float random(uint seed) {
    return float(hash(seed)) / float(0xffffffffu);
}

void main() {
    ivec2 coord = ivec2(gl_FragCoord.xy);
    uint idx = uint(coord.y) * uint(uTexSize.x) + uint(coord.x);
    uint seed = idx * 7u + uint(uSeed);

    // Random point inside a torus volume (ring band)
    float t = random(seed + 3u) * TWO_PI;
    float phi = random(seed + 4u) * TWO_PI;
    float rho = uRingThickness * sqrt(random(seed + 5u));
    float r = uRingRadius + rho * cos(phi);
    vec3 pos = vec3(r * cos(t), rho * sin(phi), r * sin(t));

    // Random initial lifetime (staggered)
    float life = random(seed + 6u);

    fragColor = vec4(pos, life);
}
