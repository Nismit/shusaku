// 3D semi-Lagrangian advection. Shared by the velocity and density fields
// (uSource is whatever is being transported by uVelocity). Velocity is in
// cells/second so the back-trace is simply cell - vel * dt.

uniform sampler2D uSource;
uniform sampler2D uVelocity;
uniform float uDt;
uniform float uDissipation;

void main() {
    vec3 cell = fragCell();

    // Solid wall on the volume border.
    if (isBoundary(cell)) {
        fragColor = vec4(0.0);
        return;
    }

    vec3 vel = sampleVolume(uVelocity, cell).xyz;
    vec3 pos = cell - vel * uDt;
    vec4 result = sampleVolume(uSource, pos);

    float decay = 1.0 / (1.0 + uDissipation * uDt);
    fragColor = result * decay;
}
