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

#define TAU 6.283185307179586
#define FAR 28.0

mat2 rot(float a) {
  float s = sin(a);
  float c = cos(a);
  return mat2(c, -s, s, c);
}

float mapFold(vec3 p, out float orbit) {
  vec3 q = p;

  q.xy = rot(iInitRotXY) * q.xy;
  q.xz = rot(iInitRotXZ) * q.xz;

  float absOffset = iFoldScale * 0.2;

  for (int i = 0; i < 8; i++) {
    if (i >= iFoldCount) break;
    q = abs(q) - absOffset;

    if (q.x < q.y) q.xy = q.yx;
    if (q.x < q.z) q.xz = q.zx;

    q.xy -= 0.05;

    q.xy = rot(iIterRotXY) * q.xy;
    q.yz = rot(iIterRotYZ) * q.yz;

    orbit += exp(-2.0 * length(q));
  }

  q.x -= clamp(q.x, -0.5, 0.5);

  return length(vec2(length(q.xy) - 0.5, q.z)) - 0.4;
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

vec3 palette(float t) {
  vec3 a = vec3(0.50, 0.50, 0.50);
  vec3 b = vec3(0.20, 0.20, 0.20);
  vec3 c = vec3(1.0, 1.0, 1.0);
  vec3 d = vec3(0.0, 0.05, 0.10);
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
    float spec = pow(max(dot(n, h), 0.0), 44.0) * iSpecular * shadow;
    float rim = pow(1.0 - max(dot(n, -rd), 0.0), 3.4);

    float foldTone = hit.y * 0.08 + 0.575 + length(p) * 0.045;
    vec3 base = palette(foldTone);

    vec3 lit = base * (iAmbient + diff * shadow * 1.25) * ao;
    lit += vec3(1.0, 0.98, 0.95) * spec;
    lit += vec3(0.7, 0.72, 0.76) * rim * (0.18 + 0.22 * ao);

    float fog = 1.0 - exp(-0.035 * hit.x * hit.x);
    color = mix(lit, color, fog);
  }

  float vignette = smoothstep(1.35, 0.25, length(uv));
  color *= mix(0.62, 1.08, vignette);
  color = vec3(1.0) - exp(-color * iExposure);
  color = pow(color, vec3(0.4545));

  fragColor = vec4(color, 1.0);
}
