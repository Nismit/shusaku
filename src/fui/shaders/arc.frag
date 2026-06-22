// Aircraft attitude indicator arc gauges.
// Left arc = roll (gamma), right arc = pitch (beta).
// Indicator is a rectangular bar curved along the arc, matching
// the bottom-left gauge aesthetic. Tick marks sit outside the bar.

uniform vec2  uResolution;
uniform float uRoll;       // gamma degrees (-90..90)
uniform float uPitch;      // beta degrees (-180..180)
uniform float uArcRadius;  // device pixels
uniform float uThickness;  // base stroke width, device pixels
uniform float uOpacity;
uniform vec4  uColor;

const float PI   = 3.14159265359;
const float DEG  = PI / 180.0;
const float SPAN = 70.0 * DEG;
const float CLMP = 60.0 * DEG;

float sdSeg(vec2 p, vec2 a, vec2 b) {
  vec2 ab = b - a;
  float t = clamp(dot(p - a, ab) / dot(ab, ab), 0.0, 1.0);
  return length(p - (a + t * ab));
}

float aa(float d, float hw) {
  return smoothstep(hw + 1.0, hw - 1.0, d);
}

float tick(vec2 px, vec2 c, float ang, float r0, float r1, float hw) {
  vec2 dir = vec2(cos(ang), sin(ang));
  return aa(sdSeg(px, c + dir * r0, c + dir * r1), hw);
}

// Thin background ring showing full ±SPAN range
float ring(vec2 px, vec2 c, float r, float cAng, float hw) {
  vec2 d = px - c;
  float dr = abs(length(d) - r);
  if (dr > hw + 2.0) return 0.0;
  float ang = atan(d.y, d.x);
  float rel = mod(ang - cAng + PI, 2.0 * PI) - PI;
  return aa(dr, hw) * smoothstep(SPAN, SPAN - 0.07, abs(rel));
}

// Rectangular bar: thick ring segment from cAng to toAng, width = 2*barHW
float barArc(vec2 px, vec2 c, float r, float cAng, float toAng, float barHW) {
  vec2 d = px - c;
  float dist = length(d);
  if (dist < r - barHW - 1.5 || dist > r + barHW + 1.5) return 0.0;
  float ang   = atan(d.y, d.x);
  float rel   = mod(ang   - cAng + PI, 2.0 * PI) - PI;
  float toRel = mod(toAng - cAng + PI, 2.0 * PI) - PI;
  float inside = (toRel >= 0.0)
    ? step(0.0, rel) * step(rel, toRel)
    : step(toRel, rel) * step(rel, 0.0);
  // AA on radial edges only (rectangular cut on angular ends)
  return aa(abs(dist - r), barHW) * inside;
}

void oneArc(vec2 px, vec2 c, float r, float cAng, float sensorDeg, float dir,
            float hw, inout float alpha) {
  float barHW = uThickness * 3.0;  // bar half-width (~gauge height)
  float dist  = length(px - c);

  // Tight early exit: only pixels near bar + outer ticks
  float innerBound = r - barHW * 1.5 - 2.0;
  float outerBound = r + barHW * 2.2 + 2.0;
  if (dist < innerBound || dist > outerBound) return;

  // Angular cull
  vec2  dv  = px - c;
  float ag  = atan(dv.y, dv.x);
  float rel = mod(ag - cAng + PI, 2.0 * PI) - PI;
  if (abs(rel) > SPAN + 0.15) return;

  // Sensor to arc angle
  float sRad   = clamp(sensorDeg * DEG, -CLMP, CLMP) * (SPAN / CLMP);
  float indAng = cAng + dir * sRad;

  // Dim background ring (shows full range behind bar)
  alpha = max(alpha, ring(px, c, r, cAng, hw) * 0.25);

  // Rectangular bar from neutral to current value
  alpha = max(alpha, barArc(px, c, r, cAng, indAng, barHW) * 0.82);

  // Tick marks sit outside the bar (outer edge of bar + offset)
  float rOuter = r + barHW;          // outer edge of bar
  float ts = barHW * 0.45;           // short tick length
  float tm = barHW * 0.75;           // medium tick length
  float tl = barHW * 1.10;           // long (center) tick length
  float thw = hw * 0.55;

  // Center (0°) reference — crosses through bar for visibility
  alpha = max(alpha, tick(px, c, cAng,             r - barHW * 0.4, rOuter + tl, thw) * 0.9);
  // ±15° short
  alpha = max(alpha, tick(px, c, cAng - 15.0*DEG,  rOuter, rOuter + ts, thw * 0.8) * 0.6);
  alpha = max(alpha, tick(px, c, cAng + 15.0*DEG,  rOuter, rOuter + ts, thw * 0.8) * 0.6);
  // ±30° medium
  alpha = max(alpha, tick(px, c, cAng - 30.0*DEG,  rOuter, rOuter + tm, thw) * 0.75);
  alpha = max(alpha, tick(px, c, cAng + 30.0*DEG,  rOuter, rOuter + tm, thw) * 0.75);
  // ±45° short
  alpha = max(alpha, tick(px, c, cAng - 45.0*DEG,  rOuter, rOuter + ts, thw * 0.8) * 0.6);
  alpha = max(alpha, tick(px, c, cAng + 45.0*DEG,  rOuter, rOuter + ts, thw * 0.8) * 0.6);
  // ±60° medium
  alpha = max(alpha, tick(px, c, cAng - 60.0*DEG,  rOuter, rOuter + tm, thw) * 0.75);
  alpha = max(alpha, tick(px, c, cAng + 60.0*DEG,  rOuter, rOuter + tm, thw) * 0.75);
}

void main() {
  vec2  px     = vec2(vTexCoord.x, 1.0 - vTexCoord.y) * uResolution;
  vec2  center = uResolution * 0.5;
  float hw     = uThickness * 0.5;
  float alpha  = 0.0;

  // Left arc: roll/gamma, positive gamma → indicator up (dir = -1)
  oneArc(px, center, uArcRadius, PI,  uRoll,  -1.0, hw, alpha);
  // Right arc: pitch/beta, positive beta → indicator down (dir = +1)
  oneArc(px, center, uArcRadius, 0.0, uPitch, +1.0, hw, alpha);

  if (alpha < 0.001) discard;
  fragColor = vec4(uColor.rgb, uColor.a * alpha * uOpacity);
}
