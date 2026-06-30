#version 300 es
precision highp float;

in vec2 vTexCoord;
out vec4 fragColor;

uniform vec2 iResolution;
uniform int iTechnique;
uniform int iShape;
uniform int iFoldCount;
uniform float iFoldScale;
uniform float iCameraYaw;
uniform float iCameraPitch;
uniform float iCameraDistance;
uniform float iFocalLength;
uniform float iLightHeight;
uniform float iAmbient;
uniform float iSpecular;
uniform float iExposure;

#define PI 3.141592653589793
#define TAU 6.283185307179586
#define FAR 28.0

mat2 rot(float a) {
  float s = sin(a);
  float c = cos(a);
  return mat2(c, -s, s, c);
}

float sdBox(vec3 p, vec3 b) {
  vec3 q = abs(p) - b;
  return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0);
}

float sdTorus(vec3 p, vec2 t) {
  vec2 q = vec2(length(p.xz) - t.x, p.y);
  return length(q) - t.y;
}

float baseSdf(vec3 p) {
  if (iShape == 1) return sdTorus(p, vec2(0.46, 0.13));
  return sdBox(p, vec3(0.42));
}

float reflectRepeatSdf(vec3 p) {
  if (iShape == 1) {
    p.xy = rot(PI * 0.5) * p.xy;
    return sdTorus(p, vec2(0.3, 0.075));
  }
  p.xy = rot(0.18) * p.xy;
  return sdBox(p, vec3(0.24, 0.36, 0.22));
}

void foldPolar(inout vec2 p, float repetitions) {
  float a = atan(p.y, p.x);
  float r = length(p);
  float sector = TAU / repetitions;
  a = mod(a + sector * 0.5, sector) - sector * 0.5;
  p = vec2(cos(a), sin(a)) * r;
}

vec3 repeatDomain(vec3 p, vec3 cell) {
  return mod(p + cell * 0.5, cell) - cell * 0.5;
}

vec3 sceneRotation(vec3 p) {
  p.xz = rot(iCameraYaw) * p.xz;
  return p;
}

float mapMirrorFold(vec3 p, out float orbit) {
  vec3 q = p;
  for (int i = 0; i < 8; i++) {
    if (i >= iFoldCount) break;
    q = abs(q) - vec3(0.55, 0.39, 0.31);
    q.xy = rot(0.34 + float(i) * 0.13) * q.xy;
    q.yz = rot(-0.22) * q.yz;
    orbit += exp(-4.0 * length(q));
  }
  return baseSdf(q);
}

float mapReflectRepeat(vec3 p, out float orbit) {
  vec3 q = repeatDomain(p, vec3(1.58, 1.58, 1.58));
  float d = 1e6;
  float scale = 1.0;

  for (int i = 0; i < 8; i++) {
    if (i >= iFoldCount) break;

    vec3 folded = abs(q);
    folded -= vec3(0.42, 0.34, 0.28);
    folded.xz = rot(0.18 + float(i) * 0.22) * folded.xz;
    folded.yz = rot(-0.12 * float(i)) * folded.yz;

    d = min(d, reflectRepeatSdf(folded / scale) * scale);
    orbit += 0.42 / (0.34 + dot(folded, folded));

    q = repeatDomain(q * 1.32 + vec3(0.19, -0.13, 0.16), vec3(1.44));
    scale *= 0.78;
  }

  return d;
}

float mapPolarFold(vec3 p, out float orbit) {
  vec3 q = p;
  float repetitions = float(iFoldCount + 2);
  foldPolar(q.xz, repetitions);
  q.x -= 1.05;
  q.y = mod(q.y + 0.72, 1.44) - 0.72;
  q.yz = rot(0.3) * q.yz;
  orbit += 0.5 + 0.5 * cos(atan(p.z, p.x) * repetitions);
  return baseSdf(q);
}

float mapBoxFold(vec3 p, out float orbit) {
  vec3 q = p;
  float scale = clamp(iFoldScale, 1.12, 2.4);
  float dr = 1.0;
  for (int i = 0; i < 8; i++) {
    if (i >= iFoldCount) break;
    q = clamp(q, -1.0, 1.0) * 2.0 - q;
    q = q * scale - vec3(0.58, 0.36, 0.22);
    q.xy = rot(0.18 + float(i) * 0.07) * q.xy;
    dr *= scale;
    orbit += exp(-0.45 * dot(q, q));
  }
  return baseSdf(q) / dr;
}

float mapSortFold(vec3 p, out float orbit) {
  vec3 q = p;

  q.xy = rot(0.24) * q.xy;
  q.xz = rot(0.36) * q.xz;

  float absOffset = iFoldScale * 0.2;

  for (int i = 0; i < 8; i++) {
    if (i >= iFoldCount) break;
    q = abs(q) - absOffset;

    if (q.x < q.y) q.xy = q.yx;
    if (q.x < q.z) q.xz = q.zx;
    if (q.y < q.z) q.yz = q.zy;

    q.xy -= 0.05;

    q.xy = rot(0.7) * q.xy;
    q.yz = rot(0.7) * q.yz;

    orbit += exp(-2.0 * length(q));
  }

  q.x -= clamp(q.x, -0.5, 0.5);

  return length(vec2(length(q.xy) - 0.5, q.z)) - 0.4;
}

float mapMengerFold(vec3 p, out float orbit) {
  vec3 q = p;
  q.xy = rot(0.15) * q.xy;
  float d = sdBox(q, vec3(1.08));
  float s = 1.0;

  for (int i = 0; i < 7; i++) {
    if (i >= iFoldCount) break;
    vec3 a = mod(q * s, 2.0) - 1.0;
    s *= 3.0;
    vec3 r = abs(1.0 - 3.0 * abs(a));
    float da = max(r.x, r.y);
    float db = max(r.y, r.z);
    float dc = max(r.z, r.x);
    float c = (min(da, min(db, dc)) - 1.0) / s;
    d = max(d, c);
    orbit += exp(-45.0 * abs(c));
  }

  return d;
}

vec2 mapScene(vec3 p) {
  vec3 world = p;
  p = sceneRotation(p);
  float orbit = 0.0;
  float d;

  if (iTechnique == 1) {
    d = mapReflectRepeat(p, orbit);
  } else if (iTechnique == 2) {
    d = mapPolarFold(p, orbit);
  } else if (iTechnique == 3) {
    d = mapBoxFold(p, orbit);
  } else if (iTechnique == 4) {
    d = mapMengerFold(p, orbit);
  } else if (iTechnique == 5) {
    d = mapSortFold(p, orbit);
  } else {
    d = mapMirrorFold(p, orbit);
  }

  float boundRadius = iTechnique == 1 ? 2.8 : 2.35;
  d = max(d, length(world) - boundRadius);

  return vec2(d, orbit);
}

vec3 calcNormal(vec3 p) {
  vec2 e = vec2(0.0012, 0.0);
  return normalize(vec3(
    mapScene(p + e.xyy).x - mapScene(p - e.xyy).x,
    mapScene(p + e.yxy).x - mapScene(p - e.yxy).x,
    mapScene(p + e.yyx).x - mapScene(p - e.yyx).x
  ));
}

float softShadow(vec3 ro, vec3 rd) {
  float result = 1.0;
  float t = 0.025;
  for (int i = 0; i < 48; i++) {
    float h = mapScene(ro + rd * t).x;
    result = min(result, 12.0 * h / t);
    t += clamp(h, 0.025, 0.32);
    if (result < 0.02 || t > 7.0) break;
  }
  return clamp(result, 0.0, 1.0);
}

float ambientOcclusion(vec3 p, vec3 n) {
  float occ = 0.0;
  float weight = 1.0;
  for (int i = 0; i < 5; i++) {
    float h = 0.035 + 0.055 * float(i);
    float d = mapScene(p + n * h).x;
    occ += (h - d) * weight;
    weight *= 0.62;
  }
  return clamp(1.0 - occ * 1.35, 0.0, 1.0);
}

vec3 palette(float t) {
  vec3 a = vec3(0.52, 0.50, 0.46);
  vec3 b = vec3(0.46, 0.39, 0.36);
  vec3 c = vec3(1.00, 0.88, 0.72);
  vec3 d = vec3(0.04, 0.28, 0.56);
  return a + b * cos(TAU * (c * t + d));
}

vec3 cameraRay(vec2 uv, vec3 ro, vec3 ta) {
  vec3 f = normalize(ta - ro);
  vec3 r = normalize(cross(vec3(0.0, 1.0, 0.0), f));
  vec3 u = cross(f, r);
  return normalize(f * iFocalLength + r * uv.x + u * uv.y);
}

vec2 raymarch(vec3 ro, vec3 rd) {
  float t = 0.0;
  float material = 0.0;
  for (int i = 0; i < 132; i++) {
    vec3 p = ro + rd * t;
    vec2 h = mapScene(p);
    material = h.y;
    float hitEpsilon = 0.0009 * (1.0 + t * 0.12);
    if (h.x < hitEpsilon || t > FAR) break;
    t += h.x * 0.72;
  }
  return vec2(t, material);
}

void main() {
  vec2 uv = (gl_FragCoord.xy * 2.0 - iResolution.xy) / iResolution.y;
  vec2 screenUv = gl_FragCoord.xy / iResolution.xy;

  float yaw = iCameraYaw;
  float pitch = iCameraPitch;
  float dist = iCameraDistance + (iTechnique == 1 ? 0.8 : 0.0);
  vec3 ro = vec3(sin(yaw) * cos(pitch), sin(pitch), cos(yaw) * cos(pitch)) * dist;
  ro.y += 0.55;
  vec3 ta = vec3(0.0, 0.02, 0.0);
  vec3 rd = cameraRay(uv, ro, ta);

  vec3 bgTop = vec3(0.018, 0.026, 0.030);
  vec3 bgBottom = vec3(0.006, 0.007, 0.009);
  vec3 color = mix(bgBottom, bgTop, smoothstep(-0.75, 0.85, uv.y));
  color += vec3(0.018, 0.025, 0.028) * exp(-2.7 * length(uv));

  vec2 hit = raymarch(ro, rd);
  if (hit.x < FAR) {
    vec3 p = ro + rd * hit.x;
    vec3 n = calcNormal(p);
    vec3 lightPos = vec3(2.8, iLightHeight, 2.8);
    vec3 l = normalize(lightPos - p);
    vec3 h = normalize(l - rd);

    float diff = max(dot(n, l), 0.0);
    float shadow = softShadow(p + n * 0.015, l);
    float ao = ambientOcclusion(p, n);
    float spec = pow(max(dot(n, h), 0.0), 44.0) * iSpecular * shadow;
    float rim = pow(1.0 - max(dot(n, -rd), 0.0), 3.4);

    float foldTone = hit.y * 0.08 + float(iTechnique) * 0.115 + length(p) * 0.045;
    vec3 base = palette(foldTone);
    vec3 cool = vec3(0.23, 0.72, 0.96);
    vec3 warm = vec3(1.0, 0.58, 0.28);
    base = mix(base, cool, 0.16 + 0.10 * sin(float(iTechnique) * 1.7));
    base += warm * 0.08 * sin(hit.y);

    vec3 lit = base * (iAmbient + diff * shadow * 1.25) * ao;
    lit += warm * spec;
    lit += cool * rim * (0.18 + 0.22 * ao);

    float fog = 1.0 - exp(-0.035 * hit.x * hit.x);
    color = mix(lit, color, fog);
  }

  float vignette = smoothstep(1.35, 0.25, length(uv));
  color *= mix(0.62, 1.08, vignette);
  color = vec3(1.0) - exp(-color * iExposure);
  color = pow(color, vec3(0.4545));

  fragColor = vec4(color, 1.0);
}
