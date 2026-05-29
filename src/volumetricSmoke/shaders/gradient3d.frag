// Subtract the pressure gradient to make the velocity field divergence-free.

uniform sampler2D uPressure;
uniform sampler2D uVelocity;

void main() {
    vec3 c = fragCell();
    float l = texture(uPressure, cellToUV(c - vec3(1.0, 0.0, 0.0))).x;
    float r = texture(uPressure, cellToUV(c + vec3(1.0, 0.0, 0.0))).x;
    float b = texture(uPressure, cellToUV(c - vec3(0.0, 1.0, 0.0))).x;
    float t = texture(uPressure, cellToUV(c + vec3(0.0, 1.0, 0.0))).x;
    float d = texture(uPressure, cellToUV(c - vec3(0.0, 0.0, 1.0))).x;
    float u = texture(uPressure, cellToUV(c + vec3(0.0, 0.0, 1.0))).x;

    vec3 vel = texture(uVelocity, vTexCoord).xyz;
    vel -= 0.5 * vec3(r - l, t - b, u - d);
    fragColor = vec4(vel, 0.0);
}
