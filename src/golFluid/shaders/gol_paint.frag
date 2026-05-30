#version 300 es
precision highp float;

uniform sampler2D uGolState;
uniform vec2 uPoint;    // brush center in normalized [0,1] coords
uniform float uRadius;  // brush radius in normalized coords
uniform float uPaint;   // 1.0=paint alive, 0.0=erase

in vec2 vTexCoord;
out vec4 fragColor;

void main() {
    vec4 state = texture(uGolState, vTexCoord);
    float dist = length(vTexCoord - uPoint);

    if (dist < uRadius) {
        // Set new/old states so injection detects changes on next GoL step
        fragColor = vec4(uPaint, 1.0 - uPaint, 0.0, 1.0);
    } else {
        fragColor = state;
    }
}
