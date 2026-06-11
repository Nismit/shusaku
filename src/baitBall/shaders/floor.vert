#version 300 es

layout(location = 0) in vec3 aPosition;

uniform vec2 uResolution;
uniform float iZoom;
uniform vec2 iRotation;
uniform float iFloorY;

out vec2 vFloorUV;
out vec3 vFloorWorldPos;
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

void main() {
    vec3 worldPos = aPosition;
    worldPos.y = iFloorY;

    vFloorUV = aPosition.xz;
    vFloorWorldPos = worldPos;

    mat3 cameraRot = rotateX(iRotation.x) * rotateY(iRotation.y);
    worldPos = cameraRot * worldPos;

    float fov = 1.5;
    float z = worldPos.z + 3.0;
    float perspective = fov / max(z, 0.1);
    vec2 projected = worldPos.xy * perspective * iZoom;
    projected.x *= uResolution.y / uResolution.x;

    gl_Position = vec4(projected, worldPos.z * 0.1 + 0.001, 1.0);
    vLinearDepth = clamp(z / 6.0, 0.0, 1.0);
}
