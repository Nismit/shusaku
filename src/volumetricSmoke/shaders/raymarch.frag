// Volumetric raymarching of the smoke density field. Marches a ray through
// the unit cube [0,1]^3, front-to-back alpha compositing, with a short light
// march for soft self-shadowing.

uniform vec2 iResolution;
uniform sampler2D uDensity;
uniform float uCamYaw;
uniform float uCamPitch;
uniform float uCamDist;
uniform vec3 uSmokeColor;
uniform float uAbsorption;
uniform float uStepCount;
uniform vec3 uLightDir;

const vec3 BOX_MIN = vec3(0.0);
const vec3 BOX_MAX = vec3(1.0);
const vec3 BG = vec3(0.015, 0.018, 0.025);

// Ray vs unit box, returns (tNear, tFar).
vec2 intersectBox(vec3 ro, vec3 rd) {
    vec3 inv = 1.0 / rd;
    vec3 t0 = (BOX_MIN - ro) * inv;
    vec3 t1 = (BOX_MAX - ro) * inv;
    vec3 tmin = min(t0, t1);
    vec3 tmax = max(t0, t1);
    float tn = max(max(tmin.x, tmin.y), tmin.z);
    float tf = min(min(tmax.x, tmax.y), tmax.z);
    return vec2(tn, tf);
}

// Density at a point in [0,1]^3 (trilinear, full quality).
float densityAt(vec3 p01) {
    vec3 cell = p01 * (uVolumeDim - 1.0);
    return sampleVolume(uDensity, cell).a;
}

// Cheaper nearest density for the shadow march.
float densityFast(vec3 p01) {
    vec3 cell = p01 * (uVolumeDim - 1.0);
    return sampleNearest(uDensity, cell).a;
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * iResolution) / iResolution.y;

    // Orbit camera around the box centre.
    float cp = cos(uCamPitch);
    float sp = sin(uCamPitch);
    float cy = cos(uCamYaw);
    float sy = sin(uCamYaw);
    vec3 dir = vec3(cp * sy, sp, cp * cy);
    vec3 ro = vec3(0.5) + dir * uCamDist;

    vec3 forward = normalize(vec3(0.5) - ro);
    vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), forward));
    vec3 up = cross(forward, right);
    float fov = 1.3;
    vec3 rd = normalize(forward + fov * (uv.x * right + uv.y * up));

    vec2 tb = intersectBox(ro, rd);
    tb.x = max(tb.x, 0.0);

    vec3 col = vec3(0.0);
    float trans = 1.0;

    if (tb.y > tb.x) {
        int steps = int(uStepCount);
        float dt = (tb.y - tb.x) / float(steps);
        float t = tb.x + dt * 0.5;
        float lstep = 1.5 / uVolumeDim.x;

        for (int i = 0; i < 256; i++) {
            if (i >= steps || trans < 0.01) break;
            vec3 p = ro + rd * t;
            float sigma = densityAt(p) * uAbsorption;

            if (sigma > 0.001) {
                // Soft shadow: accumulate density toward the light.
                float ls = 0.0;
                vec3 lp = p;
                for (int j = 0; j < 6; j++) {
                    lp += uLightDir * lstep;
                    ls += densityFast(lp) * uAbsorption;
                }
                float shadow = exp(-ls * lstep);
                vec3 lit = uSmokeColor * (0.35 + 0.65 * shadow);

                float a = 1.0 - exp(-sigma * dt);
                col += trans * lit * a;
                trans *= 1.0 - a;
            }
            t += dt;
        }
    }

    vec3 outColor = col + BG * trans;
    fragColor = vec4(outColor, 1.0);
}
