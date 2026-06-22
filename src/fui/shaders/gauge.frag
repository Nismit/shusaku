uniform vec2 uResolution;
uniform vec4 uRect;
uniform float uProgress;
uniform float uBorderWidth;
uniform vec4 uBorderColor;
uniform vec4 uFillColor;
uniform vec4 uBgColor;

void main() {
  vec2 px = vec2(vTexCoord.x, 1.0 - vTexCoord.y) * uResolution;

  vec2 rMin = uRect.xy;
  vec2 rMax = uRect.xy + uRect.zw;

  if (px.x < rMin.x || px.x > rMax.x || px.y < rMin.y || px.y > rMax.y) {
    fragColor = vec4(0.0);
    return;
  }

  float bw = uBorderWidth;
  vec2 iMin = rMin + bw;
  vec2 iMax = rMax - bw;

  if (px.x < iMin.x || px.x > iMax.x || px.y < iMin.y || px.y > iMax.y) {
    fragColor = uBorderColor;
    return;
  }

  float fillX = iMin.x + (iMax.x - iMin.x) * uProgress;
  fragColor = px.x <= fillX ? uFillColor : uBgColor;
}
