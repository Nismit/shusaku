#version 300 es
precision highp float;

uniform sampler2D uVelocity;
uniform float uAmount;
uniform float uScale;
uniform vec2 uPhaseA;
uniform vec2 uPhaseB;

in vec2 vTexCoord;
out vec4 fragColor;

const float TAU = 6.28318530718;

// One cell of a Taylor-Green vortex lattice: the curl of sin(x)sin(y), so it is
// divergence free by construction and carries no net circulation — neighbouring
// cells spin opposite ways. Point forcing was the obvious alternative and it
// spins the whole tank up instead: any imbalance in the jets' angular momentum
// integrates, and everything ends up orbiting the rim.
vec2 lattice(vec2 p) {
    return vec2(sin(p.x) * cos(p.y), -cos(p.x) * sin(p.y));
}

void main() {
    vec2 p = vTexCoord * TAU * uScale;

    // Two lattices an octave apart, both with wandering phase. A lattice at a
    // fixed phase settles into standing cells that trap whatever is inside
    // them; drifting the phases keeps the cells sliding, so the flow keeps
    // handing its contents from one vortex to the next.
    vec2 force = lattice(p + uPhaseA) + 0.6 * lattice(p * 0.5 + uPhaseB);

    fragColor = vec4(texture(uVelocity, vTexCoord).xy + force * uAmount, 0.0, 1.0);
}
