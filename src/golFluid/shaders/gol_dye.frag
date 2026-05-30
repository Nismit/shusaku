#version 300 es
precision highp float;

uniform sampler2D uGolState;    // R=new state, G=old state
uniform sampler2D uDye;
uniform float uDyeStrength;
uniform vec3 uBirthColor;
uniform vec3 uDeathColor;

in vec2 vTexCoord;
out vec4 fragColor;

void main() {
    vec2 uv = vTexCoord;
    vec4 gol = texture(uGolState, uv);
    float newState = step(0.5, gol.r);
    float oldState = step(0.5, gol.g);
    float birth = newState * (1.0 - oldState);
    float death  = (1.0 - newState) * oldState;

    vec4 dye = texture(uDye, uv);
    dye.rgb += uBirthColor * birth * uDyeStrength;
    dye.rgb += uDeathColor * death * uDyeStrength * 0.5;
    fragColor = dye;
}
