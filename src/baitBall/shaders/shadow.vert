#version 300 es

layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aNormal;

uniform sampler2D uPosition;
uniform sampler2D uPrevPosition;
uniform vec2 uTexSize;
uniform vec2 uResolution;
uniform float iTime;
uniform float iParticleSize;
uniform float iRodThickness;
uniform float iFishHeight;
uniform float iSizeVariation;
uniform float iZoom;
uniform vec2 iRotation;
uniform float iFloorY;
uniform vec3 iLightDir;

out float vShadowAlpha;

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
    int instanceID = gl_InstanceID;
    int texX = instanceID % int(uTexSize.x);
    int texY = instanceID / int(uTexSize.x);
    ivec2 texCoord = ivec2(texX, texY);

    vec4 posData = texelFetch(uPosition, texCoord, 0);
    vec3 instancePos = posData.xyz;
    float life = posData.w;

    float instanceRandom = fract(sin(float(instanceID) * 12.9898 + 78.233) * 43758.5453);

    vec3 animatedPos = instancePos;

    // Direction from actual movement (current - previous frame position)
    vec3 prevPos = texelFetch(uPrevPosition, texCoord, 0).xyz;
    vec3 dir = animatedPos - prevPos;
    float dirLen = length(dir);
    dir = dirLen > 1e-6 ? dir / dirLen : vec3(1.0, 0.0, 0.0);

    float sizeScale = 1.0 - iSizeVariation * 0.5 + instanceRandom * iSizeVariation;
    float fadeIn = smoothstep(0.0, 0.15, life);
    float fadeOut = smoothstep(0.0, 0.25, 1.0 - life);
    float scaleFactor = fadeIn * fadeOut;

    vec3 scale = vec3(iParticleSize, iFishHeight, iRodThickness);
    vec3 localPos = aPosition * scale * scaleFactor * sizeScale;

    vec3 up = abs(dir.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
    vec3 right = normalize(cross(up, dir));
    up = normalize(cross(dir, right));
    mat3 instanceRotation = mat3(dir, up, right);

    vec3 rotatedPos = instanceRotation * localPos;
    vec3 worldPos = animatedPos + rotatedPos;

    // Project shadow onto floor plane along light direction
    vec3 lightDir = normalize(iLightDir);
    float t = (iFloorY - worldPos.y) / lightDir.y;
    vec3 shadowPos = worldPos + lightDir * t;

    // Shadow softness based on height above floor
    float heightAboveFloor = worldPos.y - iFloorY;
    vShadowAlpha = scaleFactor * smoothstep(2.0, 0.0, heightAboveFloor) * 0.5;

    // Apply camera rotation
    mat3 cameraRot = rotateX(iRotation.x) * rotateY(iRotation.y);
    shadowPos = cameraRot * shadowPos;

    float fov = 1.5;
    float z = shadowPos.z + 3.0;
    float perspective = fov / max(z, 0.1);
    vec2 projected = shadowPos.xy * perspective * iZoom;
    projected.x *= uResolution.y / uResolution.x;

    gl_Position = vec4(projected, shadowPos.z * 0.1 + 0.0005, 1.0);
}
