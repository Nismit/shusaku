uniform vec2 uResolution;
uniform vec4 uRect;          // x, y, width, height in pixels
uniform float uValues[128];  // normalized values 0-1
uniform int uValueCount;
uniform vec4 uLineColor;
uniform vec4 uBgColor;
uniform float uLineWidth;

void main() {
  vec2 pixelCoord = vec2(vTexCoord.x, 1.0 - vTexCoord.y) * uResolution;

  // Check if pixel is inside the graph rect
  vec2 rectMin = uRect.xy;
  vec2 rectMax = uRect.xy + uRect.zw;

  if (pixelCoord.x < rectMin.x || pixelCoord.x > rectMax.x ||
      pixelCoord.y < rectMin.y || pixelCoord.y > rectMax.y) {
    fragColor = vec4(0.0);
    return;
  }

  // Normalize position within rect (0-1)
  vec2 uv = (pixelCoord - rectMin) / uRect.zw;

  // Background
  vec4 color = uBgColor;

  // Find the two values this x position is between
  float xIndex = uv.x * float(uValueCount - 1);
  int i0 = int(floor(xIndex));
  int i1 = min(i0 + 1, uValueCount - 1);
  float t = fract(xIndex);

  // Interpolate value
  float v0 = uValues[i0];
  float v1 = uValues[i1];
  float value = mix(v0, v1, t);

  // Distance from the line
  float lineY = value;
  float dist = abs(uv.y - lineY) * uRect.w;

  // Anti-aliased line
  float lineAlpha = 1.0 - smoothstep(uLineWidth * 0.5 - 1.0, uLineWidth * 0.5 + 1.0, dist);

  // Fill below the line (optional, subtle)
  float fillAlpha = smoothstep(lineY + 0.02, lineY - 0.02, uv.y) * 0.15;

  color = mix(color, vec4(uLineColor.rgb, uLineColor.a * 0.3), fillAlpha);
  color = mix(color, uLineColor, lineAlpha * uLineColor.a);

  fragColor = color;
}
