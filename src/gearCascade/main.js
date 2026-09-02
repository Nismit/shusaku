import { chottoGPU } from 'chottogpu';
import GUI from '../libs/gui.js';
import { FPSGraph } from '../libs/FPSGraph.js';
import { PointerInput } from '../libs/PointerInput.js';

import meshWGSL from './shaders/mesh.wgsl?raw';
import shadowWGSL from './shaders/shadow.wgsl?raw';
import screenWGSL from './shaders/screen.wgsl?raw';

// --- Palette indices (must match PALETTE in mesh.wgsl) ----------------------
const C_WHITE = 0, C_RED = 1, C_YELLOW = 2, C_BLUE = 3, C_INK = 4, C_PLATE = 5, C_STEEL = 6;

// --- Parts. Every vertex carries a part id; the CPU uploads one model matrix
//     per part each frame. One draw call moves the whole machine. -------------
const PART_FRAME = 0;
const PART_GEAR = 1;   // 1..4
const PART_PAWL = 5;
const PART_ROD = 6;
const PART_PISTON = 7;
const PART_COUNT = 8;

const MODULE = 0.15;

// teeth / direction-from-previous-gear / colour. Centre distances and phase are
// derived, never hand-placed, so the teeth always mesh exactly.
const GEARS = [
  { teeth: 24, phi: null,                color: C_RED,    hub: C_INK },
  { teeth: 11, phi: 45 * Math.PI / 180,  color: C_YELLOW, hub: C_INK },
  { teeth: 19, phi: -30 * Math.PI / 180, color: C_BLUE,   hub: C_INK },
  { teeth: 16, phi: -75 * Math.PI / 180, color: C_INK,    hub: C_WHITE },
];
const GEAR_Z0 = -0.05, GEAR_Z1 = 0.24;
const ORIGIN = [-3.0, -0.2];

const RATCHET_TEETH = 10;
const RATCHET_BASE = 1.20, RATCHET_TIP = 1.34;
const RATCHET_Z0 = 0.24, RATCHET_Z1 = 0.36;

// The ratchet is coaxial with the driver, so the pawl has to reach in over the
// gear face. Its post therefore sits just outside the driver's tip circle - a
// short thick arm reads as a pawl, a long one only reads as a stick.
const PAWL_POST_R = 2.25;
const PAWL_POST_ANGLE = 135 * Math.PI / 180;
const PAWL_CONTACT = 150 * Math.PI / 180;
const PAWL_Z0 = 0.40, PAWL_Z1 = 0.51;
const PAWL_LIFT = 0.24;

const CRANK_R = 0.62;
const ROD_LEN = 1.95;
const ROD_Z0 = 0.30, ROD_Z1 = 0.42;
const RAIL_Z0 = 0.08, RAIL_Z1 = 0.30;

const PLATE_X0 = -5.35, PLATE_X1 = 5.75, PLATE_Y0 = -3.85, PLATE_Y1 = 3.05;
const PLATE_CX = (PLATE_X0 + PLATE_X1) / 2;
const PLATE_CY = (PLATE_Y0 + PLATE_Y1) / 2;
const PLATE_W = PLATE_X1 - PLATE_X0;
const PLATE_H = PLATE_Y1 - PLATE_Y0;

const FOV = 24 * Math.PI / 180;
const CAM_DIR = [0.15, 0.11, 1.0];
const CAM_MARGIN = 1.16;
const LIGHT_DIR = [0.45, 0.80, 0.55];
const LIGHT_EXTENT = 6.9;
const SHADOW_MAP_SIZE = 1024;
const RENDER_FORMAT = 'rgba16float';
const MSAA = 4;

const BASE_OMEGA = 1.5;      // rad/s on the driver gear
const SPEED_STEP = 0.6;      // added per tap
const SPEED_MAX = 3.4;
const SPEED_DECAY = 0.35;

// Backlash: the play between teeth. Held constant in *linear* units so a small
// gear swings through a bigger angle than a large one, which is what makes the
// wave read as torque travelling rather than everything wobbling in unison.
const STAGE_DELAY = 0.055;
const LAG_LINEAR = 0.075;
const LAG_FREQ = 26.0;
const LAG_DECAY = 7.5;
const IDLE_LINEAR = 0.004;

const easeOutBack = (t) => {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

// --- Matrix helpers ---------------------------------------------------------

function lookAt(eye, center, up) {
  const out = new Float32Array(16);
  let zx = eye[0] - center[0], zy = eye[1] - center[1], zz = eye[2] - center[2];
  let len = Math.hypot(zx, zy, zz);
  zx /= len; zy /= len; zz /= len;
  let xx = up[1] * zz - up[2] * zy;
  let xy = up[2] * zx - up[0] * zz;
  let xz = up[0] * zy - up[1] * zx;
  len = Math.hypot(xx, xy, xz);
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
  const f = 1.0 / Math.tan(fov / 2);
  out[0] = f / aspect;
  out[5] = f;
  out[10] = far / (near - far);
  out[11] = -1;
  out[14] = (near * far) / (near - far);
  return out;
}

function ortho(left, right, bottom, top, near, far) {
  const out = new Float32Array(16);
  const rl = right - left, tb = top - bottom, fn = far - near;
  out[0]  =  2 / rl;
  out[5]  =  2 / tb;
  out[10] = -1 / fn;
  out[12] = -(right + left) / rl;
  out[13] = -(top + bottom) / tb;
  out[14] = -near / fn;
  out[15] = 1;
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

function normalize3(v) {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
}

// Rotation about Z, then translation in XY. Written straight into the parts
// storage buffer at a 16-float offset.
function writePart(dst, part, angle, tx, ty) {
  const o = part * 16;
  const c = Math.cos(angle), s = Math.sin(angle);
  dst[o + 0] = c;  dst[o + 1] = s;  dst[o + 2] = 0; dst[o + 3] = 0;
  dst[o + 4] = -s; dst[o + 5] = c;  dst[o + 6] = 0; dst[o + 7] = 0;
  dst[o + 8] = 0;  dst[o + 9] = 0;  dst[o + 10] = 1; dst[o + 11] = 0;
  dst[o + 12] = tx; dst[o + 13] = ty; dst[o + 14] = 0; dst[o + 15] = 1;
}

// --- Geometry ---------------------------------------------------------------

const V_STRIDE = 8; // pos(3) normal(3) partId colorIdx

class MeshBuilder {
  constructor() { this.v = []; this.i = []; }
  get count() { return this.v.length / V_STRIDE; }

  vert(x, y, z, nx, ny, nz, part, col) {
    this.v.push(x, y, z, nx, ny, nz, part, col);
  }

  quad(a, b, c, d, n, part, col) {
    const base = this.count;
    this.vert(a[0], a[1], a[2], n[0], n[1], n[2], part, col);
    this.vert(b[0], b[1], b[2], n[0], n[1], n[2], part, col);
    this.vert(c[0], c[1], c[2], n[0], n[1], n[2], part, col);
    this.vert(d[0], d[1], d[2], n[0], n[1], n[2], part, col);
    this.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  box(cx, cy, cz, sx, sy, sz, part, col) {
    const hx = sx / 2, hy = sy / 2, hz = sz / 2;
    const p = (i, j, k) => [cx + i * hx, cy + j * hy, cz + k * hz];
    this.quad(p(-1,-1, 1), p( 1,-1, 1), p( 1, 1, 1), p(-1, 1, 1), [0, 0, 1], part, col);
    this.quad(p( 1,-1,-1), p(-1,-1,-1), p(-1, 1,-1), p( 1, 1,-1), [0, 0,-1], part, col);
    this.quad(p( 1,-1, 1), p( 1,-1,-1), p( 1, 1,-1), p( 1, 1, 1), [1, 0, 0], part, col);
    this.quad(p(-1,-1,-1), p(-1,-1, 1), p(-1, 1, 1), p(-1, 1,-1), [-1, 0, 0], part, col);
    this.quad(p(-1, 1, 1), p( 1, 1, 1), p( 1, 1,-1), p(-1, 1,-1), [0, 1, 0], part, col);
    this.quad(p(-1,-1,-1), p( 1,-1,-1), p( 1,-1, 1), p(-1,-1, 1), [0,-1, 0], part, col);
  }

  // Extrudes a CCW outline along Z. The outline must be star-shaped about
  // (cx, cy) so the caps can be fan-triangulated - true for gears and discs.
  extrude(pts, cx, cy, z0, z1, part, col) {
    const n = pts.length;

    let base = this.count;
    this.vert(cx, cy, z1, 0, 0, 1, part, col);
    for (const p of pts) this.vert(p[0] + cx, p[1] + cy, z1, 0, 0, 1, part, col);
    for (let k = 0; k < n; k++) this.i.push(base, base + 1 + k, base + 1 + ((k + 1) % n));

    base = this.count;
    this.vert(cx, cy, z0, 0, 0, -1, part, col);
    for (const p of pts) this.vert(p[0] + cx, p[1] + cy, z0, 0, 0, -1, part, col);
    for (let k = 0; k < n; k++) this.i.push(base, base + 1 + ((k + 1) % n), base + 1 + k);

    for (let k = 0; k < n; k++) {
      const p = pts[k], q = pts[(k + 1) % n];
      const dx = q[0] - p[0], dy = q[1] - p[1];
      const len = Math.hypot(dx, dy) || 1;
      const nrm = [dy / len, -dx / len, 0];
      this.quad(
        [p[0] + cx, p[1] + cy, z0], [q[0] + cx, q[1] + cy, z0],
        [q[0] + cx, q[1] + cy, z1], [p[0] + cx, p[1] + cy, z1],
        nrm, part, col,
      );
    }
  }

  disc(cx, cy, z0, z1, r, segs, part, col) {
    const pts = [];
    for (let k = 0; k < segs; k++) {
      const a = (k / segs) * Math.PI * 2;
      pts.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
    this.extrude(pts, cx, cy, z0, z1, part, col);
  }
}

// Tooth i is centred on local angle i * 2PI/teeth. The meshing phase formula
// below depends on that, so don't shift it.
function gearOutline(teeth) {
  const r = MODULE * teeth / 2;
  const ra = r + MODULE * 0.92;
  const rd = r - MODULE * 1.15;
  const ap = (Math.PI * 2) / teeth;
  const pts = [];
  const at = (rr, aa) => pts.push([Math.cos(aa) * rr, Math.sin(aa) * rr]);
  for (let i = 0; i < teeth; i++) {
    const a = i * ap;
    at(rd, a - ap * 0.30);
    at(r,  a - ap * 0.22);
    at(ra, a - ap * 0.13);
    at(ra, a + ap * 0.13);
    at(r,  a + ap * 0.22);
    at(rd, a + ap * 0.30);
    at(rd, a + ap * 0.50);
  }
  return { pts, r };
}

function sawOutline(teeth, rBase, rTip) {
  const ap = (Math.PI * 2) / teeth;
  const pts = [];
  const at = (rr, aa) => pts.push([Math.cos(aa) * rr, Math.sin(aa) * rr]);
  for (let i = 0; i < teeth; i++) {
    const a = i * ap;
    at(rBase, a);
    at(rTip, a + ap * 0.92);
    at(rBase, a + ap * 0.92);
  }
  return pts;
}

// Lays out the train: each gear sits exactly r(i-1) + r(i) from its neighbour
// along the given direction, so meshing is geometric fact rather than eyeballed.
function layoutTrain() {
  const out = [];
  let prev = null;
  for (let i = 0; i < GEARS.length; i++) {
    const r = MODULE * GEARS[i].teeth / 2;
    let x, y;
    if (i === 0) {
      x = ORIGIN[0]; y = ORIGIN[1];
    } else {
      const d = prev.r + r;
      x = prev.x + Math.cos(GEARS[i].phi) * d;
      y = prev.y + Math.sin(GEARS[i].phi) * d;
    }
    const g = {
      x, y, r,
      teeth: GEARS[i].teeth, phi: GEARS[i].phi,
      color: GEARS[i].color, hub: GEARS[i].hub,
    };
    out.push(g);
    prev = g;
  }
  return out;
}

const TRAIN = layoutTrain();
const LAST = TRAIN[TRAIN.length - 1];
const PISTON_Y = LAST.y;
const RAIL_X0 = 1.95, RAIL_X1 = 5.15;

// The arm meets the ratchet at a slant on purpose: an arm pointing straight at
// the hub would only swing sideways, never climb a tooth.
const PAWL_PIVOT = [
  TRAIN[0].x + Math.cos(PAWL_POST_ANGLE) * PAWL_POST_R,
  TRAIN[0].y + Math.sin(PAWL_POST_ANGLE) * PAWL_POST_R,
];
const PAWL_CONTACT_PT = [
  TRAIN[0].x + Math.cos(PAWL_CONTACT) * RATCHET_TIP,
  TRAIN[0].y + Math.sin(PAWL_CONTACT) * RATCHET_TIP,
];
const PAWL_LEN = Math.hypot(
  PAWL_CONTACT_PT[0] - PAWL_PIVOT[0], PAWL_CONTACT_PT[1] - PAWL_PIVOT[1],
);
const PAWL_BASE_ANGLE = Math.atan2(
  PAWL_CONTACT_PT[1] - PAWL_PIVOT[1], PAWL_CONTACT_PT[0] - PAWL_PIVOT[0],
);

function buildMachine() {
  const mb = new MeshBuilder();

  // Back plate + ink border frame + corner bolts
  mb.box(PLATE_CX, PLATE_CY, -0.415, PLATE_W, PLATE_H, 0.27, PART_FRAME, C_PLATE);
  const bt = 0.16;
  mb.box(PLATE_CX, PLATE_Y0 + bt / 2, -0.18, PLATE_W, bt, 0.24, PART_FRAME, C_INK);
  mb.box(PLATE_CX, PLATE_Y1 - bt / 2, -0.18, PLATE_W, bt, 0.24, PART_FRAME, C_INK);
  mb.box(PLATE_X0 + bt / 2, PLATE_CY, -0.18, bt, PLATE_H, 0.24, PART_FRAME, C_INK);
  mb.box(PLATE_X1 - bt / 2, PLATE_CY, -0.18, bt, PLATE_H, 0.24, PART_FRAME, C_INK);
  for (const [bx, by] of [
    [PLATE_X0 + 0.46, PLATE_Y0 + 0.46], [PLATE_X1 - 0.46, PLATE_Y0 + 0.46],
    [PLATE_X0 + 0.46, PLATE_Y1 - 0.46], [PLATE_X1 - 0.46, PLATE_Y1 - 0.46],
  ]) mb.disc(bx, by, -0.06, 0.05, 0.13, 16, PART_FRAME, C_INK);

  // Gears. Body + hub rotate together; the shaft and its bolt cap belong to the
  // frame, because a gear turns on a shaft that does not.
  TRAIN.forEach((g, i) => {
    const part = PART_GEAR + i;
    const { pts } = gearOutline(g.teeth);
    mb.extrude(pts, 0, 0, GEAR_Z0, GEAR_Z1, part, g.color);

    const hubZ0 = i === 0 ? 0.36 : GEAR_Z1;
    mb.disc(0, 0, hubZ0, hubZ0 + 0.08, 0.34, 20, part, g.hub);

    mb.disc(g.x, g.y, -0.30, GEAR_Z0, 0.17, 16, PART_FRAME, C_STEEL);
    mb.disc(g.x, g.y, hubZ0 + 0.08, hubZ0 + 0.16, 0.15, 16, PART_FRAME, C_WHITE);
  });

  // Ratchet wheel, keyed to the driver
  mb.extrude(sawOutline(RATCHET_TEETH, RATCHET_BASE, RATCHET_TIP), 0, 0,
    RATCHET_Z0, RATCHET_Z1, PART_GEAR, C_WHITE);

  // Pawl: local origin at its pivot, arm along +X
  const pawlCZ = (PAWL_Z0 + PAWL_Z1) / 2, pawlD = PAWL_Z1 - PAWL_Z0;
  mb.disc(0, 0, PAWL_Z0, PAWL_Z1, 0.26, 16, PART_PAWL, C_INK);
  mb.box(PAWL_LEN / 2, 0, pawlCZ, PAWL_LEN, 0.28, pawlD, PART_PAWL, C_INK);
  mb.box(PAWL_LEN - 0.02, -0.10, pawlCZ, 0.36, 0.46, pawlD, PART_PAWL, C_RED);
  mb.disc(PAWL_PIVOT[0], PAWL_PIVOT[1], 0.24, PAWL_Z1, 0.15, 16, PART_FRAME, C_STEEL);
  mb.disc(PAWL_PIVOT[0], PAWL_PIVOT[1], PAWL_Z1, PAWL_Z1 + 0.09, 0.13, 16, PART_FRAME, C_WHITE);

  // Crank pin + counterweight, keyed to the last gear
  const lastPart = PART_GEAR + TRAIN.length - 1;
  mb.disc(CRANK_R, 0, GEAR_Z1, 0.46, 0.115, 16, lastPart, C_STEEL);
  // Stands proud of the gear face - flush with it would put two coplanar
  // surfaces in the depth buffer and stripe the counterweight with z-fighting.
  mb.box(-0.66, 0, (GEAR_Z0 + GEAR_Z1) / 2 + 0.05, 0.66, 0.54, GEAR_Z1 - GEAR_Z0 + 0.10, lastPart, C_RED);

  // Connecting rod: local origin at the crank pin, far end at the piston
  mb.box(ROD_LEN / 2, 0, (ROD_Z0 + ROD_Z1) / 2, ROD_LEN, 0.22, ROD_Z1 - ROD_Z0, PART_ROD, C_RED);
  mb.disc(0, 0, ROD_Z0 - 0.02, ROD_Z1 + 0.02, 0.17, 16, PART_ROD, C_WHITE);
  mb.disc(ROD_LEN, 0, ROD_Z0, ROD_Z1, 0.15, 16, PART_ROD, C_WHITE);

  // Piston
  mb.box(0, 0, 0.36, 1.05, 0.66, 0.46, PART_PISTON, C_YELLOW);
  mb.box(-0.38, 0, 0.36, 0.11, 0.70, 0.48, PART_PISTON, C_INK);
  mb.box(0.38, 0, 0.36, 0.11, 0.70, 0.48, PART_PISTON, C_INK);

  // Guide rails sit behind the rod in Z so the rod can swing past them
  const railCX = (RAIL_X0 + RAIL_X1) / 2, railLen = RAIL_X1 - RAIL_X0;
  const railCZ = (RAIL_Z0 + RAIL_Z1) / 2, railD = RAIL_Z1 - RAIL_Z0;
  mb.box(railCX, PISTON_Y + 0.45, railCZ, railLen, 0.20, railD, PART_FRAME, C_STEEL);
  mb.box(railCX, PISTON_Y - 0.45, railCZ, railLen, 0.20, railD, PART_FRAME, C_STEEL);
  mb.box(RAIL_X1 + 0.16, PISTON_Y, railCZ + 0.14, 0.22, 1.10, railD + 0.28, PART_FRAME, C_INK);
  mb.box(RAIL_X0 - 0.11, PISTON_Y, railCZ, 0.22, 1.10, railD, PART_FRAME, C_INK);

  // Nameplate. Fills the dead corner under the driver and, like the tick marks
  // on a gauge, is what makes the panel read as a manufactured object.
  mb.box(-3.30, -2.60, -0.16, 2.60, 0.62, 0.24, PART_FRAME, C_INK);
  for (const nx of [-4.35, -2.25]) mb.disc(nx, -2.60, -0.04, 0.02, 0.09, 12, PART_FRAME, C_WHITE);
  for (const nx of [-3.85, -3.30, -2.75]) mb.box(nx, -2.60, -0.03, 0.40, 0.10, 0.04, PART_FRAME, C_WHITE);
  mb.box(4.05, 2.20, -0.16, 2.10, 0.66, 0.24, PART_FRAME, C_INK);
  [[3.35, C_RED], [4.05, C_YELLOW], [4.75, C_BLUE]].forEach(([ix, ic]) =>
    mb.disc(ix, 2.20, -0.04, 0.04, 0.20, 16, PART_FRAME, ic));

  return {
    vertices: new Float32Array(mb.v),
    indices: new Uint16Array(mb.i),
  };
}

// --- Kinematics -------------------------------------------------------------

// Gear b meshes with gear a across a centre line at angle phi when
//   Nb * (theta_b - phi) = -Na * (theta_a - phi) + PI,
// i.e. a tooth of a points at b exactly when a gap of b points back.
function idealAngles(driveAngle) {
  const theta = [driveAngle];
  for (let i = 1; i < TRAIN.length; i++) {
    const phi = TRAIN[i].phi;
    const Na = TRAIN[i - 1].teeth, Nb = TRAIN[i].teeth;
    theta.push(phi + Math.PI - Math.PI / Nb - (Na / Nb) * (theta[i - 1] - phi));
  }
  return theta;
}

export const main = async () => {
  const canvas = document.createElement('canvas');
  canvas.style.width = '100vw';
  canvas.style.height = '100vh';
  document.body.appendChild(canvas);

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.floor(window.innerWidth * dpr);
  canvas.height = Math.floor(window.innerHeight * dpr);

  const gpu = await chottoGPU(canvas);
  const fpsGraph = new FPSGraph();
  const pointer = new PointerInput(canvas);

  const params = {
    speed: BASE_OMEGA,
    backlash: LAG_LINEAR,
    ambient: 0.40,
    shadowStrength: 0.52,
  };

  let speedMult = 1.0;
  let driveAngle = 0;
  let kickAt = -1e9;

  pointer.onClick(() => {
    kickAt = performance.now() / 1000;
    speedMult = Math.min(SPEED_MAX, speedMult + SPEED_STEP);
  });

  const machine = buildMachine();
  const vertexBuffer = gpu.buffer(machine.vertices, { vertex: true });
  const indexBuffer = gpu.buffer(machine.indices, { index: true });
  const indexCount = machine.indices.length;

  const partData = new Float32Array(PART_COUNT * 16);
  const partBuffer = gpu.buffer(partData, { storage: true });

  const sceneData = new Float32Array(40);
  const sceneUBO = gpu.buffer(sceneData, { uniform: true });
  const shadowData = new Float32Array(16);
  const shadowUBO = gpu.buffer(shadowData, { uniform: true });

  const vertexLayout = [{
    arrayStride: V_STRIDE * 4,
    attributes: [
      { shaderLocation: 0, offset: 0,  format: 'float32x3' },
      { shaderLocation: 1, offset: 12, format: 'float32x3' },
      { shaderLocation: 2, offset: 24, format: 'float32' },
      { shaderLocation: 3, offset: 28, format: 'float32' },
    ],
  }];

  let renderFBO = gpu.framebuffer(canvas.width, canvas.height, {
    format: RENDER_FORMAT, depth: true, samples: MSAA,
  });
  const shadowFBO = gpu.framebuffer(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE, {
    format: RENDER_FORMAT, depth: true,
  });

  const meshPipe = gpu.pipeline({
    vertex: meshWGSL, fragment: meshWGSL,
    format: RENDER_FORMAT, vertexBuffers: vertexLayout,
    depthTest: true, cullMode: 'none', samples: MSAA,
  });
  const shadowPipe = gpu.pipeline({
    vertex: shadowWGSL, fragment: shadowWGSL,
    format: RENDER_FORMAT, vertexBuffers: vertexLayout,
    depthTest: true, cullMode: 'none',
  });
  const screenPipe = gpu.pipeline({ vertex: gpu.FULLSCREEN_VERT, fragment: screenWGSL });

  const shadowSampler = gpu.device.createSampler({
    magFilter: 'linear', minFilter: 'linear',
    addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge',
  });

  const meshBG = gpu.device.createBindGroup({
    layout: meshPipe.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: sceneUBO.buffer } },
      { binding: 1, resource: { buffer: partBuffer.buffer } },
      { binding: 2, resource: shadowSampler },
      { binding: 3, resource: shadowFBO.view },
    ],
  });
  const shadowBG = gpu.device.createBindGroup({
    layout: shadowPipe.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: shadowUBO.buffer } },
      { binding: 1, resource: { buffer: partBuffer.buffer } },
    ],
  });

  const lightDir = normalize3(LIGHT_DIR);
  const lightVP = (() => {
    const dist = 16;
    const eye = [PLATE_CX + lightDir[0] * dist, PLATE_CY + lightDir[1] * dist, lightDir[2] * dist];
    const view = lookAt(eye, [PLATE_CX, PLATE_CY, 0], [0, 1, 0]);
    const proj = ortho(-LIGHT_EXTENT, LIGHT_EXTENT, -LIGHT_EXTENT, LIGHT_EXTENT, 0.1, dist * 2.4);
    return mat4Mul(proj, view);
  })();

  const camDir = normalize3(CAM_DIR);

  function vpAtDistance(dist, aspect) {
    const eye = [PLATE_CX + camDir[0] * dist, PLATE_CY + camDir[1] * dist, camDir[2] * dist];
    const view = lookAt(eye, [PLATE_CX, PLATE_CY, 0], [0, 1, 0]);
    const proj = perspectiveMat(FOV, aspect, 0.5, dist * 3);
    return mat4Mul(proj, view);
  }

  // Fitting to the plate's half-extents assumes a head-on camera; from an angle
  // the near corner keystones outside the frame. So project the actual bounding
  // corners and pull back until the widest one lands inside the margin. Three
  // passes is plenty - projected size falls off as 1/distance.
  const FIT_CORNERS = [];
  for (const x of [PLATE_X0, PLATE_X1])
    for (const y of [PLATE_Y0, PLATE_Y1])
      for (const z of [-0.55, 0.60]) FIT_CORNERS.push([x, y, z]);

  function buildCameraVP(aspect) {
    let dist = (Math.max(PLATE_H / 2, (PLATE_W / 2) / aspect)) / Math.tan(FOV / 2);
    for (let pass = 0; pass < 3; pass++) {
      const vp = vpAtDistance(dist, aspect);
      let worst = 0;
      for (const [px, py, pz] of FIT_CORNERS) {
        const w = vp[3] * px + vp[7] * py + vp[11] * pz + vp[15];
        const nx = (vp[0] * px + vp[4] * py + vp[8] * pz + vp[12]) / w;
        const ny = (vp[1] * px + vp[5] * py + vp[9] * pz + vp[13]) / w;
        worst = Math.max(worst, Math.abs(nx), Math.abs(ny));
      }
      dist *= worst * CAM_MARGIN;
    }
    return vpAtDistance(dist, aspect);
  }

  gpu.fitWindow((w, h) => { renderFBO.resize(w, h); });

  const gui = new GUI();
  gui.add(params, 'speed', 0.2, 4.0, 0.05).name('Drive Speed');
  gui.add(params, 'backlash', 0.0, 0.2, 0.005).name('Backlash');
  gui.add(params, 'ambient', 0.1, 0.7, 0.01).name('Ambient');
  gui.add(params, 'shadowStrength', 0.0, 1.0, 0.01).name('Shadow');

  shadowData.set(lightVP, 0);
  shadowUBO.write(shadowData);

  let prevTime = performance.now() / 1000;

  const render = () => {
    const now = performance.now() / 1000;
    const dt = Math.min(0.05, now - prevTime);
    prevTime = now;

    speedMult = 1 + (speedMult - 1) * Math.exp(-dt * SPEED_DECAY);
    driveAngle += params.speed * speedMult * dt;

    const ideal = idealAngles(driveAngle);

    // Torque wave: a damped oscillation released into each stage in turn.
    const lagAt = (i, radius) => {
      const idle = (IDLE_LINEAR / radius) * Math.sin(now * 3.1 + i * 1.7);
      const e = now - (kickAt + i * STAGE_DELAY);
      if (e < 0) return idle;
      const amp = (params.backlash / radius) * Math.exp(-e * LAG_DECAY);
      return idle + amp * Math.sin(e * LAG_FREQ) * (i % 2 === 0 ? 1 : -1);
    };

    writePart(partData, PART_FRAME, 0, 0, 0);
    const theta = TRAIN.map((g, i) => ideal[i] + lagAt(i, g.r));
    TRAIN.forEach((g, i) => writePart(partData, PART_GEAR + i, theta[i], g.x, g.y));

    // Pawl rides up a tooth flank, then drops off the steep face and rebounds.
    const phase = (theta[0] * RATCHET_TEETH) / (Math.PI * 2);
    const tt = phase - Math.floor(phase);
    const lift = tt < 0.85 ? tt / 0.85 : 1 - easeOutBack((tt - 0.85) / 0.15);
    writePart(partData, PART_PAWL, PAWL_BASE_ANGLE - PAWL_LIFT * lift, PAWL_PIVOT[0], PAWL_PIVOT[1]);

    // Slider-crank
    const last = TRAIN.length - 1;
    const pinX = LAST.x + CRANK_R * Math.cos(theta[last]);
    const pinY = LAST.y + CRANK_R * Math.sin(theta[last]);
    const dy = PISTON_Y - pinY;
    const dx = Math.sqrt(Math.max(1e-4, ROD_LEN * ROD_LEN - dy * dy));
    writePart(partData, PART_ROD, Math.atan2(dy, dx), pinX, pinY);
    writePart(partData, PART_PISTON, 0, pinX + dx, PISTON_Y);

    partBuffer.write(partData);

    const aspect = canvas.width / canvas.height;
    sceneData.set(buildCameraVP(aspect), 0);
    sceneData.set(lightVP, 16);
    sceneData[32] = lightDir[0];
    sceneData[33] = lightDir[1];
    sceneData[34] = lightDir[2];
    sceneData[35] = params.ambient;
    sceneData[36] = SHADOW_MAP_SIZE;
    sceneData[37] = 2.2;
    sceneData[38] = params.shadowStrength;
    sceneData[39] = now;
    sceneUBO.write(sceneData);

    gpu.frame(() => {
      gpu.pass({ target: shadowFBO, clear: [1, 1, 1, 1] }, (p) => {
        p.setPipeline(shadowPipe);
        p.setBindGroup(0, shadowBG);
        p.setVertexBuffer(0, vertexBuffer.buffer);
        p.setIndexBuffer(indexBuffer.buffer, 'uint16');
        p.drawIndexed(indexCount);
      });

      gpu.pass({ target: renderFBO, clear: [0.60, 0.58, 0.545, 1] }, (p) => {
        p.setPipeline(meshPipe);
        p.setBindGroup(0, meshBG);
        p.setVertexBuffer(0, vertexBuffer.buffer);
        p.setIndexBuffer(indexBuffer.buffer, 'uint16');
        p.drawIndexed(indexCount);
      });

      gpu.pass((p) => {
        p.setPipeline(screenPipe);
        p.setBindGroup(0, gpu.device.createBindGroup({
          layout: screenPipe.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: gpu.sampler },
            { binding: 1, resource: renderFBO.view },
          ],
        }));
        p.draw(3);
      });
    });

    fpsGraph.update();
    pointer.update();
    requestAnimationFrame(render);
  };

  render();
};
