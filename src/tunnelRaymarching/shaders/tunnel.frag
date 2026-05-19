#version 300 es
precision highp float;

// Raymarching tunnel based on Shane's "Subterranean Fly-Through"
// https://www.shadertoy.com/view/XlXXWj

in vec2 vTexCoord;
out vec4 fragColor;

uniform float iTime;
uniform vec2 iResolution;
uniform float iSpeed;
uniform float iFreqA;
uniform float iFreqB;
uniform float iAmpA;
uniform float iAmpB;
uniform float iTunnelRadius;
uniform int iStyle;

#define PI 3.1415926535898
#define TAU 6.28318530718

// Tunnel path function
vec2 path(float z) {
  return vec2(iAmpA * sin(z * iFreqA), iAmpB * cos(z * iFreqB));
}

// Tunnel distance function
float map(vec3 p) {
  vec2 tun = p.xy - path(p.z);
  return iTunnelRadius - length(tun);
}

// Surface normal
vec3 getNormal(vec3 p) {
  const float eps = 0.001;
  return normalize(vec3(
    map(vec3(p.x + eps, p.y, p.z)) - map(vec3(p.x - eps, p.y, p.z)),
    map(vec3(p.x, p.y + eps, p.z)) - map(vec3(p.x, p.y - eps, p.z)),
    map(vec3(p.x, p.y, p.z + eps)) - map(vec3(p.x, p.y, p.z - eps))
  ));
}

// Hash function
float hash(float n) {
  return fract(sin(n) * 43758.5453);
}

float hash2(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

// Value noise
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash2(i);
  float b = hash2(i + vec2(1.0, 0.0));
  float c = hash2(i + vec2(0.0, 1.0));
  float d = hash2(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

// Style 0: Wireframe Grid
vec3 styleWireframe(vec3 sp, vec3 sn, vec3 rd, float t) {
  vec2 localPos = sp.xy - path(sp.z);
  float angle = atan(localPos.y, localPos.x);

  // Ring lines along Z
  float ringLine = abs(fract(sp.z * 0.5) - 0.5);
  ringLine = smoothstep(0.0, 0.015, ringLine);

  // Vertical lines (based on angle)
  float vertLine = abs(fract(angle * 8.0 / TAU) - 0.5);
  vertLine = smoothstep(0.0, 0.01, vertLine);

  // Combine lines
  float lines = min(ringLine, vertLine);

  // Depth-based fog
  float depth = t / 60.0;
  float fog = exp(-depth * depth * 0.8);

  // Basic lighting
  float diff = max(dot(sn, -rd), 0.0);
  float rim = pow(1.0 - abs(dot(sn, rd)), 2.0);

  // Cyan wireframe on dark background
  vec3 lineColor = vec3(0.0, 0.9, 1.0);
  vec3 baseColor = vec3(0.02, 0.04, 0.06);

  float lineIntensity = (1.0 - lines) * (0.8 + 0.2 * diff + 0.3 * rim);
  vec3 col = baseColor + lineColor * lineIntensity;

  return col * fog;
}

// Style 1: Neon Glow
vec3 styleNeon(vec3 sp, vec3 sn, vec3 rd, float t) {
  vec2 localPos = sp.xy - path(sp.z);
  float angle = atan(localPos.y, localPos.x);

  // Pulsing rings
  float ringPhase = sp.z * 0.3 - iTime * 2.0;
  float ring = sin(ringPhase);
  ring = smoothstep(0.7, 1.0, ring);

  // Sector glow
  float sectors = 6.0;
  float sectorAngle = mod(angle + iTime * 0.5, TAU / sectors);
  float sectorGlow = smoothstep(0.3, 0.0, abs(sectorAngle - PI / sectors));

  // Depth fog
  float depth = t / 50.0;
  float fog = exp(-depth * depth * 0.5);

  // Colors
  vec3 col1 = vec3(1.0, 0.1, 0.5);  // Pink
  vec3 col2 = vec3(0.1, 0.5, 1.0);  // Blue
  vec3 col3 = vec3(0.5, 0.0, 1.0);  // Purple

  float colorMix = sin(sp.z * 0.1 + iTime * 0.5) * 0.5 + 0.5;
  vec3 glowColor = mix(col1, col2, colorMix);
  glowColor = mix(glowColor, col3, sectorGlow * 0.5);

  // Rim lighting
  float rim = pow(1.0 - abs(dot(sn, rd)), 3.0);

  vec3 col = glowColor * (ring * 0.8 + sectorGlow * 0.5 + rim * 0.3);
  col += vec3(0.02, 0.01, 0.03);  // Ambient

  return col * fog;
}

// Style 2: Tech Panels
vec3 styleTech(vec3 sp, vec3 sn, vec3 rd, float t) {
  vec2 localPos = sp.xy - path(sp.z);
  float angle = atan(localPos.y, localPos.x);

  // Panel grid
  vec2 panelUV = vec2(angle / TAU * 12.0, sp.z * 0.8);
  vec2 panelID = floor(panelUV);
  vec2 panelF = fract(panelUV);

  // Panel edges
  float edge = min(
    min(smoothstep(0.0, 0.05, panelF.x), smoothstep(1.0, 0.95, panelF.x)),
    min(smoothstep(0.0, 0.05, panelF.y), smoothstep(1.0, 0.95, panelF.y))
  );

  // Random panel activation
  float panelRand = hash2(panelID);
  float pulse = sin(iTime * 2.0 + panelRand * TAU) * 0.5 + 0.5;
  float lit = step(0.6, panelRand) * pulse;

  // Depth fog
  float depth = t / 50.0;
  float fog = exp(-depth * depth * 0.6);

  // Colors
  vec3 panelColor = vec3(0.0, 0.6, 0.8);
  vec3 litColor = vec3(0.0, 1.0, 0.8);
  vec3 edgeColor = vec3(0.0, 0.3, 0.4);

  // Lighting
  float diff = max(dot(sn, -rd), 0.0) * 0.5 + 0.5;

  vec3 col = mix(edgeColor, panelColor, edge) * diff;
  col += litColor * lit * edge * 0.5;

  return col * fog;
}

// Style 3: Organic Cave
vec3 styleOrganic(vec3 sp, vec3 sn, vec3 rd, float t) {
  vec2 localPos = sp.xy - path(sp.z);
  float angle = atan(localPos.y, localPos.x);

  // Organic texture using noise
  vec2 texUV = vec2(angle * 2.0, sp.z * 0.5);
  float n1 = noise(texUV * 4.0 + iTime * 0.1);
  float n2 = noise(texUV * 8.0 - iTime * 0.15);
  float n3 = noise(texUV * 16.0);

  float organic = n1 * 0.5 + n2 * 0.3 + n3 * 0.2;

  // Depth fog with warm tint
  float depth = t / 40.0;
  float fog = exp(-depth * depth * 0.4);

  // Warm cave colors
  vec3 col1 = vec3(0.4, 0.2, 0.1);   // Brown
  vec3 col2 = vec3(0.6, 0.35, 0.15); // Orange-brown
  vec3 col3 = vec3(0.15, 0.08, 0.05); // Dark

  // Lighting
  float diff = max(dot(sn, -rd), 0.0);
  float rim = pow(1.0 - abs(dot(sn, rd)), 2.0);

  vec3 col = mix(col3, mix(col1, col2, organic), diff * 0.7 + 0.3);
  col += col2 * rim * 0.2;

  // Subtle bioluminescence
  float glow = smoothstep(0.7, 0.9, organic) * sin(iTime + sp.z * 0.5) * 0.5 + 0.5;
  col += vec3(0.1, 0.4, 0.3) * glow * 0.15;

  return col * fog;
}

// Style 4: Warp Speed
vec3 styleWarp(vec3 sp, vec3 sn, vec3 rd, float t) {
  vec2 localPos = sp.xy - path(sp.z);
  float angle = atan(localPos.y, localPos.x);

  // Speed streaks
  float streakAngle = floor(angle * 30.0 / TAU);
  float streakRand = hash(streakAngle);
  float streak = step(0.8, streakRand);

  // Streak animation
  float streakPhase = fract(sp.z * 0.1 - iTime * 3.0 + streakRand);
  float streakFade = smoothstep(0.0, 0.2, streakPhase) * smoothstep(1.0, 0.5, streakPhase);

  // Depth
  float depth = t / 80.0;
  float fog = exp(-depth * 0.5);

  // Star field
  vec2 starUV = vec2(angle * 20.0, sp.z * 2.0);
  float star = step(0.995, hash2(floor(starUV)));
  float twinkle = 0.5 + 0.5 * sin(iTime * 8.0 + hash2(floor(starUV)) * 100.0);

  // Colors
  vec3 col = vec3(0.0, 0.02, 0.05);  // Deep space blue

  // White/blue streaks
  vec3 streakColor = mix(vec3(0.6, 0.8, 1.0), vec3(1.0), streakRand);
  col += streakColor * streak * streakFade * 2.0;

  // Stars
  col += vec3(0.9, 0.95, 1.0) * star * twinkle;

  return col * fog;
}

void main() {
  // Screen coordinates
  vec2 uv = (gl_FragCoord.xy - iResolution.xy * 0.5) / iResolution.y;

  // Camera Setup
  float time = iTime * iSpeed;
  vec3 lookAt = vec3(0.0, 0.0, time * 4.0);
  vec3 camPos = lookAt + vec3(0.0, 0.0, -0.1);

  // Apply path to camera and lookAt
  lookAt.xy += path(lookAt.z);
  camPos.xy += path(camPos.z);

  // Build camera basis
  float FOV = PI / 3.0;
  vec3 forward = normalize(lookAt - camPos);
  vec3 right = normalize(vec3(forward.z, 0.0, -forward.x));
  vec3 up = cross(forward, right);

  // Ray direction
  vec3 rd = normalize(forward + FOV * uv.x * right + FOV * uv.y * up);

  // Raymarching
  float t = 0.0;
  float dt;

  for (int i = 0; i < 128; i++) {
    dt = map(camPos + rd * t);
    if (dt < 0.002 || t > 150.0) break;
    t += dt * 0.75;
  }

  vec3 col = vec3(0.0);

  if (dt < 0.002) {
    // Surface position and normal
    vec3 sp = camPos + rd * t;
    vec3 sn = getNormal(sp);

    // Apply style
    if (iStyle == 0) {
      col = styleWireframe(sp, sn, rd, t);
    } else if (iStyle == 1) {
      col = styleNeon(sp, sn, rd, t);
    } else if (iStyle == 2) {
      col = styleTech(sp, sn, rd, t);
    } else if (iStyle == 3) {
      col = styleOrganic(sp, sn, rd, t);
    } else {
      col = styleWarp(sp, sn, rd, t);
    }
  } else {
    // Background for non-hit rays
    float fadeFog = exp(-t * 0.02);

    if (iStyle == 0) {
      col = vec3(0.0, 0.05, 0.08) * fadeFog;
    } else if (iStyle == 1) {
      col = vec3(0.05, 0.0, 0.08) * fadeFog;
    } else if (iStyle == 2) {
      col = vec3(0.0, 0.03, 0.05) * fadeFog;
    } else if (iStyle == 3) {
      col = vec3(0.08, 0.04, 0.02) * fadeFog;
    } else {
      col = vec3(0.0, 0.01, 0.03) * fadeFog;
    }
  }

  fragColor = vec4(col, 1.0);
}
