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
uniform float iTwist;

#define PI 3.1415926535898
#define TAU 6.28318530718
#define NUM_CABLES 4
#define RING_SPACING 2.5
#define CONNECTOR_SPACING 8.0
#define FRAME_SPACING 6.0

// Tunnel path function
vec2 path(float z) {
  return vec2(iAmpA * sin(z * iFreqA), iAmpB * cos(z * iFreqB));
}

// Twist angle accumulated along the tunnel axis
float twistAngle(float z) {
  return z * iTwist;
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

// Get cable position at given z and cable index
vec3 getCablePosition(int cableIndex, float z) {
  float idx = float(cableIndex);

  // Base angle with irregular spacing
  float baseAngle = idx * TAU / float(NUM_CABLES);
  baseAngle += (hash(idx * 41.0) - 0.5) * 0.8; // Irregular spacing
  baseAngle += twistAngle(z); // Spiral around the tunnel axis

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

// Distance to cable ring with early z-bound check
float cableRingDist(vec3 p, int cableIndex, float idx) {
  float phase = hash(idx * 61.0) * RING_SPACING;
  float ringZ = floor((p.z + phase) / RING_SPACING) * RING_SPACING - phase;

  // Early exit if far from ring z-position
  float zDist = abs(p.z - ringZ);
  if (zDist > 0.15) return 1e10;

  vec3 cablePos = getCablePosition(cableIndex, ringZ);
  vec3 local = p - vec3(cablePos.xy, ringZ);

  float majorR = 0.045;
  float minorR = 0.012;
  vec2 q = vec2(length(local.xy) - majorR, local.z);
  return length(q) - minorR;
}

// Distance to cable connector with early z-bound check
float cableConnectorDist(vec3 p, int cableIndex, float idx) {
  float phase = hash(idx * 89.0) * CONNECTOR_SPACING;
  float connZ = floor((p.z + phase) / CONNECTOR_SPACING) * CONNECTOR_SPACING - phase;

  // Early exit if far from connector z-position
  float zDist = abs(p.z - connZ);
  if (zDist > 0.15) return 1e10;

  vec3 cablePos = getCablePosition(cableIndex, connZ);
  vec3 local = p - vec3(cablePos.xy, connZ);

  vec3 boxSize = vec3(0.05, 0.05, 0.06);
  vec3 q = abs(local) - boxSize;
  return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0) - 0.01;
}

// Combined distance function
float mapTunnel(vec3 p) {
  vec2 tun = p.xy - path(p.z);
  return iTunnelRadius - length(tun);
}

// Distance to structural support ring (girder) - factory-style tunnel segment
float frameDist(vec3 p) {
  float ringZ = floor(p.z / FRAME_SPACING + 0.5) * FRAME_SPACING;
  float zDist = abs(p.z - ringZ);
  if (zDist > 0.2) return 1e10;

  vec2 tun = p.xy - path(ringZ);
  float r = length(tun);

  float frameDepth = 0.12; // how far it protrudes inward from the wall
  float frameWidth = 0.07; // thickness along z
  vec2 q = vec2(r - (iTunnelRadius - frameDepth * 0.5), p.z - ringZ);
  vec2 halfSize = vec2(frameDepth * 0.5, frameWidth * 0.5);
  vec2 d = abs(q) - halfSize;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}

// Combined cable geometry distance - single loop for all cable elements
vec4 mapAllCables(vec3 p) {
  float dCable = 1e10;
  float dRing = 1e10;
  float dConn = 1e10;

  for (int i = 0; i < NUM_CABLES; i++) {
    float idx = float(i);
    dCable = min(dCable, cableDist(p, i));
    dRing = min(dRing, cableRingDist(p, i, idx));
    dConn = min(dConn, cableConnectorDist(p, i, idx));
  }

  float minDist = min(min(dCable, dRing), dConn);
  return vec4(minDist, dCable, dRing, dConn);
}

float map(vec3 p) {
  float tunnel = mapTunnel(p);
  vec4 cables = mapAllCables(p);
  float frame = frameDist(p);
  return min(min(tunnel, cables.x), frame);
}

// Returns: 0 = nothing, 1 = cable, 2 = ring, 3 = connector, 4 = structural frame
int getCableHitType(vec3 p) {
  vec4 cables = mapAllCables(p);
  float frame = frameDist(p);
  float threshold = 0.015;

  if (frame < threshold) return 4;     // structural support frame
  if (cables.w < threshold) return 3;  // connector
  if (cables.z < threshold) return 2;  // ring
  if (cables.y < threshold) return 1;  // cable
  return 0;
}

// Surface normal - tetrahedron technique (4 samples instead of 6)
vec3 getNormal(vec3 p) {
  const float eps = 0.001;
  const vec2 k = vec2(1.0, -1.0);
  return normalize(
    k.xyy * map(p + k.xyy * eps) +
    k.yyx * map(p + k.yyx * eps) +
    k.yxy * map(p + k.yxy * eps) +
    k.xxx * map(p + k.xxx * eps)
  );
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

// Check if we hit any cable or structural geometry
bool isCableHit(vec3 p) {
  return getCableHitType(p) > 0;
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
vec3 styleWireframe(vec3 sp, vec3 sn, vec3 rd, float t, vec3 cableGlow, vec3 cableGI) {
  vec2 localPos = sp.xy - path(sp.z);
  float angle = atan(localPos.y, localPos.x) - twistAngle(sp.z);

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

  // Add cable glow and GI
  col += cableGlow;
  col += cableGI * 0.15;

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

  for (int i = 0; i < 96; i++) {
    dt = map(camPos + rd * t);
    if (dt < 0.002 || t > 120.0) break;
    t += dt * 0.8;
  }

  vec3 col = vec3(0.0);

  if (dt < 0.002) {
    // Surface position and normal
    vec3 sp = camPos + rd * t;
    vec3 sn = getNormal(sp);

    // Check if we hit a cable or structural element
    bool hitCable = isCableHit(sp);

    if (hitCable) {
      // Render cable/structural geometry
      vec3 cableGlow = calcCableGlow(sp, time);
      vec3 cableGI = calcCableGI(sp, sn, time);

      int hitType = getCableHitType(sp);

      // Depth fog
      float depth = t / 60.0;
      float fog = exp(-depth * depth * 0.6);

      float diff = max(dot(sn, -rd), 0.0) * 0.3 + 0.3;
      float rim = pow(1.0 - abs(dot(sn, rd)), 3.0);

      if (hitType == 4) {
        // Structural support frame - worn metal girder with hazard stripes
        vec2 localPos = sp.xy - path(sp.z);
        float angle = atan(localPos.y, localPos.x) - twistAngle(sp.z);

        float stripeFreq = 24.0;
        float stripe = mod(floor(angle * stripeFreq / TAU), 2.0);
        vec3 hazardYellow = vec3(0.55, 0.42, 0.05);
        vec3 hazardBlack = vec3(0.015, 0.015, 0.015);
        vec3 frameBase = mix(hazardBlack, hazardYellow, stripe);

        float spec = pow(max(dot(reflect(rd, sn), -rd), 0.0), 20.0);
        col = frameBase * (diff + rim * 0.2) + vec3(0.4) * spec * 0.2;
        col += cableGlow * 0.3 + cableGI * 0.06;
      } else if (hitType == 3) {
        // Connector - dark metallic box with indicator light
        vec3 connBase = vec3(0.02, 0.02, 0.025);
        vec3 connHighlight = vec3(0.05, 0.05, 0.06);

        // Pulsing indicator light on connector
        float pulse = sin(time * 3.0 + sp.z * 0.5) * 0.5 + 0.5;
        vec3 indicatorColor = mix(vec3(0.1, 0.4, 0.8), vec3(0.2, 0.8, 1.0), pulse);

        col = mix(connBase, connHighlight, diff + rim * 0.3);
        col += indicatorColor * pulse * 0.3;
        col += cableGlow * 0.5 + cableGI * 0.05;
      } else if (hitType == 2) {
        // Ring - shiny metallic
        vec3 ringBase = vec3(0.12, 0.14, 0.18);
        vec3 ringHighlight = vec3(0.3, 0.35, 0.45);

        float spec = pow(max(dot(reflect(rd, sn), -rd), 0.0), 32.0);
        col = mix(ringBase, ringHighlight, diff) + vec3(0.5) * spec * 0.3;
        col += cableGlow * 1.2 + cableGI * 0.08;
      } else {
        // Cable - base with energy glow
        vec3 cableBase = vec3(0.04, 0.05, 0.06);
        col = cableBase * diff + cableGlow * 2.0 + cableGI * 0.1;
      }

      col *= fog;
    } else {
      // Calculate cable glow and GI contribution
      vec3 cableGlow = calcCableGlow(sp, time);
      vec3 cableGI = calcCableGI(sp, sn, time);

      col = styleWireframe(sp, sn, rd, t, cableGlow, cableGI);
    }
  } else {
    // Background for non-hit rays - darker
    float fadeFog = exp(-t * 0.02);
    col = vec3(0.0, 0.02, 0.03) * fadeFog;
  }

  fragColor = vec4(col, 1.0);
}
