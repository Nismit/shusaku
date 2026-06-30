#version 300 es
precision highp float;

in vec2 vTexCoord;
out vec4 fragColor;

uniform vec2 iResolution;
uniform int iFoldCount;
uniform float iFoldScale;
uniform float iInitRotXY;
uniform float iInitRotXZ;
uniform float iIterRotXY;
uniform float iIterRotYZ;
uniform float iCameraYaw;
uniform float iCameraPitch;
uniform float iCameraDistance;
uniform float iFocalLength;
uniform float iLightHeight;
uniform float iAmbient;
uniform float iSpecular;
uniform float iExposure;
uniform int iSabsMode;

#define PI 3.141592653589793
#define TAU 6.283185307179586
#define FAR 28.0
#define EPS 5e-4

float sabs(float x) {
  if (iSabsMode == 1) return max(abs(x), EPS);
  if (iSabsMode == 2) return x * tanh(x / EPS);
  if (iSabsMode == 3) return abs(x) + EPS * exp(-abs(x) / EPS);
  return sqrt(x * x + EPS);
}
vec2 sabs(vec2 v) { return vec2(sabs(v.x), sabs(v.y)); }

mat2 rot(float a) {
  float s = sin(a);
  float c = cos(a);
  return mat2(c, -s, s, c);
}

vec3 foldVec(float t) {
  vec3 n = vec3(-0.5, -cos(PI / t), 0.0);
  n.z = sqrt(1.0 - dot(n, n));
  return n;
}

float mapFold(vec3 p, out float orbit) {
  vec3 q = p;
  q.xy = rot(iInitRotXY) * q.xy;
  q.xz = rot(iInitRotXZ) * q.xz;

  vec3 n = foldVec(float(iFoldCount));
  float absOffset = iFoldScale * 0.08;

  for (int i = 0; i < 8; i++) {
    if (i >= iFoldCount) break;

    q = abs(q) - absOffset;
    if (q.x < q.y) q.xy = q.yx;
    if (q.x < q.z) q.xz = q.zx;
    if (q.y < q.z) q.yz = q.zy;
    q.xy -= 0.05;

    q.xy = sabs(q.xy);
    float g = dot(q, n);
    q -= (g - sabs(g)) * n;

    q.xy = rot(iIterRotXY) * q.xy;
    q.yz = rot(iIterRotYZ) * q.yz;

    orbit += exp(-2.0 * length(q));
  }

  vec3 a = vec3(0.4, 0.4, 0.4);
  return length(q - clamp(q, -a, a)) - 0.05;
}

vec2 mapScene(vec3 p) {
  float orbit = 0.0;
  float d = mapFold(p, orbit);
  d = max(d, length(p) - 2.35);
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

vec3 metalColor(float t) {
  vec3 a = vec3(0.62, 0.60, 0.58);
  vec3 b = vec3(0.18, 0.16, 0.20);
  vec3 c = vec3(1.4, 1.0, 0.7);
  vec3 d = vec3(0.0, 0.12, 0.35);
  return a + b * cos(TAU * (c * t + d));
}

vec3 envReflect(vec3 rd, vec3 n) {
  vec3 ref = reflect(rd, n);
  float sky = smoothstep(-0.1, 0.4, ref.y);
  vec3 warm = vec3(0.12, 0.10, 0.08);
  vec3 cool = vec3(0.08, 0.10, 0.14);
  return mix(warm, cool, sky) * 0.5;
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

  float yaw = iCameraYaw;
  float pitch = iCameraPitch;
  vec3 ro = vec3(sin(yaw) * cos(pitch), sin(pitch), cos(yaw) * cos(pitch)) * iCameraDistance;
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
    float NoV = max(dot(n, -rd), 0.0);
    float spec = pow(max(dot(n, h), 0.0), 192.0) * iSpecular * shadow * 3.5;

    float foldTone = hit.y * 0.12 + length(p) * 0.06;
    vec3 base = metalColor(foldTone);
    vec3 F0 = base * 0.9 + 0.1;
    vec3 fresnel = F0 + (vec3(1.0) - F0) * pow(1.0 - NoV, 5.0);

    vec3 env = envReflect(rd, n);
    vec3 lit = fresnel * (env * ao + diff * shadow * 0.6);
    lit += fresnel * spec;
    lit += base * iAmbient * 0.15 * ao;

    float fog = 1.0 - exp(-0.035 * hit.x * hit.x);
    color = mix(lit, color, fog);
  }

  color = vec3(1.0) - exp(-color * iExposure);
  color = pow(color, vec3(0.4545));

  fragColor = vec4(color, 1.0);
}
