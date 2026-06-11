#version 300 es
precision highp float;

in vec2 vFloorUV;
in vec3 vFloorWorldPos;

uniform vec3 iBgColor;
uniform vec3 iFloorColor;
uniform float iFloorFade;

out vec4 fragColor;

void main() {
    float dist = length(vFloorWorldPos.xz);
    float fade = 1.0 - smoothstep(0.0, iFloorFade, dist);

    vec3 color = mix(iBgColor, iFloorColor, fade * 0.6);

    fragColor = vec4(color, 1.0);
}
