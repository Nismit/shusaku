#version 300 es
precision highp float;

in vec2 vTexCoord;
out vec4 fragColor;

uniform sampler2D uPosition;
uniform vec2 uTexSize;
uniform float iTime;
uniform float iLifetime;

// Flow field parameters
uniform float iRingRadius;
uniform float iRingThickness;
uniform float iRingPull;
uniform float iSwirlSpeed;
uniform float iSwirlWobble;
uniform float iWobbleSpeed;
uniform float iCurlLargeAmount;
uniform float iCurlLargeScale;
uniform float iCurlSmallAmount;
uniform float iCurlSmallScale;
uniform float iScatter;
uniform float iNoiseSpeed;

// Mouse interaction
uniform vec3 iMousePos;
uniform float iMouseActive;
uniform float iAvoidRadius;
uniform float iAvoidStrength;

const float PI = 3.14159265359;
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

vec3 hash33(vec3 p) {
    p = vec3(
        dot(p, vec3(127.1, 311.7, 74.7)),
        dot(p, vec3(269.5, 183.3, 246.1)),
        dot(p, vec3(113.5, 271.9, 124.6))
    );
    return fract(sin(p) * 43758.5453123) * 2.0 - 1.0;
}

float gradientNoise3D(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);

    return mix(
        mix(mix(dot(hash33(i + vec3(0, 0, 0)), f - vec3(0, 0, 0)),
                dot(hash33(i + vec3(1, 0, 0)), f - vec3(1, 0, 0)), u.x),
            mix(dot(hash33(i + vec3(0, 1, 0)), f - vec3(0, 1, 0)),
                dot(hash33(i + vec3(1, 1, 0)), f - vec3(1, 1, 0)), u.x), u.y),
        mix(mix(dot(hash33(i + vec3(0, 0, 1)), f - vec3(0, 0, 1)),
                dot(hash33(i + vec3(1, 0, 1)), f - vec3(1, 0, 1)), u.x),
            mix(dot(hash33(i + vec3(0, 1, 1)), f - vec3(0, 1, 1)),
                dot(hash33(i + vec3(1, 1, 1)), f - vec3(1, 1, 1)), u.x), u.y),
        u.z);
}

float fbm(vec3 p, int octaves) {
    float value = 0.0;
    float amplitude = 0.5;
    float frequency = 1.0;
    for (int i = 0; i < octaves; i++) {
        value += amplitude * gradientNoise3D(p * frequency);
        frequency *= 2.0;
        amplitude *= 0.5;
    }
    return value;
}

vec3 curlNoise(vec3 p, float t) {
    float e = 0.1;
    vec3 px = p + vec3(e, 0.0, 0.0);
    vec3 py = p + vec3(0.0, e, 0.0);
    vec3 pz = p + vec3(0.0, 0.0, e);
    vec3 mx = p - vec3(e, 0.0, 0.0);
    vec3 my = p - vec3(0.0, e, 0.0);
    vec3 mz = p - vec3(0.0, 0.0, e);

    float nx = fbm(py + t, 2) - fbm(my + t, 2);
    float ny = fbm(pz + t, 2) - fbm(mz + t, 2);
    float nz = fbm(px + t, 2) - fbm(mx + t, 2);

    return vec3(nx, ny, nz) / (2.0 * e);
}

// Random point inside a torus volume (ring band)
vec3 torusSpawn(uint seed) {
    float t = random(seed) * TWO_PI;
    float phi = random(seed + 1u) * TWO_PI;
    float rho = iRingThickness * sqrt(random(seed + 2u));
    float r = iRingRadius + rho * cos(phi);
    return vec3(r * cos(t), rho * sin(phi), r * sin(t));
}

void main() {
    ivec2 coord = ivec2(gl_FragCoord.xy);
    uint idx = uint(coord.y) * uint(uTexSize.x) + uint(coord.x);

    vec4 posData = texelFetch(uPosition, coord, 0);
    vec3 pos = posData.xyz;
    float life = posData.w;

    // Lifetime decay
    float lifeDecay = 1.0 / (iLifetime * 60.0);
    life -= lifeDecay;

    // Respawn inside the ring band
    if (life <= 0.0) {
        uint seed = idx * 7u + uint(iTime * 1000.0);
        pos = torusSpawn(seed);
        life = 1.0;
    }

    // Per-particle randoms (stable across frames)
    uint pseed = idx * 7919u + 13u;
    vec3 particleOffset = vec3(random(pseed), random(pseed + 1u), random(pseed + 2u)) * 20.0 - 10.0;
    float speedVar = mix(0.75, 1.25, random(pseed + 3u));

    float noiseT = iTime * iNoiseSpeed;

    // --- Large swirl: slow rotation around a wobbling (precessing) axis ---
    float wob = iTime * iWobbleSpeed;
    vec3 axis = normalize(vec3(sin(wob) * iSwirlWobble, 1.0, cos(wob * 0.73) * iSwirlWobble));
    vec3 swirl = cross(axis, pos) * iSwirlSpeed;

    // --- Large curl: low-frequency undulation shared by the whole swarm ---
    vec3 curlLarge = curlNoise(pos * iCurlLargeScale, noiseT) * iCurlLargeAmount;

    // --- Small curl: per-particle noise offset decorrelates neighbors ---
    vec3 curlSmall = curlNoise(pos * iCurlSmallScale + particleOffset * iScatter, noiseT * 1.7) * iCurlSmallAmount;

    vec3 velocity = (swirl + curlLarge + curlSmall) * speedVar;

    // --- Mouse avoidance: natural fish-like escape behavior ---
    if (iMouseActive > 0.5) {
        vec3 toMouse = pos - iMousePos;
        float distToMouse = length(toMouse);

        // Per-particle variation in reaction
        float reactVar = mix(0.7, 1.3, random(pseed + 100u));
        float effectiveRadius = iAvoidRadius * reactVar * 1.5;

        if (distToMouse < effectiveRadius && distToMouse > 1e-4) {
            // Quintic smoothstep for ultra-smooth falloff
            float t = clamp(distToMouse / effectiveRadius, 0.0, 1.0);
            float t3 = t * t * t;
            float t4 = t3 * t;
            float t5 = t4 * t;
            float avoidFactor = 1.0 - (6.0 * t5 - 15.0 * t4 + 10.0 * t3);

            vec3 awayDir = toMouse / distToMouse;

            // Blend current velocity direction for smoother turning
            vec3 currentDir = length(velocity) > 1e-4 ? normalize(velocity) : awayDir;
            float blendAway = mix(0.3, 0.6, avoidFactor);
            vec3 blendedAway = normalize(mix(currentDir, awayDir, blendAway));

            // Add tangential component - fish swim around, not just away
            vec3 up = vec3(0.0, 1.0, 0.0);
            vec3 tangent = normalize(cross(blendedAway, up));
            if (length(tangent) < 0.1) tangent = normalize(cross(blendedAway, vec3(1.0, 0.0, 0.0)));

            float tangentSign = random(pseed + 200u) > 0.5 ? 1.0 : -1.0;
            float tangentAmount = mix(0.4, 0.8, random(pseed + 300u));

            vec3 escapeDir = normalize(blendedAway + tangent * tangentSign * tangentAmount);

            // Gentle strength variation
            float strengthVar = mix(0.8, 1.2, random(pseed + 400u));
            float gentleFactor = avoidFactor * avoidFactor;
            velocity += escapeDir * gentleFactor * iAvoidStrength * strengthVar * 0.7;
        }
    }

    // --- Soft containment: pull back toward the ring band when drifting out ---
    float d = length(pos.xz);
    vec2 ringDir = d > 1e-4 ? pos.xz / d : vec2(1.0, 0.0);
    vec3 ringPoint = vec3(ringDir.x * iRingRadius, 0.0, ringDir.y * iRingRadius);
    vec3 toRing = ringPoint - pos;
    float distToRing = length(toRing);
    float excess = max(distToRing - iRingThickness, 0.0);
    if (distToRing > 1e-4) {
        velocity += (toRing / distToRing) * excess * iRingPull;
    }

    // Apply movement
    pos += velocity * 0.016;

    fragColor = vec4(pos, life);
}
