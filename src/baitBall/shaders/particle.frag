#version 300 es
precision highp float;

in vec3 vNormal;
in vec3 vWorldPos;
in float vLife;
in float vInstanceRandom;

uniform vec3 iLightDir;
uniform vec3 iLightColor;
uniform float iAmbient;
uniform vec3 iAmbientColor;
uniform vec3 iBaseColor;
uniform vec3 iAccentColor;
uniform float iColorMix;

out vec4 fragColor;

void main() {
    vec3 normal = normalize(vNormal);
    vec3 lightDir = normalize(iLightDir);

    // Soft lighting
    float diff = max(dot(normal, lightDir), 0.0);
    vec3 diffuse = diff * iLightColor;
    vec3 ambient = iAmbient * iAmbientColor;

    // Color based on instance random and life
    float colorT = mix(vInstanceRandom, vLife, iColorMix);
    vec3 baseColor = mix(iBaseColor, iAccentColor, colorT);

    vec3 color = baseColor * (ambient + diffuse);

    // Smooth fade based on life
    float alpha = smoothstep(0.0, 0.15, vLife) * smoothstep(0.0, 0.25, 1.0 - vLife);

    fragColor = vec4(color, alpha);
}
