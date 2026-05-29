// One Jacobi iteration of the 3D pressure Poisson equation (6 neighbours).

uniform sampler2D uPressure;
uniform sampler2D uDivergence;

void main() {
    vec3 c = fragCell();
    float l = texture(uPressure, cellToUV(c - vec3(1.0, 0.0, 0.0))).x;
    float r = texture(uPressure, cellToUV(c + vec3(1.0, 0.0, 0.0))).x;
    float b = texture(uPressure, cellToUV(c - vec3(0.0, 1.0, 0.0))).x;
    float t = texture(uPressure, cellToUV(c + vec3(0.0, 1.0, 0.0))).x;
    float d = texture(uPressure, cellToUV(c - vec3(0.0, 0.0, 1.0))).x;
    float u = texture(uPressure, cellToUV(c + vec3(0.0, 0.0, 1.0))).x;
    float div = texture(uDivergence, vTexCoord).x;
    float p = (l + r + b + t + d + u - div) / 6.0;
    fragColor = vec4(p, 0.0, 0.0, 1.0);
}
