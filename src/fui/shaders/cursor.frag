uniform vec2 uResolution;

// Mouse bracket reticle
uniform vec2 uMousePos;
uniform float uMouseOpacity;
uniform float uBracketHalf;
uniform float uCornerLen;

// Screen frame brackets
uniform float uFrameMargin;
uniform float uFrameCornerLen;
uniform float uFrameOpacity;

// Touch circles
uniform vec2 uTouchPos[5];
uniform float uTouchOpacity[5];
uniform int uTouchCount;
uniform float uCircleRadius;

// Shared
uniform float uThickness;
uniform vec4 uColor;

float distToSeg(vec2 p, vec2 a, vec2 b) {
  vec2 ab = b - a;
  float d2 = dot(ab, ab);
  if (d2 < 0.001) return length(p - a);
  float t = clamp(dot(p - a, ab) / d2, 0.0, 1.0);
  return length(p - (a + t * ab));
}

float brackets(vec2 px, vec2 c, float hs, float cl) {
  float d = 1e10;

  vec2 tl = c + vec2(-hs, -hs);
  d = min(d, distToSeg(px, tl, tl + vec2(cl, 0.0)));
  d = min(d, distToSeg(px, tl, tl + vec2(0.0, cl)));

  vec2 tr = c + vec2(hs, -hs);
  d = min(d, distToSeg(px, tr, tr + vec2(-cl, 0.0)));
  d = min(d, distToSeg(px, tr, tr + vec2(0.0, cl)));

  vec2 bl = c + vec2(-hs, hs);
  d = min(d, distToSeg(px, bl, bl + vec2(cl, 0.0)));
  d = min(d, distToSeg(px, bl, bl + vec2(0.0, -cl)));

  vec2 br = c + vec2(hs, hs);
  d = min(d, distToSeg(px, br, br + vec2(-cl, 0.0)));
  d = min(d, distToSeg(px, br, br + vec2(0.0, -cl)));

  return d;
}

void main() {
  vec2 px = vec2(vTexCoord.x, 1.0 - vTexCoord.y) * uResolution;
  float ht = uThickness * 0.5;
  vec4 color = vec4(0.0);

  // Screen frame corner brackets
  if (uFrameOpacity > 0.001) {
    float m = uFrameMargin;
    float cl = uFrameCornerLen;
    float d = 1e10;

    // Top-left
    vec2 tl = vec2(m, m);
    d = min(d, distToSeg(px, tl, tl + vec2(cl, 0.0)));
    d = min(d, distToSeg(px, tl, tl + vec2(0.0, cl)));

    // Top-right
    vec2 tr = vec2(uResolution.x - m, m);
    d = min(d, distToSeg(px, tr, tr + vec2(-cl, 0.0)));
    d = min(d, distToSeg(px, tr, tr + vec2(0.0, cl)));

    // Bottom-left
    vec2 bl = vec2(m, uResolution.y - m);
    d = min(d, distToSeg(px, bl, bl + vec2(cl, 0.0)));
    d = min(d, distToSeg(px, bl, bl + vec2(0.0, -cl)));

    // Bottom-right
    vec2 br = vec2(uResolution.x - m, uResolution.y - m);
    d = min(d, distToSeg(px, br, br + vec2(-cl, 0.0)));
    d = min(d, distToSeg(px, br, br + vec2(0.0, -cl)));

    float a = smoothstep(ht + 1.0, ht - 1.0, d);
    color = max(color, vec4(uColor.rgb, uColor.a * a * uFrameOpacity));
  }

  // Mouse cursor brackets
  if (uMouseOpacity > 0.001) {
    float d = brackets(px, uMousePos, uBracketHalf, uCornerLen);
    float a = smoothstep(ht + 1.0, ht - 1.0, d);
    color = max(color, vec4(uColor.rgb, uColor.a * a * uMouseOpacity));
  }

  // Touch ring circles
  // Manually unrolled (no loop) so mobile GPU compilers cannot unroll to
  // worst-case 5 iterations; outer guard skips the block entirely when idle.
  if (uTouchCount > 0) {
    float dist, a;

    dist = abs(length(px - uTouchPos[0]) - uCircleRadius);
    a = smoothstep(ht + 1.0, ht - 1.0, dist) * uTouchOpacity[0];
    color = max(color, vec4(uColor.rgb, uColor.a * a));

    if (uTouchCount > 1) {
      dist = abs(length(px - uTouchPos[1]) - uCircleRadius);
      a = smoothstep(ht + 1.0, ht - 1.0, dist) * uTouchOpacity[1];
      color = max(color, vec4(uColor.rgb, uColor.a * a));
    }
    if (uTouchCount > 2) {
      dist = abs(length(px - uTouchPos[2]) - uCircleRadius);
      a = smoothstep(ht + 1.0, ht - 1.0, dist) * uTouchOpacity[2];
      color = max(color, vec4(uColor.rgb, uColor.a * a));
    }
    if (uTouchCount > 3) {
      dist = abs(length(px - uTouchPos[3]) - uCircleRadius);
      a = smoothstep(ht + 1.0, ht - 1.0, dist) * uTouchOpacity[3];
      color = max(color, vec4(uColor.rgb, uColor.a * a));
    }
    if (uTouchCount > 4) {
      dist = abs(length(px - uTouchPos[4]) - uCircleRadius);
      a = smoothstep(ht + 1.0, ht - 1.0, dist) * uTouchOpacity[4];
      color = max(color, vec4(uColor.rgb, uColor.a * a));
    }
  }

  fragColor = color;
}
