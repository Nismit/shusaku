#version 300 es
precision highp float;

in vec2 vTexCoord;
out vec4 fragColor;

uniform sampler2D uTexture;
uniform float iThreshold; // @gui: min=0.0, max=1.0, step=0.01

void main() {
  vec4 color = texture(uTexture, vTexCoord);
  float brightness = dot(color.rgb, vec3(0.2126, 0.7152, 0.0722));

  if (brightness > iThreshold) {
    fragColor = color;
  } else {
    fragColor = vec4(0.0, 0.0, 0.0, 1.0);
  }
}
