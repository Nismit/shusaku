precision highp float;

uniform sampler2D uCoverage;
uniform vec3 uInk;
uniform vec3 uBg;
uniform float uGrain;
uniform float uGrainScale;
uniform float uTime;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

void main() {
  float coverage = texture(uCoverage, vTexCoord).a;
  vec3 color = mix(uBg, uInk, coverage);

  // Static-ish grain, sized in physical pixels so it stays constant on retina.
  vec2 cell = floor(gl_FragCoord.xy / max(uGrainScale, 1.0));
  float n = hash(cell + floor(uTime * 24.0)) - 0.5;
  color += n * uGrain;

  fragColor = vec4(color, 1.0);
}
