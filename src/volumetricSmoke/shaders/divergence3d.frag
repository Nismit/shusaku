// Velocity divergence using the 6 axis neighbours of the 3D grid.

uniform sampler2D uVelocity;

void main() {
    vec3 c = fragCell();
    float xL = texture(uVelocity, cellToUV(c - vec3(1.0, 0.0, 0.0))).x;
    float xR = texture(uVelocity, cellToUV(c + vec3(1.0, 0.0, 0.0))).x;
    float yB = texture(uVelocity, cellToUV(c - vec3(0.0, 1.0, 0.0))).y;
    float yT = texture(uVelocity, cellToUV(c + vec3(0.0, 1.0, 0.0))).y;
    float zD = texture(uVelocity, cellToUV(c - vec3(0.0, 0.0, 1.0))).z;
    float zU = texture(uVelocity, cellToUV(c + vec3(0.0, 0.0, 1.0))).z;
    float div = 0.5 * ((xR - xL) + (yT - yB) + (zU - zD));
    fragColor = vec4(div, 0.0, 0.0, 1.0);
}
