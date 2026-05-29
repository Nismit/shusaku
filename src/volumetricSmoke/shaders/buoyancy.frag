// Applies buoyancy: hot/dense smoke rises. Density amount is stored in the
// alpha channel of the density field and pushes velocity in +Y.

uniform sampler2D uVelocity;
uniform sampler2D uDensity;
uniform float uBuoyancy;
uniform float uDt;

void main() {
    vec3 vel = texture(uVelocity, vTexCoord).xyz;
    float dens = texture(uDensity, vTexCoord).a;
    vel.y += dens * uBuoyancy * uDt;
    fragColor = vec4(vel, 0.0);
}
