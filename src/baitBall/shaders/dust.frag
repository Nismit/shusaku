#version 300 es
precision highp float;

in float vAlpha;
in float vDepth;

uniform vec3 iDustColor;

out vec4 fragColor;

void main() {
    vec2 coord = gl_PointCoord * 2.0 - 1.0;
    float dist = length(coord);
    float alpha = smoothstep(1.0, 0.3, dist) * vAlpha;

    fragColor = vec4(iDustColor, alpha);
}
