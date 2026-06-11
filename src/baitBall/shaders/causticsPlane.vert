#version 300 es

layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec2 aUV;

uniform vec2 uResolution;
uniform float iZoom;
uniform vec2 iRotation;
uniform float iFloorY;
uniform float iCausticsRadius;
uniform vec2 iCausticsCenter;

out vec2 vUV;
out float vDepthFade;

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

void main() {
    // Scale plane by radius and offset by center
    vec3 worldPos = aPosition * iCausticsRadius;
    worldPos.x += iCausticsCenter.x;
    worldPos.z += iCausticsCenter.y;
    worldPos.y = iFloorY + 0.01; // Slightly above floor

    vUV = aUV;

    // Camera rotation
    mat3 cameraRot = rotateX(iRotation.x) * rotateY(iRotation.y);
    worldPos = cameraRot * worldPos;

    // Perspective projection
    float fov = 1.5;
    float z = worldPos.z + 3.0;
    float perspective = fov / max(z, 0.1);
    vec2 projected = worldPos.xy * perspective * iZoom;
    projected.x *= uResolution.y / uResolution.x;

    // Depth fade: fade out as it goes further from camera
    vDepthFade = 1.0 - smoothstep(1.0, 5.0, z);

    gl_Position = vec4(projected, worldPos.z * 0.1 + 0.0005, 1.0);
}
