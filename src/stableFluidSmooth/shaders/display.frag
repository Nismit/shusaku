#version 300 es
precision highp float;

uniform sampler2D uTexture;

in vec2 vTexCoord;
out vec4 fragColor;

void main() {
    vec3 color = texture(uTexture, vTexCoord).rgb;
    fragColor = vec4(color, 1.0);
}
