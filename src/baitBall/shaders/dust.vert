#version 300 es

uniform vec2 uResolution;
uniform float iTime;
uniform float iZoom;
uniform vec2 iRotation;
uniform float iDustSize;
uniform float iDustSpread;
uniform float iDustSpeed;

out float vAlpha;
out float vDepth;
out float vLinearDepth;

mat3 rotateX(float angle) {
    float c = cos(angle);
    float s = sin(angle);
    return mat3(1, 0, 0, 0, c, -s, 0, s, c);
}

mat3 rotateY(float angle) {
    float c = cos(angle);
    float s = sin(angle);
    return mat3(c, 0, s, 0, 1, 0, -s, 0, c);
}

float hash(float n) {
    return fract(sin(n) * 43758.5453123);
}

vec3 hash3(float n) {
    return vec3(
        hash(n),
        hash(n + 127.1),
        hash(n + 269.5)
    );
}

void main() {
    float id = float(gl_VertexID);
    vec3 rand = hash3(id);

    // Particle lifetime cycle
    float lifetime = 8.0 + rand.y * 6.0;
    float particleSpeed = (0.6 + rand.z * 0.5) * iDustSpeed;
    float phase = mod(iTime * particleSpeed + rand.x * lifetime, lifetime);
    float life = phase / lifetime;

    // Start position (spread in X/Z, top in Y)
    vec3 pos;
    pos.x = (rand.x * 2.0 - 1.0) * iDustSpread;
    pos.y = iDustSpread * 1.2;
    pos.z = (rand.z * 2.0 - 1.0) * iDustSpread + 1.2;

    // Fall down with slight drift
    pos.y -= life * iDustSpread * 2.5;
    pos.x += sin(life * 6.28 + rand.y * 6.28) * 0.3;
    pos.z += cos(life * 4.0 + rand.x * 6.28) * 0.2;

    mat3 cameraRot = rotateX(iRotation.x) * rotateY(iRotation.y);
    pos = cameraRot * pos;

    float fov = 1.5;
    float z = pos.z + 3.0;
    float perspective = fov / max(z, 0.1);
    vec2 projected = pos.xy * perspective * iZoom;
    projected.x *= uResolution.y / uResolution.x;

    gl_Position = vec4(projected, pos.z * 0.1, 1.0);
    gl_PointSize = iDustSize * perspective * uResolution.y * 0.01;

    // Fade in/out based on life
    float fadeIn = smoothstep(0.0, 0.1, life);
    float fadeOut = smoothstep(1.0, 0.85, life);
    float distFade = 1.0 - smoothstep(1.5, 3.5, z);

    vAlpha = fadeIn * fadeOut * distFade * (0.3 + rand.x * 0.3);
    vDepth = z;
    vLinearDepth = clamp(z / 6.0, 0.0, 1.0);
}
