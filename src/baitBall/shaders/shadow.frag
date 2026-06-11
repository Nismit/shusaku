#version 300 es
precision highp float;

in float vShadowAlpha;

uniform vec3 iFloorColor;

out vec4 fragColor;

const vec3 SHADOW_TINT = vec3(0.05, 0.05, 0.12);

void main() {
    vec3 shadowColor = mix(SHADOW_TINT, iFloorColor * 0.3, 0.4);
    fragColor = vec4(shadowColor, vShadowAlpha);
}
