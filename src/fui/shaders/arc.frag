// Aircraft attitude indicator arc gauges.
// Left arc = roll (gamma), right arc = pitch (beta).
// Two symmetric arcs centered on screen center with tick marks
// and a filled indicator segment showing current tilt.

uniform vec2  uResolution;
uniform float uRoll;       // gamma degrees (-90..90)
uniform float uPitch;      // beta degrees (-180..180)
uniform float uArcRadius;  // device pixels
uniform float uThickness;  // stroke width, device pixels
uniform float uOpacity;
uniform vec4  uColor;

const float PI   = 3.14159265359;
const float DEG  = PI / 180.0;
const float SPAN = 70.0 * DEG;   // arc half-span
const float CLMP = 60.0 * DEG;   // sensor display range

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

float ring(vec2 px, vec2 c, float r, float cAng, float hw) {
  vec2 d = px - c;
  float dr = abs(length(d) - r);
  if (dr > hw + 2.0) return 0.0;
  float ang = atan(d.y, d.x);
  float rel = mod(ang - cAng + PI, 2.0 * PI) - PI;
  return aa(dr, hw) * smoothstep(SPAN, SPAN - 0.07, abs(rel));
}

// Filled arc segment on the ring from cAng to toAng
float fillArc(vec2 px, vec2 c, float r, float cAng, float toAng, float hw) {
  vec2 d = px - c;
  float dr = abs(length(d) - r);
  if (dr > hw + 2.0) return 0.0;
  float ang   = atan(d.y, d.x);
  float rel   = mod(ang   - cAng + PI, 2.0 * PI) - PI;
  float toRel = mod(toAng - cAng + PI, 2.0 * PI) - PI;
  float inside = (toRel >= 0.0)
    ? step(0.0, rel) * step(rel, toRel)
    : step(toRel, rel) * step(rel, 0.0);
  return aa(dr, hw) * inside;
}

void oneArc(vec2 px, vec2 c, float r, float cAng, float sensorDeg, float dir,
            float hw, inout float alpha) {
  float dist = length(px - c);
  if (dist < r - r * 0.16 - 2.0 || dist > r + r * 0.05 + 2.0) return;

  vec2  dv  = px - c;
  float ag  = atan(dv.y, dv.x);
  float rel = mod(ag - cAng + PI, 2.0 * PI) - PI;
  if (abs(rel) > SPAN + 0.15) return;

  // Background ring track
  alpha = max(alpha, ring(px, c, r, cAng, hw) * 0.32);

  // Sensor to arc angle
  float sRad   = clamp(sensorDeg * DEG, -CLMP, CLMP) * (SPAN / CLMP);
  float indAng = cAng + dir * sRad;

  // Filled indicator arc
  alpha = max(alpha, fillArc(px, c, r, cAng, indAng, hw) * 0.65);

  // Tick radii
  float tl  = r * 0.08;
  float tm  = r * 0.05;
  float ts  = r * 0.03;
  float to  = r * 0.02;
  float thw = hw * 0.55;

  // Center tick (longest)
  alpha = max(alpha, tick(px, c, cAng,             r - tl, r + to, thw) * 0.8);
  // ±15° short
  alpha = max(alpha, tick(px, c, cAng - 15.0*DEG,  r - ts, r,      thw * 0.7) * 0.5);
  alpha = max(alpha, tick(px, c, cAng + 15.0*DEG,  r - ts, r,      thw * 0.7) * 0.5);
  // ±30° medium
  alpha = max(alpha, tick(px, c, cAng - 30.0*DEG,  r - tm, r + to, thw) * 0.65);
  alpha = max(alpha, tick(px, c, cAng + 30.0*DEG,  r - tm, r + to, thw) * 0.65);
  // ±45° short
  alpha = max(alpha, tick(px, c, cAng - 45.0*DEG,  r - ts, r,      thw * 0.7) * 0.5);
  alpha = max(alpha, tick(px, c, cAng + 45.0*DEG,  r - ts, r,      thw * 0.7) * 0.5);
  // ±60° medium
  alpha = max(alpha, tick(px, c, cAng - 60.0*DEG,  r - tm, r + to, thw) * 0.65);
  alpha = max(alpha, tick(px, c, cAng + 60.0*DEG,  r - tm, r + to, thw) * 0.65);

  // Current value indicator (full opacity, longest)
  alpha = max(alpha, tick(px, c, indAng, r - r*0.12, r + r*0.04, hw * 0.85));
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
