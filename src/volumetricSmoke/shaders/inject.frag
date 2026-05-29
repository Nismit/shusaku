// Adds a gaussian blob of uValue into uTarget around uEmitter (cell space).
// Used for both the density field (rgb=color, a=amount) and the velocity
// field (an upward impulse).

uniform sampler2D uTarget;
uniform vec3 uEmitter;  // emitter center in cell space
uniform float uRadius;  // gaussian radius (in cells, squared falloff)
uniform vec4 uValue;    // value added at the center

void main() {
    vec3 cell = fragCell();
    vec3 d = cell - uEmitter;
    float falloff = exp(-dot(d, d) / uRadius);
    vec4 base = texture(uTarget, vTexCoord);
    fragColor = base + uValue * falloff;
}
