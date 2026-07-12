import { chottoGPU } from 'chottogpu';
import { FPSGraph } from '../libs/FPSGraph.js';
import ringWGSL from './shaders/ring.wgsl?raw';
import gridWGSL from './shaders/grid.wgsl?raw';
import compositeWGSL from './shaders/composite.wgsl?raw';
import bloomExtractWGSL from './shaders/bloomExtract.wgsl?raw';
import blurWGSL from './shaders/blur.wgsl?raw';
import sdfShapeWGSL from './shaders/sdfShape.wgsl?raw';
import hexRunnerWGSL from './shaders/hexRunner.wgsl?raw';
import gaugeWGSL from './shaders/gauge.wgsl?raw';
import ringGaugeWGSL from './shaders/ringGauge.wgsl?raw';
import { isMobile } from '../libs/DeviceDetect.js';
import { PointerInput } from '../libs/PointerInput.js';

const SEGMENTS = 128;
const LAYER_THICKNESS = [0.05, 0.14];
const NUM_LAYERS = 1;
const LAYER_SPACING = 1.2;
const LAYER_RADII = [
  [1.0, 2.0, 3.0, 4.0],
  [1.5, 3.0],
];
const LAYER_RING_ARCS = [
  null,
  [
    [{ start: 0.4, arc: 3.8 }, { start: 4.8, arc: 1.2 }],
    [{ start: 0.0, arc: 2.2 }, { start: 3.0, arc: 2.5 }],
  ],
];
const LAYER_ALPHAS = [1.0, 0.7];
const LAYER_RING_SPEEDS = [
  [0.36, -0.18, 0.096, -0.06],
  [-0.24, 0.144],
];
const ARC_SEGS_PER_RAD = 20;

const LAYER_DECORATIONS = [
  [
    { ri: 0, start: 0.4, arc: 0.55, width: 0.16, skew: 0.15 },
    { ri: 0, start: 3.4, arc: 0.35, width: 0.13, skew: 0.15 },
    { ri: 1, start: 0.9, arc: 0.7,  width: 0.22, skew: 0.08 },
    { ri: 1, start: 2.7, arc: 0.45, width: 0.17, skew: 0.08 },
    { ri: 1, start: 4.8, arc: 0.6,  width: 0.20, skew: 0.08 },
    { ri: 2, start: 0.15, arc: 0.85, width: 0.26, skew: 0.055 },
    { ri: 2, start: 1.7,  arc: 0.35, width: 0.19, skew: 0.055 },
    { ri: 2, start: 3.3,  arc: 1.0,  width: 0.28, skew: 0.055 },
    { ri: 2, start: 5.3,  arc: 0.45, width: 0.21, skew: 0.055 },
    { ri: 3, start: 0.6, arc: 1.1,  width: 0.32, skew: 0.04 },
    { ri: 3, start: 2.8, arc: 0.55, width: 0.25, skew: 0.04 },
    { ri: 3, start: 4.5, arc: 0.85, width: 0.28, skew: 0.04 },
  ],
  [],
];

const ARC_GAP = 0.15;
const ARC_MARGIN = 0.1;
const LAYER_OUTER_ARCS = [
  [
    { ri: 0, start: 1.1 + ARC_MARGIN, span: 3.40 - 0.98 - ARC_MARGIN * 2 },
    { ri: 1, start: 1.70 + ARC_MARGIN, span: 2.70 - 1.80 - ARC_MARGIN * 2 },
    { ri: 2, start: 2.10 + ARC_MARGIN, span: 3.30 - 2.05 - ARC_MARGIN * 2 },
    { ri: 3, start: 1.70 + ARC_MARGIN, span: 2.80 - 1.65 - ARC_MARGIN * 2 },
  ],
  [],
];

const SDF_BOX_XZ = 2.5;
const SDF_BOX_Y_MIN = -0.5;
const SDF_BOX_Y_MAX = 5.5;

const TICK_CONFIGS = [
  [
    { ri: 0, majorDeg: 45, minorDeg: 15, majorLen: 0.08, minorLen: 0.035, width: 0.008 },
    { ri: 1, majorDeg: 15, minorDeg: 3,  majorLen: 0.12, minorLen: 0.045, width: 0.020 },
    { ri: 2, majorDeg: 20, minorDeg: 5,  majorLen: 0.14, minorLen: 0.05,  width: 0.010 },
    { ri: 3, majorDeg: 15, minorDeg: 5,  majorLen: 0.18, minorLen: 0.06,  width: 0.012 },
  ],
  [],
];

const STRIPE_ARC_CONFIGS = [
  { radius: 2.5, thickness: 0.07, count: 36, arcDeg: 5.5, alpha: 0.4, speed: 0.072 },
  { radius: 3.5, thickness: 0.06, count: 48, arcDeg: 4.0, alpha: 0.35, speed: -0.048 },
];

const BORDER_HEX = { radius: 7.5, thickness: 0.06, alpha: 0.9, cornerLen: 1.2, thickEdges: [4], thickScale: 3.0 };
const BORDER_HEX_INNER = { radius: 7.1, thickness: 0.04, alpha: 0.1 };
const BORDER_HEX_RUNNER = { radius: 7.3, thickness: 0.04 };
const BORDER_STRIPES = {
  distance: 9.5, regionWidth: 0.5, spanZ: 10.2,
  spacing: 0.28, lineWidth: 0.07, alpha: 0.15,
};

const GRID_CORNER = {
  spacing: 2.0, extent: 12, gap: 0.06, arm: 0.22, thickness: 0.035, alpha: 0.55,
};

const OUTER_GAUGE_RING = { radius: 4.75, thickness: 0.08, gapDeg: 72 };
const OUTER_GAUGE_RING_TRACK_ALPHA = 0.35;
const OUTER_GAUGE_RING_FILL_ALPHA = 0.9;

const GAUGE_CONFIGS = [
  { centerDeg: 240, spanDeg: 64, innerR: 5.45, outerR: 5.75, tickGap: 0.05, tickLen: 0.14, tickWidth: 0.05 },
];
const GAUGE_TRACK_ALPHA = 0.14;
const GAUGE_FILL_ALPHA = 0.85;
const GAUGE_TICK_ALPHA = 0.8;

const GRID_EXTENT = 12;

const CAM_DISTANCE_SCALE = isMobile() ? 1.7 : 1.0;
const CAM_EYE = [10 * CAM_DISTANCE_SCALE, 10 * CAM_DISTANCE_SCALE, 10 * CAM_DISTANCE_SCALE];
const CAM_TARGET = [0, 0, 0];
const FOV = 50 * Math.PI / 180;
const NEAR = 0.1;
const FAR = 50.0;
const MSAA = 4;
const RENDER_FORMAT = 'rgba16float';
const BLOOM_SPREAD = 2.5;
const BLOOM_INTENSITY = 0.35;
const CA_STRENGTH = 0.03;
const KICK_DECAY = 2.5;

function lookAt(eye, center, up) {
  const out = new Float32Array(16);
  let zx = eye[0] - center[0], zy = eye[1] - center[1], zz = eye[2] - center[2];
  let len = Math.sqrt(zx * zx + zy * zy + zz * zz);
  zx /= len; zy /= len; zz /= len;
  let xx = up[1] * zz - up[2] * zy;
  let xy = up[2] * zx - up[0] * zz;
  let xz = up[0] * zy - up[1] * zx;
  len = Math.sqrt(xx * xx + xy * xy + xz * xz);
  xx /= len; xy /= len; xz /= len;
  const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
  out[0] = xx; out[4] = xy; out[8]  = xz; out[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2]);
  out[1] = yx; out[5] = yy; out[9]  = yz; out[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2]);
  out[2] = zx; out[6] = zy; out[10] = zz; out[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2]);
  out[3] = 0;  out[7] = 0;  out[11] = 0;  out[15] = 1;
  return out;
}

function perspectiveMat(fov, aspect, near, far) {
  const out = new Float32Array(16);
  out.fill(0);
  const f = 1.0 / Math.tan(fov / 2);
  out[0] = f / aspect;
  out[5] = f;
  out[10] = far / (near - far);
  out[11] = -1;
  out[14] = (near * far) / (near - far);
  return out;
}

function mat4Mul(a, b) {
  const out = new Float32Array(16);
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      out[j * 4 + i] =
        a[i] * b[j * 4] + a[4 + i] * b[j * 4 + 1] +
        a[8 + i] * b[j * 4 + 2] + a[12 + i] * b[j * 4 + 3];
    }
  }
  return out;
}

function generateRings() {
  const verts = [];
  const idxs = [];
  const half = (NUM_LAYERS - 1) / 2;
  const STRIDE = 5;

  for (let li = 0; li < NUM_LAYERS; li++) {
    const y = (li - half) * LAYER_SPACING;
    const radii = LAYER_RADII[li];
    const thick = LAYER_THICKNESS[li];
    const arcSpec = LAYER_RING_ARCS[li];
    const speeds = LAYER_RING_SPEEDS[li];
    for (let ri = 0; ri < radii.length; ri++) {
      const r = radii[ri];
      const alpha = LAYER_ALPHAS[li];
      const spd = speeds[ri];
      const innerR = r - thick / 2;
      const outerR = r + thick / 2;

      const arcs = arcSpec ? arcSpec[ri] : [{ start: 0, arc: Math.PI * 2 }];
      for (const arc of arcs) {
        const segs = Math.max(16, Math.ceil((arc.arc / (Math.PI * 2)) * SEGMENTS));
        const base = verts.length / STRIDE;

        for (let s = 0; s <= segs; s++) {
          const angle = arc.start + (s / segs) * arc.arc;
          const c = Math.cos(angle);
          const sn = Math.sin(angle);
          verts.push(c * innerR, y, sn * innerR, alpha, spd);
          verts.push(c * outerR, y, sn * outerR, alpha, spd);
        }

        for (let s = 0; s < segs; s++) {
          const a = base + s * 2;
          const b = a + 1;
          const c = a + 2;
          const d = a + 3;
          idxs.push(a, c, b, b, c, d);
        }
      }
    }
  }

  for (let li = 0; li < NUM_LAYERS; li++) {
    const y = (li - half) * LAYER_SPACING;
    const layerAlpha = LAYER_ALPHAS[li];
    const radii = LAYER_RADII[li];
    const thick = LAYER_THICKNESS[li];
    const speeds = LAYER_RING_SPEEDS[li];
    const decs = LAYER_DECORATIONS[li] || [];

    for (const d of decs) {
      const r = radii[d.ri];
      const spd = speeds[d.ri];
      const alpha = layerAlpha;
      const innerR = r + thick / 2;
      const outerR = r + thick / 2 + d.width;
      const segs = Math.max(8, Math.ceil(d.arc * ARC_SEGS_PER_RAD));
      const base = verts.length / STRIDE;

      for (let s = 0; s <= segs; s++) {
        const t = s / segs;
        const inA = d.start + t * d.arc;
        const outA = d.start + d.skew + t * d.arc;
        verts.push(Math.cos(inA) * innerR, y, Math.sin(inA) * innerR, alpha, spd);
        verts.push(Math.cos(outA) * outerR, y, Math.sin(outA) * outerR, alpha, spd);
      }

      for (let s = 0; s < segs; s++) {
        const a = base + s * 2;
        const b = a + 1;
        const c = a + 2;
        const dd = a + 3;
        idxs.push(a, c, b, b, c, dd);
      }
    }

    const arcs = LAYER_OUTER_ARCS[li] || [];
    for (const oa of arcs) {
      const r = radii[oa.ri];
      const spd = speeds[oa.ri];
      const innerR = r + thick / 2 + ARC_GAP;
      const outerR = innerR + thick;
      const startA = oa.start;
      const segs = Math.max(8, Math.ceil(oa.span * ARC_SEGS_PER_RAD));
      const base = verts.length / STRIDE;

      for (let s = 0; s <= segs; s++) {
        const t = s / segs;
        const a = startA + t * oa.span;
        verts.push(Math.cos(a) * innerR, y, Math.sin(a) * innerR, layerAlpha, spd);
        verts.push(Math.cos(a) * outerR, y, Math.sin(a) * outerR, layerAlpha, spd);
      }
      for (let s = 0; s < segs; s++) {
        const a = base + s * 2;
        const b = a + 1;
        const c = a + 2;
        const dd = a + 3;
        idxs.push(a, c, b, b, c, dd);
      }
    }
  }

  for (let li = 0; li < NUM_LAYERS; li++) {
    const y = (li - half) * LAYER_SPACING;
    const radii = LAYER_RADII[li];
    const thick = LAYER_THICKNESS[li];
    const speeds = LAYER_RING_SPEEDS[li];
    const ticks = TICK_CONFIGS[li] || [];
    const layerAlpha = LAYER_ALPHAS[li];

    for (const tc of ticks) {
      const r = radii[tc.ri];
      const spd = speeds[tc.ri];
      const innerR = r - thick / 2;
      const halfW = tc.width / 2;

      for (let deg = 0; deg < 360; deg += tc.minorDeg) {
        const isMajor = deg % tc.majorDeg === 0;
        const tickLen = isMajor ? tc.majorLen : tc.minorLen;
        const alpha = isMajor ? layerAlpha : layerAlpha * 0.5;
        const angle = deg * Math.PI / 180;
        const c = Math.cos(angle);
        const s = Math.sin(angle);
        const px = -s * halfW;
        const pz = c * halfW;
        const tickOuter = innerR;
        const tickInner = innerR - tickLen;
        const base = verts.length / STRIDE;
        verts.push(c * tickOuter + px, y, s * tickOuter + pz, alpha, spd);
        verts.push(c * tickOuter - px, y, s * tickOuter - pz, alpha, spd);
        verts.push(c * tickInner + px, y, s * tickInner + pz, alpha, spd);
        verts.push(c * tickInner - px, y, s * tickInner - pz, alpha, spd);
        idxs.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
      }
    }
  }

  for (const cfg of STRIPE_ARC_CONFIGS) {
    const innerR = cfg.radius - cfg.thickness / 2;
    const outerR = cfg.radius + cfg.thickness / 2;
    const arcRad = cfg.arcDeg * Math.PI / 180;
    const spacing = (Math.PI * 2) / cfg.count;
    const segs = Math.max(4, Math.ceil(arcRad * ARC_SEGS_PER_RAD));

    for (let i = 0; i < cfg.count; i++) {
      const startAngle = i * spacing;
      const base = verts.length / STRIDE;

      for (let s = 0; s <= segs; s++) {
        const t = s / segs;
        const a = startAngle + t * arcRad;
        const c = Math.cos(a);
        const sn = Math.sin(a);
        verts.push(c * innerR, 0, sn * innerR, cfg.alpha, cfg.speed);
        verts.push(c * outerR, 0, sn * outerR, cfg.alpha, cfg.speed);
      }

      for (let s = 0; s < segs; s++) {
        const a = base + s * 2;
        const b = a + 1;
        const cc = a + 2;
        const d = a + 3;
        idxs.push(a, cc, b, b, cc, d);
      }
    }
  }

  {
    const bh = BORDER_HEX;
    const r = bh.radius;
    const t = bh.thickness / 2;
    const cl = bh.cornerLen;
    const corners = [];
    for (let i = 0; i < 6; i++) {
      const a = Math.PI / 3 * i - Math.PI / 6;
      corners.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
    for (let i = 0; i < 6; i++) {
      const [cx, cz] = corners[i];
      const [px, pz] = corners[(i + 5) % 6];
      const [nx2, nz2] = corners[(i + 1) % 6];
      const toPrev = [px - cx, pz - cz];
      const toNext = [nx2 - cx, nz2 - cz];
      const lenPrev = Math.sqrt(toPrev[0] ** 2 + toPrev[1] ** 2);
      const lenNext = Math.sqrt(toNext[0] ** 2 + toNext[1] ** 2);
      const segLen = Math.min(cl, lenPrev / 2, lenNext / 2);
      const ep = [cx + toPrev[0] / lenPrev * segLen, cz + toPrev[1] / lenPrev * segLen];
      const en = [cx + toNext[0] / lenNext * segLen, cz + toNext[1] / lenNext * segLen];

      const prevEdge = (i + 5) % 6;
      const nextEdge = i;
      const prevThick = bh.thickEdges.includes(prevEdge) ? bh.thickScale : 1.0;
      const nextThick = bh.thickEdges.includes(nextEdge) ? bh.thickScale : 1.0;

      const segs = [[ep[0], ep[1], cx, cz, prevThick], [cx, cz, en[0], en[1], nextThick]];
      for (const [ax, az, bx, bz, scale] of segs) {
        const dx = bx - ax, dz = bz - az;
        const len = Math.sqrt(dx * dx + dz * dz);
        if (len < 0.001) continue;
        const tt = t * scale;
        const nnx = -dz / len * tt, nnz = dx / len * tt;
        const base = verts.length / STRIDE;
        verts.push(ax + nnx, 0, az + nnz, bh.alpha, 0);
        verts.push(ax - nnx, 0, az - nnz, bh.alpha, 0);
        verts.push(bx + nnx, 0, bz + nnz, bh.alpha, 0);
        verts.push(bx - nnx, 0, bz - nnz, bh.alpha, 0);
        idxs.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
      }
    }
  }

  {
    const bi = BORDER_HEX_INNER;
    const r = bi.radius;
    const t = bi.thickness / 2;
    const corners = [];
    for (let i = 0; i < 6; i++) {
      const a = Math.PI / 3 * i - Math.PI / 6;
      corners.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
    for (let i = 0; i < 6; i++) {
      const [ax, az] = corners[i];
      const [bx, bz] = corners[(i + 1) % 6];
      const dx = bx - ax, dz = bz - az;
      const len = Math.sqrt(dx * dx + dz * dz);
      const nx = -dz / len * t, nz = dx / len * t;
      const base = verts.length / STRIDE;
      verts.push(ax + nx, 0, az + nz, bi.alpha, 0);
      verts.push(ax - nx, 0, az - nz, bi.alpha, 0);
      verts.push(bx + nx, 0, bz + nz, bi.alpha, 0);
      verts.push(bx - nx, 0, bz - nz, bi.alpha, 0);
      idxs.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
    }
  }


  {
    const st = BORDER_STRIPES;
    const d = st.distance;
    const hw = st.lineWidth / 2;
    const px = hw / Math.SQRT2;
    const pz = -px;
    const z0 = -st.spanZ / 2;
    const z1 = st.spanZ / 2;

    const regions = [
      { x0: -d - st.regionWidth / 2, x1: -d + st.regionWidth / 2 },
      { x0: d - st.regionWidth / 2, x1: d + st.regionWidth / 2 },
    ];

    for (const reg of regions) {
      const dMin = reg.x0 - z1;
      const dMax = reg.x1 - z0;

      for (let dd = dMin; dd <= dMax; dd += st.spacing) {
        const xs = Math.max(reg.x0, z0 + dd);
        const xe = Math.min(reg.x1, z1 + dd);
        if (xs >= xe) continue;
        const zs = xs - dd;
        const ze = xe - dd;
        const midX = (xs + xe) / 2;
        const midZ = (zs + ze) / 2;
        const dist = Math.sqrt(midX * midX + midZ * midZ);
        const fade = 1.0 - Math.min(1.0, Math.max(0.0, (dist - 3.0) / 7.0));
        const a = st.alpha * fade;
        const base = verts.length / STRIDE;
        verts.push(xs + px, 0, zs + pz, a, 0);
        verts.push(xs - px, 0, zs - pz, a, 0);
        verts.push(xe + px, 0, ze + pz, a, 0);
        verts.push(xe - px, 0, ze - pz, a, 0);
        idxs.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
      }
    }
  }

  {
    const gc = GRID_CORNER;
    const halfT = gc.thickness / 2;

    for (let ix = -gc.extent; ix <= gc.extent; ix += gc.spacing) {
      for (let iz = -gc.extent; iz <= gc.extent; iz += gc.spacing) {
        const dist = Math.sqrt(ix * ix + iz * iz);
        const fade = 1.0 - Math.min(1.0, Math.max(0.0, (dist - 3.0) / 7.0));
        if (fade <= 0.001) continue;
        const alpha = gc.alpha * fade;

        for (const sx of [-1, 1]) {
          for (const sz of [-1, 1]) {
            const cx = ix + sx * gc.gap;
            const cz = iz + sz * gc.gap;
            const ex = cx + sx * gc.arm;
            const ez = cz + sz * gc.arm;

            {
              const base = verts.length / STRIDE;
              verts.push(cx, 0, cz - halfT, alpha, 0);
              verts.push(cx, 0, cz + halfT, alpha, 0);
              verts.push(ex, 0, cz - halfT, alpha, 0);
              verts.push(ex, 0, cz + halfT, alpha, 0);
              idxs.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
            }
            {
              const base = verts.length / STRIDE;
              verts.push(cx - halfT, 0, cz, alpha, 0);
              verts.push(cx + halfT, 0, cz, alpha, 0);
              verts.push(cx - halfT, 0, ez, alpha, 0);
              verts.push(cx + halfT, 0, ez, alpha, 0);
              idxs.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
            }
          }
        }
      }
    }
  }

  return {
    positions: new Float32Array(verts),
    indices: new Uint16Array(idxs),
  };
}

function generateGauges() {
  const verts = [];
  const idxs = [];
  const STRIDE = 5;

  for (const cfg of GAUGE_CONFIGS) {
    const centerA = cfg.centerDeg * Math.PI / 180;
    const span = cfg.spanDeg * Math.PI / 180;
    const startA = centerA - span / 2;
    const segs = Math.max(8, Math.ceil(span * ARC_SEGS_PER_RAD));

    {
      const base = verts.length / STRIDE;
      for (let s = 0; s <= segs; s++) {
        const a = startA + (s / segs) * span;
        const c = Math.cos(a), sn = Math.sin(a);
        verts.push(c * cfg.innerR, 0, sn * cfg.innerR, GAUGE_TRACK_ALPHA, -1);
        verts.push(c * cfg.outerR, 0, sn * cfg.outerR, GAUGE_TRACK_ALPHA, -1);
      }
      for (let s = 0; s < segs; s++) {
        const a = base + s * 2, b = a + 1, c = a + 2, d = a + 3;
        idxs.push(a, c, b, b, c, d);
      }
    }

    {
      const base = verts.length / STRIDE;
      for (let s = 0; s <= segs; s++) {
        const param = s / segs;
        const a = startA + param * span;
        const c = Math.cos(a), sn = Math.sin(a);
        verts.push(c * cfg.innerR, 0, sn * cfg.innerR, GAUGE_FILL_ALPHA, param);
        verts.push(c * cfg.outerR, 0, sn * cfg.outerR, GAUGE_FILL_ALPHA, param);
      }
      for (let s = 0; s < segs; s++) {
        const a = base + s * 2, b = a + 1, c = a + 2, d = a + 3;
        idxs.push(a, c, b, b, c, d);
      }
    }

    for (const param of [0, 0.5, 1]) {
      const a = startA + param * span;
      const c = Math.cos(a), sn = Math.sin(a);
      const tx = -sn, tz = c;
      const hw = cfg.tickWidth / 2;
      const rInner = cfg.outerR + cfg.tickGap;
      const rOuter = rInner + cfg.tickLen;
      const base = verts.length / STRIDE;
      verts.push(c * rInner + tx * hw, 0, sn * rInner + tz * hw, GAUGE_TICK_ALPHA, -1);
      verts.push(c * rInner - tx * hw, 0, sn * rInner - tz * hw, GAUGE_TICK_ALPHA, -1);
      verts.push(c * rOuter + tx * hw, 0, sn * rOuter + tz * hw, GAUGE_TICK_ALPHA, -1);
      verts.push(c * rOuter - tx * hw, 0, sn * rOuter - tz * hw, GAUGE_TICK_ALPHA, -1);
      idxs.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
    }
  }

  return {
    positions: new Float32Array(verts),
    indices: new Uint16Array(idxs),
  };
}

function generateOuterGaugeRing() {
  const cfg = OUTER_GAUGE_RING;
  const verts = [];
  const idxs = [];
  const STRIDE = 5;

  const innerR = cfg.radius - cfg.thickness / 2;
  const outerR = cfg.radius + cfg.thickness / 2;
  const arcSpan = (360 - cfg.gapDeg) * Math.PI / 180;
  const startA = (cfg.gapDeg / 2) * Math.PI / 180;
  const segs = Math.max(32, Math.ceil(arcSpan * ARC_SEGS_PER_RAD));

  {
    const base = verts.length / STRIDE;
    for (let s = 0; s <= segs; s++) {
      const a = startA + (s / segs) * arcSpan;
      const c = Math.cos(a), sn = Math.sin(a);
      verts.push(c * innerR, 0, sn * innerR, OUTER_GAUGE_RING_TRACK_ALPHA, -1);
      verts.push(c * outerR, 0, sn * outerR, OUTER_GAUGE_RING_TRACK_ALPHA, -1);
    }
    for (let s = 0; s < segs; s++) {
      const a = base + s * 2, b = a + 1, c = a + 2, d = a + 3;
      idxs.push(a, c, b, b, c, d);
    }
  }

  {
    const base = verts.length / STRIDE;
    for (let s = 0; s <= segs; s++) {
      const param = s / segs;
      const a = startA + param * arcSpan;
      const c = Math.cos(a), sn = Math.sin(a);
      verts.push(c * innerR, 0, sn * innerR, OUTER_GAUGE_RING_FILL_ALPHA, param);
      verts.push(c * outerR, 0, sn * outerR, OUTER_GAUGE_RING_FILL_ALPHA, param);
    }
    for (let s = 0; s < segs; s++) {
      const a = base + s * 2, b = a + 1, c = a + 2, d = a + 3;
      idxs.push(a, c, b, b, c, d);
    }
  }

  return {
    positions: new Float32Array(verts),
    indices: new Uint16Array(idxs),
  };
}

function generateGrid() {
  const e = GRID_EXTENT;
  const verts = [
    -e, 0,  e, 1.0, 0,
     e, 0,  e, 1.0, 0,
     e, 0, -e, 1.0, 0,
    -e, 0, -e, 1.0, 0,
  ];
  const idxs = [0, 1, 2, 0, 2, 3];
  return {
    positions: new Float32Array(verts),
    indices: new Uint16Array(idxs),
  };
}


function generateHexRunner() {
  const hr = BORDER_HEX_RUNNER;
  const r = hr.radius;
  const t = hr.thickness / 2;
  const STRIDE = 5;
  const verts = [];
  const idxs = [];
  const corners = [];
  for (let i = 0; i < 6; i++) {
    const a = Math.PI / 3 * i - Math.PI / 6;
    corners.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  for (let i = 0; i < 6; i++) {
    const [ax, az] = corners[i];
    const [bx, bz] = corners[(i + 1) % 6];
    const dx = bx - ax, dz = bz - az;
    const len = Math.sqrt(dx * dx + dz * dz);
    const nx = -dz / len * t, nz = dx / len * t;
    const paramA = i / 6;
    const paramB = (i + 1) / 6;
    const base = verts.length / STRIDE;
    verts.push(ax + nx, 0, az + nz, paramA, 0);
    verts.push(ax - nx, 0, az - nz, paramA, 0);
    verts.push(bx + nx, 0, bz + nz, paramB, 0);
    verts.push(bx - nx, 0, bz - nz, paramB, 0);
    idxs.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
  }
  return {
    positions: new Float32Array(verts),
    indices: new Uint16Array(idxs),
  };
}

function generateSDFBox() {
  const h = SDF_BOX_XZ;
  const y0 = SDF_BOX_Y_MIN;
  const y1 = SDF_BOX_Y_MAX;
  const corners = [
    [-h, y0, -h], [ h, y0, -h], [ h, y0,  h], [-h, y0,  h],
    [-h, y1, -h], [ h, y1, -h], [ h, y1,  h], [-h, y1,  h],
  ];
  const verts = [];
  for (const [x, y, z] of corners) {
    verts.push(x, y, z, 1.0, 0.0);
  }
  const idxs = [
    0, 1, 2, 0, 2, 3,
    5, 4, 7, 5, 7, 6,
    0, 3, 7, 0, 7, 4,
    1, 5, 6, 1, 6, 2,
    0, 4, 5, 0, 5, 1,
    3, 2, 6, 3, 6, 7,
  ];
  return {
    positions: new Float32Array(verts),
    indices: new Uint16Array(idxs),
  };
}

function buildViewProj(aspect) {
  const view = lookAt(CAM_EYE, CAM_TARGET, [0, 1, 0]);
  const proj = perspectiveMat(FOV, aspect, NEAR, FAR);
  return mat4Mul(proj, view);
}

export const main = async () => {
  const canvas = document.createElement('canvas');
  canvas.style.width = '100vw';
  canvas.style.height = '100vh';
  document.body.appendChild(canvas);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.floor(window.innerWidth * dpr);
  canvas.height = Math.floor(window.innerHeight * dpr);

  const fpsGraph = new FPSGraph();
  const gpu = await chottoGPU(canvas);

  let lastKickTime = -Infinity;
  const pointer = new PointerInput(canvas);
  pointer.onClick(() => {
    lastKickTime = performance.now();
  });

  let colorFBO = gpu.framebuffer(canvas.width, canvas.height, {
    format: RENDER_FORMAT, depth: true, samples: MSAA,
  });

  let bloomW = Math.floor(canvas.width / 2);
  let bloomH = Math.floor(canvas.height / 2);
  let bloomA = gpu.framebuffer(bloomW, bloomH, { format: RENDER_FORMAT });
  let bloomB = gpu.framebuffer(bloomW, bloomH, { format: RENDER_FORMAT });

  const rings = generateRings();
  const vertexBuffer = gpu.buffer(rings.positions, { vertex: true });
  const indexBuffer = gpu.buffer(rings.indices, { index: true });
  const indexCount = rings.indices.length;

  const grid = generateGrid();
  const gridVB = gpu.buffer(grid.positions, { vertex: true });
  const gridIB = gpu.buffer(grid.indices, { index: true });
  const gridIdxCount = grid.indices.length;

  const sdfBox = generateSDFBox();
  const sdfBoxVB = gpu.buffer(sdfBox.positions, { vertex: true });
  const sdfBoxIB = gpu.buffer(sdfBox.indices, { index: true });
  const sdfBoxIdxCount = sdfBox.indices.length;

  const hexRunner = generateHexRunner();
  const hexRunnerVB = gpu.buffer(hexRunner.positions, { vertex: true });
  const hexRunnerIB = gpu.buffer(hexRunner.indices, { index: true });
  const hexRunnerIdxCount = hexRunner.indices.length;

  const gauges = generateGauges();
  const gaugeVB = gpu.buffer(gauges.positions, { vertex: true });
  const gaugeIB = gpu.buffer(gauges.indices, { index: true });
  const gaugeIdxCount = gauges.indices.length;

  const outerGaugeRing = generateOuterGaugeRing();
  const outerGaugeRingVB = gpu.buffer(outerGaugeRing.positions, { vertex: true });
  const outerGaugeRingIB = gpu.buffer(outerGaugeRing.indices, { index: true });
  const outerGaugeRingIdxCount = outerGaugeRing.indices.length;

  const vertexLayout = [{
    arrayStride: 20,
    attributes: [
      { shaderLocation: 0, offset: 0, format: 'float32x3' },
      { shaderLocation: 1, offset: 12, format: 'float32' },
      { shaderLocation: 2, offset: 16, format: 'float32' },
    ],
  }];

  const sceneData = new Float32Array(24);
  const sceneUBO = gpu.buffer(sceneData, { uniform: true });

  const compositeData = new Float32Array(4);
  const compositeUBO = gpu.buffer(compositeData, { uniform: true });


  const ringColorPipe = gpu.pipeline({
    vertex: ringWGSL,
    fragment: ringWGSL,
    format: RENDER_FORMAT,
    vertexBuffers: vertexLayout,
    depthTest: true,
    depthWrite: false,
    cullMode: 'none',
    samples: MSAA,
    blend: {
      color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
      alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
    },
  });


  const sdfColorPipe = gpu.pipeline({
    vertex: sdfShapeWGSL,
    fragment: sdfShapeWGSL,
    format: RENDER_FORMAT,
    vertexBuffers: vertexLayout,
    depthTest: true,
    depthWrite: false,
    cullMode: 'back',
    samples: MSAA,
    blend: {
      color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
      alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
    },
  });


  const gridColorPipe = gpu.pipeline({
    vertex: gridWGSL,
    fragment: gridWGSL,
    format: RENDER_FORMAT,
    vertexBuffers: vertexLayout,
    depthTest: true,
    depthWrite: false,
    cullMode: 'none',
    samples: MSAA,
    blend: {
      color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
      alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
    },
  });

  const hexRunnerPipe = gpu.pipeline({
    vertex: hexRunnerWGSL,
    fragment: hexRunnerWGSL,
    format: RENDER_FORMAT,
    vertexBuffers: vertexLayout,
    depthTest: true,
    depthWrite: false,
    cullMode: 'none',
    samples: MSAA,
    blend: {
      color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
      alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
    },
  });

  const gaugePipe = gpu.pipeline({
    vertex: gaugeWGSL,
    fragment: gaugeWGSL,
    format: RENDER_FORMAT,
    vertexBuffers: vertexLayout,
    depthTest: true,
    depthWrite: false,
    cullMode: 'none',
    samples: MSAA,
    blend: {
      color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
      alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
    },
  });

  const ringGaugePipe = gpu.pipeline({
    vertex: ringGaugeWGSL,
    fragment: ringGaugeWGSL,
    format: RENDER_FORMAT,
    vertexBuffers: vertexLayout,
    depthTest: true,
    depthWrite: false,
    cullMode: 'none',
    samples: MSAA,
    blend: {
      color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
      alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
    },
  });

  const compositePipe = gpu.pipeline({
    vertex: gpu.FULLSCREEN_VERT,
    fragment: compositeWGSL,
  });

  const bloomExtractPipe = gpu.pipeline({
    vertex: gpu.FULLSCREEN_VERT,
    fragment: bloomExtractWGSL,
    format: RENDER_FORMAT,
  });

  const blurPipe = gpu.pipeline({
    vertex: gpu.FULLSCREEN_VERT,
    fragment: blurWGSL,
    format: RENDER_FORMAT,
  });

  const colorBG = gpu.device.createBindGroup({
    layout: ringColorPipe.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: sceneUBO.buffer } }],
  });


  const gridBG = gpu.device.createBindGroup({
    layout: gridColorPipe.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: sceneUBO.buffer } }],
  });

  const hexRunnerBG = gpu.device.createBindGroup({
    layout: hexRunnerPipe.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: sceneUBO.buffer } }],
  });

  const sdfColorBG = gpu.device.createBindGroup({
    layout: sdfColorPipe.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: sceneUBO.buffer } }],
  });

  const gaugeBG = gpu.device.createBindGroup({
    layout: gaugePipe.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: sceneUBO.buffer } }],
  });

  const ringGaugeBG = gpu.device.createBindGroup({
    layout: ringGaugePipe.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: sceneUBO.buffer } }],
  });


  const compositeSampler = gpu.device.createSampler({
    magFilter: 'linear', minFilter: 'linear',
    addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge',
  });

  const blurHData = new Float32Array(4);
  const blurVData = new Float32Array(4);
  const blurHUBO = gpu.buffer(blurHData, { uniform: true });
  const blurVUBO = gpu.buffer(blurVData, { uniform: true });

  let compositeBG;
  let extractBG, blurHBG, blurVBG;

  function updateUniforms(w, h, time) {
    const vp = buildViewProj(w / h);
    sceneData.set(vp, 0);
    sceneData[16] = CAM_EYE[0];
    sceneData[17] = CAM_EYE[1];
    sceneData[18] = CAM_EYE[2];
    sceneData[19] = FAR;
    sceneData[20] = time;
    const kickElapsed = (performance.now() - lastKickTime) / 1000;
    const kick = Math.exp(-kickElapsed * KICK_DECAY);
    sceneData[21] = kick;
    sceneUBO.write(sceneData);

    compositeData[0] = BLOOM_INTENSITY + kick * 0.7;
    compositeData[1] = CA_STRENGTH;
    compositeUBO.write(compositeData);

    const bw = Math.floor(w / 2);
    const bh = Math.floor(h / 2);
    blurHData[0] = 1.0; blurHData[1] = 0.0;
    blurHData[2] = BLOOM_SPREAD / bw; blurHData[3] = BLOOM_SPREAD / bh;
    blurHUBO.write(blurHData);
    blurVData[0] = 0.0; blurVData[1] = 1.0;
    blurVData[2] = BLOOM_SPREAD / bw; blurVData[3] = BLOOM_SPREAD / bh;
    blurVUBO.write(blurVData);

    extractBG = gpu.device.createBindGroup({
      layout: bloomExtractPipe.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: compositeSampler },
        { binding: 1, resource: colorFBO.view },
      ],
    });

    blurHBG = gpu.device.createBindGroup({
      layout: blurPipe.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: compositeSampler },
        { binding: 1, resource: bloomA.view },
        { binding: 2, resource: { buffer: blurHUBO.buffer } },
      ],
    });

    blurVBG = gpu.device.createBindGroup({
      layout: blurPipe.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: compositeSampler },
        { binding: 1, resource: bloomB.view },
        { binding: 2, resource: { buffer: blurVUBO.buffer } },
      ],
    });

    compositeBG = gpu.device.createBindGroup({
      layout: compositePipe.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: compositeSampler },
        { binding: 1, resource: colorFBO.view },
        { binding: 2, resource: bloomA.view },
        { binding: 3, resource: { buffer: compositeUBO.buffer } },
      ],
    });
  }

  function render() {
    gpu.frame(() => {
      gpu.pass({ target: colorFBO, clear: [0, 0, 0, 1] }, (p) => {
        p.setPipeline(gridColorPipe);
        p.setBindGroup(0, gridBG);
        p.setVertexBuffer(0, gridVB.buffer);
        p.setIndexBuffer(gridIB.buffer, 'uint16');
        p.drawIndexed(gridIdxCount);

        p.setPipeline(ringColorPipe);
        p.setBindGroup(0, colorBG);
        p.setVertexBuffer(0, vertexBuffer.buffer);
        p.setIndexBuffer(indexBuffer.buffer, 'uint16');
        p.drawIndexed(indexCount);

        p.setPipeline(ringGaugePipe);
        p.setBindGroup(0, ringGaugeBG);
        p.setVertexBuffer(0, outerGaugeRingVB.buffer);
        p.setIndexBuffer(outerGaugeRingIB.buffer, 'uint16');
        p.drawIndexed(outerGaugeRingIdxCount);

        p.setPipeline(hexRunnerPipe);
        p.setBindGroup(0, hexRunnerBG);
        p.setVertexBuffer(0, hexRunnerVB.buffer);
        p.setIndexBuffer(hexRunnerIB.buffer, 'uint16');
        p.drawIndexed(hexRunnerIdxCount);

        p.setPipeline(sdfColorPipe);
        p.setBindGroup(0, sdfColorBG);
        p.setVertexBuffer(0, sdfBoxVB.buffer);
        p.setIndexBuffer(sdfBoxIB.buffer, 'uint16');
        p.drawIndexed(sdfBoxIdxCount);

        p.setPipeline(gaugePipe);
        p.setBindGroup(0, gaugeBG);
        p.setVertexBuffer(0, gaugeVB.buffer);
        p.setIndexBuffer(gaugeIB.buffer, 'uint16');
        p.drawIndexed(gaugeIdxCount);
      });

      gpu.pass({ target: bloomA, clear: [0, 0, 0, 1] }, (p) => {
        p.setPipeline(bloomExtractPipe);
        p.setBindGroup(0, extractBG);
        p.draw(3);
      });

      gpu.pass({ target: bloomB, clear: [0, 0, 0, 1] }, (p) => {
        p.setPipeline(blurPipe);
        p.setBindGroup(0, blurHBG);
        p.draw(3);
      });

      gpu.pass({ target: bloomA, clear: [0, 0, 0, 1] }, (p) => {
        p.setPipeline(blurPipe);
        p.setBindGroup(0, blurVBG);
        p.draw(3);
      });

      gpu.pass((p) => {
        p.setPipeline(compositePipe);
        p.setBindGroup(0, compositeBG);
        p.draw(3);
      });
    });
  }

  gpu.fitWindow((w, h) => {
    colorFBO.resize(w, h);
    bloomW = Math.floor(w / 2);
    bloomH = Math.floor(h / 2);
    bloomA.resize(bloomW, bloomH);
    bloomB.resize(bloomW, bloomH);
  });

  const startTime = performance.now();
  const loop = () => {
    const time = (performance.now() - startTime) / 1000;
    updateUniforms(canvas.width, canvas.height, time);
    render();
    fpsGraph.update();
    pointer.update();
    requestAnimationFrame(loop);
  };
  loop();
};
