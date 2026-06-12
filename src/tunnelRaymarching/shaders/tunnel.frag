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
#define NUM_ORBS 1
#define NUM_CABLES 4

// Tunnel path function
vec2 path(float z) {
  return vec2(iAmpA * sin(z * iFreqA), iAmpB * cos(z * iFreqB));
}

// Hash function
float hash(float n) {
  return fract(sin(n) * 43758.5453);
}

float hash2(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

vec3 hash3(float n) {
  return fract(sin(vec3(n, n + 1.0, n + 2.0)) * vec3(43758.5453, 22578.1459, 19642.3490));
}

// Smooth noise for cable undulation
float noise1D(float p) {
  float i = floor(p);
  float f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(hash(i), hash(i + 1.0), f);
}

// Get orb position - floats within tunnel, never touches walls
vec3 getOrbPosition(int orbIndex, float time) {
  float idx = float(orbIndex);
  float baseZ = time * 4.0 + 4.5;

  // Floaty wandering motion with more speed
  float wanderSpeed = 0.5 + hash(idx * 7.0) * 0.3;
  float phaseX = hash(idx * 13.0) * TAU;
  float phaseY = hash(idx * 17.0) * TAU;
  float phaseZ = hash(idx * 19.0) * TAU;

  // Keep orbs well within tunnel (max 70% of radius from center)
  float maxRadius = iTunnelRadius * 0.7;
  float orbRadius = maxRadius * (0.5 + 0.5 * hash(idx * 23.0));
  float angleOffset = time * wanderSpeed + hash(idx * 31.0) * TAU;

  // Layered sine waves for organic floating motion - more amplitude
  vec2 localOffset = vec2(
    sin(angleOffset + phaseX) * orbRadius + sin(angleOffset * 0.8 + phaseX * 1.3) * orbRadius * 0.5 + sin(angleOffset * 0.4 + phaseX * 2.1) * orbRadius * 0.3,
    cos(angleOffset * 0.7 + phaseY) * orbRadius + cos(angleOffset * 0.5 + phaseY * 1.5) * orbRadius * 0.5 + cos(angleOffset * 0.3 + phaseY * 2.3) * orbRadius * 0.3
  );

  // Add z-axis bobbing for depth variation
  float zBob = sin(time * 0.6 + phaseZ) * 1.2;

  vec2 pathPos = path(baseZ + zBob);
  return vec3(pathPos + localOffset, baseZ + zBob);
}

// Get cable position at given z and cable index
vec3 getCablePosition(int cableIndex, float z) {
  float idx = float(cableIndex);

  // Base angle with irregular spacing
  float baseAngle = idx * TAU / float(NUM_CABLES);
  baseAngle += (hash(idx * 41.0) - 0.5) * 0.8; // Irregular spacing

  // Add undulation using noise
  float undulateFreq = 0.3 + hash(idx * 47.0) * 0.2;
  float undulateAmp = 0.15 + hash(idx * 53.0) * 0.1;
  float angleNoise = (noise1D(z * undulateFreq + idx * 100.0) - 0.5) * undulateAmp * TAU;
  float radiusNoise = (noise1D(z * undulateFreq * 0.7 + idx * 200.0) - 0.5) * 0.1;

  float angle = baseAngle + angleNoise;
  float radius = (iTunnelRadius - 0.08) * (1.0 + radiusNoise); // Slightly inside tunnel wall

  vec2 pathPos = path(z);
  vec2 localPos = vec2(cos(angle), sin(angle)) * radius;

  return vec3(pathPos + localPos, z);
}

// Distance to cable at point p
float cableDist(vec3 p, int cableIndex) {
  vec3 cablePos = getCablePosition(cableIndex, p.z);
  return length(p.xy - cablePos.xy) - 0.025; // Cable radius
}

// Combined distance function
float mapTunnel(vec3 p) {
  vec2 tun = p.xy - path(p.z);
  return iTunnelRadius - length(tun);
}

float mapCables(vec3 p) {
  float d = 1e10;
  for (int i = 0; i < NUM_CABLES; i++) {
    d = min(d, cableDist(p, i));
  }
  return d;
}

float map(vec3 p) {
  float tunnel = mapTunnel(p);
  float cables = mapCables(p);
  return min(tunnel, cables);
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

// Calculate GI-like lighting from orbs
vec3 calcOrbLighting(vec3 surfacePos, vec3 surfaceNormal, float time) {
  vec3 totalLight = vec3(0.0);

  for (int i = 0; i < NUM_ORBS; i++) {
    vec3 orbPos = getOrbPosition(i, time);
    vec3 toOrb = orbPos - surfacePos;
    float dist = length(toOrb);
    vec3 lightDir = toOrb / dist;

    // Diffuse lighting with wrap for softer falloff
    float NdotL = max(dot(surfaceNormal, lightDir), 0.0);
    float wrap = 0.3;
    float wrapDiffuse = max((NdotL + wrap) / (1.0 + wrap), 0.0);

    // Softer attenuation for wider GI spread
    float atten = 1.0 / (1.0 + dist * 0.3 + dist * dist * 0.05);

    // White orb color
    vec3 orbColor = vec3(1.0);

    totalLight += orbColor * wrapDiffuse * atten * 0.5;
  }

  return totalLight;
}

// Calculate energy pulse on cables (direct glow)
vec3 calcCableGlow(vec3 p, float time) {
  vec3 totalGlow = vec3(0.0);

  for (int i = 0; i < NUM_CABLES; i++) {
    vec3 cablePos = getCablePosition(i, p.z);
    float dist = length(p.xy - cablePos.xy);

    // Pulse traveling along z - with random phase per cable
    float idx = float(i);
    float pulseSpeed = 8.0;
    float pulseFreq = 0.8;
    float phaseOffset = hash(idx * 73.0) * TAU; // Random phase
    float pulse = sin((p.z - time * pulseSpeed) * pulseFreq + phaseOffset);
    pulse = smoothstep(0.85, 1.0, pulse);

    // Glow falloff from cable
    float glow = exp(-dist * 15.0) * pulse;

    // Cable color - electric blue/cyan
    vec3 cableColor = mix(
      vec3(0.2, 0.6, 1.0),
      vec3(0.4, 0.9, 1.0),
      hash(idx * 67.0)
    );

    totalGlow += cableColor * glow * 1.5;
  }

  return totalGlow;
}

// Calculate GI-like lighting from cable pulses
vec3 calcCableGI(vec3 surfacePos, vec3 surfaceNormal, float time) {
  vec3 totalLight = vec3(0.0);

  for (int i = 0; i < NUM_CABLES; i++) {
    vec3 cablePos = getCablePosition(i, surfacePos.z);
    vec3 toCable = cablePos - surfacePos;
    float dist = length(toCable);
    vec3 lightDir = toCable / dist;

    // Pulse intensity at this z position - with random phase per cable
    float idx = float(i);
    float pulseSpeed = 8.0;
    float pulseFreq = 0.8;
    float phaseOffset = hash(idx * 73.0) * TAU; // Same phase as calcCableGlow
    float pulse = sin((surfacePos.z - time * pulseSpeed) * pulseFreq + phaseOffset);
    pulse = smoothstep(0.85, 1.0, pulse);

    // Diffuse lighting with wrap
    float NdotL = max(dot(surfaceNormal, lightDir), 0.0);
    float wrap = 0.3;
    float wrapDiffuse = max((NdotL + wrap) / (1.0 + wrap), 0.0);

    // Attenuation
    float atten = 1.0 / (1.0 + dist * 0.5 + dist * dist * 0.2);

    // Cable color
    vec3 cableColor = mix(
      vec3(0.2, 0.6, 1.0),
      vec3(0.4, 0.9, 1.0),
      hash(idx * 67.0)
    );

    totalLight += cableColor * wrapDiffuse * atten * pulse * 0.8;
  }

  return totalLight;
}

// Check if we hit a cable
bool isCableHit(vec3 p) {
  return mapCables(p) < 0.01;
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
vec3 styleWireframe(vec3 sp, vec3 sn, vec3 rd, float t, vec3 orbLight, vec3 cableGlow, vec3 cableGI) {
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

  // Cyan wireframe on darker background
  vec3 lineColor = vec3(0.0, 0.6, 0.8);
  vec3 baseColor = vec3(0.01, 0.02, 0.03);

  float lineIntensity = (1.0 - lines) * (0.5 + 0.2 * diff + 0.2 * rim);
  vec3 col = baseColor + lineColor * lineIntensity;

  // Add orb GI lighting
  col += orbLight * 0.4;
  // Add cable glow and GI
  col += cableGlow;
  col += cableGI * 0.15;

  return col * fog;
}

// Style 1: Neon Glow
vec3 styleNeon(vec3 sp, vec3 sn, vec3 rd, float t, vec3 orbLight, vec3 cableGlow, vec3 cableGI) {
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

  // Colors - darker base
  vec3 col1 = vec3(0.6, 0.05, 0.3);  // Darker Pink
  vec3 col2 = vec3(0.05, 0.3, 0.6);  // Darker Blue
  vec3 col3 = vec3(0.3, 0.0, 0.6);  // Darker Purple

  float colorMix = sin(sp.z * 0.1 + iTime * 0.5) * 0.5 + 0.5;
  vec3 glowColor = mix(col1, col2, colorMix);
  glowColor = mix(glowColor, col3, sectorGlow * 0.5);

  // Rim lighting
  float rim = pow(1.0 - abs(dot(sn, rd)), 3.0);

  vec3 col = glowColor * (ring * 0.5 + sectorGlow * 0.3 + rim * 0.2);
  col += vec3(0.01, 0.005, 0.015);  // Darker ambient

  // Add orb GI lighting
  col += orbLight * 0.3;
  // Add cable glow and GI
  col += cableGlow;
  col += cableGI * 0.1;

  return col * fog;
}

// Style 2: Truchet Pattern (Black & White)
vec3 styleTruchet(vec3 sp, vec3 sn, vec3 rd, float t, vec3 orbLight, vec3 cableGlow, vec3 cableGI) {
  vec2 localPos = sp.xy - path(sp.z);
  float angle = atan(localPos.y, localPos.x);

  // UV for truchet grid
  vec2 uv = vec2(angle / TAU * 10.0, sp.z * 0.8);
  vec2 cellID = mod(floor(uv), 1000.0);  // Prevent float precision loss
  vec2 cellF = fract(uv);

  // Random rotation per cell (0 or 1)
  float rot = step(0.5, hash2(cellID));

  // Flip UV based on rotation
  if (rot > 0.5) {
    cellF = vec2(1.0 - cellF.x, cellF.y);
  }

  // Distance to quarter circles (corners)
  float d1 = length(cellF) - 0.5;
  float d2 = length(cellF - vec2(1.0, 1.0)) - 0.5;

  // Truchet curve
  float curve = min(abs(d1), abs(d2));
  float lineWidth = 0.08;
  float pattern = smoothstep(lineWidth, lineWidth * 0.5, curve);

  // Depth fog
  float depth = t / 50.0;
  float fog = exp(-depth * depth * 0.6);

  // Darker black and white base
  vec3 col = vec3(pattern * 0.4);

  // Subtle lighting for depth
  float diff = max(dot(sn, -rd), 0.0) * 0.3 + 0.5;
  col *= diff;

  // Add orb GI lighting
  col += orbLight * 0.5;
  // Add cable glow and GI
  col += cableGlow;
  col += cableGI * 0.2;

  return col * fog;
}

// Style 3: Hex Tiling
vec3 styleHexTiling(vec3 sp, vec3 sn, vec3 rd, float t, vec3 orbLight, vec3 cableGlow, vec3 cableGI) {
  vec2 localPos = sp.xy - path(sp.z);
  float angle = atan(localPos.y, localPos.x);

  // UV for hex grid
  vec2 uv = vec2(angle / TAU * 8.0, sp.z * 0.6);

  // Hex grid constants
  const vec2 s = vec2(1.0, 1.732050808);  // sqrt(3)
  const vec2 h = s * 0.5;

  // Two offset grids
  vec2 a = mod(uv, s) - h;
  vec2 b = mod(uv - h, s) - h;

  // Pick closer hex center
  vec2 gv = dot(a, a) < dot(b, b) ? a : b;
  vec2 hexID = uv - gv;

  // Distance to hex edge
  vec2 hv = abs(gv);
  float hexDist = max(hv.x * 0.5 + hv.y * 0.866025, hv.x);

  // Stable cell ID (mod to prevent float precision loss at large values)
  vec2 cellID = mod(floor(hexID * 100.0 + 0.5), 1000.0);
  float cellRand = hash2(cellID);
  float cellRand2 = hash2(cellID + vec2(17.0, 31.0));

  // Cell pulsing - select ~20% of cells to pulse
  float isPulsing = step(0.8, cellRand);
  float pulsePhase = cellRand2 * TAU;
  float pulse = sin(iTime * 1.5 + pulsePhase) * 0.5 + 0.5;
  float cellBrightness = 1.0 + isPulsing * pulse * 0.8;

  // Hex edge
  float edge = smoothstep(0.5, 0.42, hexDist);

  // Depth fog
  float depth = t / 50.0;
  float fog = exp(-depth * depth * 0.5);

  // Darker cool color palette
  vec3 baseColor = vec3(0.03, 0.05, 0.08);  // Darker blue
  vec3 cellColor = mix(
    vec3(0.1, 0.18, 0.25),   // Darker Sky blue
    vec3(0.15, 0.22, 0.28),  // Darker Light blue
    cellRand2
  );
  vec3 pulseColor = vec3(0.25, 0.4, 0.5);  // Darker cyan for pulsing cells

  // Lighting
  float diff = max(dot(sn, -rd), 0.0) * 0.3 + 0.5;

  // Compose color - pulsing cells get brighter color
  vec3 finalCellColor = mix(cellColor, pulseColor, isPulsing * pulse);
  vec3 col = mix(baseColor, finalCellColor * cellBrightness, edge) * diff;

  // Edge highlight - dimmer
  float edgeLine = smoothstep(0.46, 0.48, hexDist) * smoothstep(0.5, 0.48, hexDist);
  col += vec3(0.2, 0.3, 0.4) * edgeLine * 0.3;

  // Add orb GI lighting
  col += orbLight * 0.35;
  // Add cable glow and GI
  col += cableGlow;
  col += cableGI * 0.12;

  return col * fog;
}

// Style 4: Warp Speed
vec3 styleWarp(vec3 sp, vec3 sn, vec3 rd, float t, vec3 orbLight, vec3 cableGlow, vec3 cableGI) {
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
  vec2 starID = mod(floor(starUV), 1000.0);  // Prevent float precision loss
  float star = step(0.995, hash2(starID));
  float twinkle = 0.5 + 0.5 * sin(iTime * 8.0 + hash2(starID) * 100.0);

  // Colors - darker
  vec3 col = vec3(0.0, 0.01, 0.02);  // Deeper space

  // Dimmer streaks
  vec3 streakColor = mix(vec3(0.3, 0.4, 0.5), vec3(0.6), streakRand);
  col += streakColor * streak * streakFade * 1.0;

  // Dimmer stars
  col += vec3(0.5, 0.55, 0.6) * star * twinkle;

  // Add orb GI lighting
  col += orbLight * 0.3;
  // Add cable glow and GI
  col += cableGlow;
  col += cableGI * 0.1;

  return col * fog;
}

// Render glowing orbs - subtle core, emphasis on GI
vec3 renderOrbs(vec3 ro, vec3 rd, float maxT, float time) {
  vec3 orbGlow = vec3(0.0);

  for (int i = 0; i < NUM_ORBS; i++) {
    vec3 orbPos = getOrbPosition(i, time);

    // Ray-sphere intersection for core
    vec3 oc = ro - orbPos;
    float b = dot(oc, rd);
    float c = dot(oc, oc) - 0.03 * 0.03; // Smaller core
    float h = b * b - c;

    if (h > 0.0) {
      float tOrb = -b - sqrt(h);
      if (tOrb > 0.0 && tOrb < maxT) {
        // White orb color
        vec3 orbColor = vec3(1.0);

        // Depth attenuation
        float atten = exp(-tOrb * 0.03);
        orbGlow += orbColor * 0.8 * atten;
      }
    }

    // Subtle soft glow halo
    float distToRay = length(cross(rd, orbPos - ro));
    float glowRadius = 0.08;
    float glow = exp(-distToRay * distToRay / (glowRadius * glowRadius));

    // Only show glow if orb is in front
    float tClosest = -dot(oc, rd);
    if (tClosest > 0.0 && tClosest < maxT) {
      // White orb color
      vec3 orbColor = vec3(1.0);
      float atten = exp(-tClosest * 0.02);
      orbGlow += orbColor * glow * 0.15 * atten;
    }
  }

  return orbGlow;
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

    // Check if we hit a cable
    bool hitCable = isCableHit(sp);

    if (hitCable) {
      // Render cable surface
      vec3 cableGlow = calcCableGlow(sp, time);
      vec3 cableGI = calcCableGI(sp, sn, time);
      vec3 orbLight = calcOrbLighting(sp, sn, time);

      // Base cable color (darker metallic)
      vec3 cableBase = vec3(0.04, 0.05, 0.06);
      float diff = max(dot(sn, -rd), 0.0) * 0.3 + 0.3;

      // Depth fog
      float depth = t / 60.0;
      float fog = exp(-depth * depth * 0.6);

      col = cableBase * diff + cableGlow * 2.0 + orbLight * 0.3 + cableGI * 0.1;
      col *= fog;
    } else {
      // Calculate orb GI lighting
      vec3 orbLight = calcOrbLighting(sp, sn, time);

      // Calculate cable glow and GI contribution
      vec3 cableGlow = calcCableGlow(sp, time);
      vec3 cableGI = calcCableGI(sp, sn, time);

      // Apply style with lighting
      if (iStyle == 0) {
        col = styleWireframe(sp, sn, rd, t, orbLight, cableGlow, cableGI);
      } else if (iStyle == 1) {
        col = styleNeon(sp, sn, rd, t, orbLight, cableGlow, cableGI);
      } else if (iStyle == 2) {
        col = styleTruchet(sp, sn, rd, t, orbLight, cableGlow, cableGI);
      } else if (iStyle == 3) {
        col = styleHexTiling(sp, sn, rd, t, orbLight, cableGlow, cableGI);
      } else {
        col = styleWarp(sp, sn, rd, t, orbLight, cableGlow, cableGI);
      }
    }
  } else {
    // Background for non-hit rays - darker
    float fadeFog = exp(-t * 0.02);

    if (iStyle == 0) {
      col = vec3(0.0, 0.02, 0.03) * fadeFog;
    } else if (iStyle == 1) {
      col = vec3(0.02, 0.0, 0.03) * fadeFog;
    } else if (iStyle == 2) {
      col = vec3(0.01, 0.01, 0.01) * fadeFog;
    } else if (iStyle == 3) {
      col = vec3(0.02, 0.03, 0.05) * fadeFog;
    } else {
      col = vec3(0.0, 0.005, 0.01) * fadeFog;
    }
  }

  // Add orb glow (rendered on top)
  vec3 orbGlow = renderOrbs(camPos, rd, t, time);
  col += orbGlow;

  fragColor = vec4(col, 1.0);
}
