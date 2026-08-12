#version 300 es
precision highp float;

uniform sampler2D uTarget;
uniform vec2 uPoint;
uniform vec3 uColor;
uniform float uRadius;
uniform float uAspect;

in vec2 vTexCoord;
out vec4 fragColor;

void main() {
    vec2 p = vTexCoord - uPoint;
    p.x *= uAspect;
    float d = exp(-dot(p, p) / uRadius);
    vec3 base = texture(uTarget, vTexCoord).rgb;
    fragColor = vec4(base + uColor * d, 1.0);
}
