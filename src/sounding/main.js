import { chottoGPU } from 'chottogpu';
import { FPSGraph } from '../libs/FPSGraph.js';
import { PointerInput } from '../libs/PointerInput.js';
import { Timer } from '../libs/Timer.js';

import initWGSL from './shaders/init.wgsl?raw';
import updateWGSL from './shaders/update.wgsl?raw';
import densityClearWGSL from './shaders/densityClear.wgsl?raw';
import densityAccumWGSL from './shaders/densityAccum.wgsl?raw';
import particleWGSL from './shaders/particle.wgsl?raw';
import ringWGSL from './shaders/ring.wgsl?raw';
import gaugeWGSL from './shaders/gauge.wgsl?raw';
import bloomExtractWGSL from './shaders/bloomExtract.wgsl?raw';
import blurWGSL from './shaders/blur.wgsl?raw';
import compositeWGSL from './shaders/composite.wgsl?raw';

const PARTICLE_COUNT = 256 * 256;
const GRID_SIZE = 64;
const SPAWN_RADIUS = 2.0;
const MSAA = 4;
const RENDER_FORMAT = 'rgba16float';

const NOISE_SCALE = 0.6;
const NOISE_STRENGTH = 0.008;
const PARTICLE_LIFETIME = 12.0;
const EXPAND_SPEED = 0.0003;
const PARTICLE_SIZE = 0.04;
const DENSITY_SCALE = 0.12;

const CAM_DISTANCE = 12.0;
const CAM_ELEVATION = Math.PI / 5;
const CAM_AUTO_SPEED = 0.06;
const FOV = 50 * Math.PI / 180;
const NEAR = 0.1;
const FAR = 50.0;

const BLOOM_SPREAD = 2.5;
const BLOOM_INTENSITY = 0.5;
const CA_STRENGTH = 0.025;

const BURST_STRENGTH = 0.35;
const BURST_WAVE_SPEED = 3.0;
const BURST_SHELL_THICK = 0.5;
const BURST_DECAY = 2.5;

const SEGMENTS = 96;
const ARC_SEGS_PER_RAD = 20;

const RING_CONFIGS = [
  { radius: 1.2, thickness: 0.04, speed: 0.24, alpha: 0.9 },
  { radius: 2.0, thickness: 0.05, speed: -0.12, alpha: 0.85 },
  { radius: 2.8, thickness: 0.05, speed: 0.06, alpha: 0.8 },
  { radius: 3.6, thickness: 0.06, speed: -0.03, alpha: 0.75 },
];

const TICK_CONFIGS = [
  { majorDeg: 30, minorDeg: 10, majorLen: 0.08, minorLen: 0.03, width: 0.008 },
  { majorDeg: 15, minorDeg: 5,  majorLen: 0.10, minorLen: 0.04, width: 0.012 },
  { majorDeg: 20, minorDeg: 5,  majorLen: 0.12, minorLen: 0.04, width: 0.010 },
  { majorDeg: 15, minorDeg: 5,  majorLen: 0.14, minorLen: 0.05, width: 0.012 },
];

const GAUGE_CONFIGS = [
  { centerDeg: 210, spanDeg: 90, innerR: 4.05, outerR: 4.35, tickGap: 0.05, tickLen: 0.12, tickWidth: 0.04 },
  { centerDeg: 50, spanDeg: 70, innerR: 4.10, outerR: 4.35, tickGap: 0.05, tickLen: 0.10, tickWidth: 0.04 },
];
const GAUGE_TRACK_ALPHA = 0.15;
const GAUGE_FILL_ALPHA = 0.85;
const GAUGE_TICK_ALPHA = 0.7;

const OUTER_RING_GAUGE = { radius: 3.8, thickness: 0.07, gapDeg: 60 };
const OUTER_RING_GAUGE_TRACK_ALPHA = 0.30;
const OUTER_RING_GAUGE_FILL_ALPHA = 0.85;

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
  const STRIDE = 5;

  for (let ri = 0; ri < RING_CONFIGS.length; ri++) {
    const cfg = RING_CONFIGS[ri];
    const innerR = cfg.radius - cfg.thickness / 2;
    const outerR = cfg.radius + cfg.thickness / 2;
    const base = verts.length / STRIDE;

    for (let s = 0; s <= SEGMENTS; s++) {
      const angle = (s / SEGMENTS) * Math.PI * 2;
      const c = Math.cos(angle), sn = Math.sin(angle);
      verts.push(c * innerR, 0, sn * innerR, cfg.alpha, cfg.speed);
      verts.push(c * outerR, 0, sn * outerR, cfg.alpha, cfg.speed);
    }

    for (let s = 0; s < SEGMENTS; s++) {
      const a = base + s * 2;
      const b = a + 1, cc = a + 2, d = a + 3;
      idxs.push(a, cc, b, b, cc, d);
    }

    const tc = TICK_CONFIGS[ri];
    const halfW = tc.width / 2;
    for (let deg = 0; deg < 360; deg += tc.minorDeg) {
      const isMajor = deg % tc.majorDeg === 0;
      const tickLen = isMajor ? tc.majorLen : tc.minorLen;
      const alpha = isMajor ? cfg.alpha : cfg.alpha * 0.5;
      const angle = deg * Math.PI / 180;
      const c = Math.cos(angle), s = Math.sin(angle);
      const px = -s * halfW, pz = c * halfW;
      const tickOuter = innerR;
      const tickInner = innerR - tickLen;
      const tb = verts.length / STRIDE;
      verts.push(c * tickOuter + px, 0, s * tickOuter + pz, alpha, cfg.speed);
      verts.push(c * tickOuter - px, 0, s * tickOuter - pz, alpha, cfg.speed);
      verts.push(c * tickInner + px, 0, s * tickInner + pz, alpha, cfg.speed);
      verts.push(c * tickInner - px, 0, s * tickInner - pz, alpha, cfg.speed);
      idxs.push(tb, tb + 2, tb + 1, tb + 1, tb + 2, tb + 3);
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
        const a = base + s * 2, b = a + 1, cc = a + 2, d = a + 3;
        idxs.push(a, cc, b, b, cc, d);
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
        const a = base + s * 2, b = a + 1, cc = a + 2, d = a + 3;
        idxs.push(a, cc, b, b, cc, d);
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

  {
    const cfg = OUTER_RING_GAUGE;
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
        verts.push(c * innerR, 0, sn * innerR, OUTER_RING_GAUGE_TRACK_ALPHA, -1);
        verts.push(c * outerR, 0, sn * outerR, OUTER_RING_GAUGE_TRACK_ALPHA, -1);
      }
      for (let s = 0; s < segs; s++) {
        const a = base + s * 2, b = a + 1, cc = a + 2, d = a + 3;
        idxs.push(a, cc, b, b, cc, d);
      }
    }

    {
      const base = verts.length / STRIDE;
      for (let s = 0; s <= segs; s++) {
        const param = s / segs;
        const a = startA + param * arcSpan;
        const c = Math.cos(a), sn = Math.sin(a);
        verts.push(c * innerR, 0, sn * innerR, OUTER_RING_GAUGE_FILL_ALPHA, param);
        verts.push(c * outerR, 0, sn * outerR, OUTER_RING_GAUGE_FILL_ALPHA, param);
      }
      for (let s = 0; s < segs; s++) {
        const a = base + s * 2, b = a + 1, cc = a + 2, d = a + 3;
        idxs.push(a, cc, b, b, cc, d);
      }
    }
  }

  return {
    positions: new Float32Array(verts),
    indices: new Uint16Array(idxs),
  };
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

  let burstAge = 100.0;
  const pointer = new PointerInput(canvas);
  pointer.onClick(() => { burstAge = 0; });

  let colorFBO = gpu.framebuffer(canvas.width, canvas.height, {
    format: RENDER_FORMAT, depth: true, samples: MSAA,
  });

  let bloomW = Math.floor(canvas.width / 2);
  let bloomH = Math.floor(canvas.height / 2);
  let bloomA = gpu.framebuffer(bloomW, bloomH, { format: RENDER_FORMAT });
  let bloomB = gpu.framebuffer(bloomW, bloomH, { format: RENDER_FORMAT });

  const initData = new Float32Array(PARTICLE_COUNT * 4);
  const posA = gpu.buffer(initData, { storage: true });
  const posB = gpu.buffer(initData, { storage: true });
  const defaultPosBuffer = gpu.buffer(initData, { storage: true });

  const densityGPUBuf = gpu.device.createBuffer({
    size: GRID_SIZE * GRID_SIZE * 4,
    usage: GPUBufferUsage.STORAGE,
  });

  const initUBOBuf = new ArrayBuffer(16);
  const initUBODV = new DataView(initUBOBuf);
  initUBODV.setUint32(0, PARTICLE_COUNT, true);
  initUBODV.setFloat32(4, 42.0, true);
  initUBODV.setFloat32(8, SPAWN_RADIUS, true);
  const initUBO = gpu.buffer(new Float32Array(initUBOBuf), { uniform: true });

  const updateBuf = new ArrayBuffer(64);
  const updateArr = new Float32Array(updateBuf);
  const updateDV = new DataView(updateBuf);
  const updateUBO = gpu.buffer(updateArr, { uniform: true });

  const densityAccumBuf = new ArrayBuffer(16);
  const densityAccumDV = new DataView(densityAccumBuf);
  densityAccumDV.setUint32(0, PARTICLE_COUNT, true);
  const densityAccumUBO = gpu.buffer(new Float32Array(densityAccumBuf), { uniform: true });

  const sceneArr = new Float32Array(28);
  const sceneUBO = gpu.buffer(sceneArr, { uniform: true });

  const compositeArr = new Float32Array(4);
  const compositeUBO = gpu.buffer(compositeArr, { uniform: true });

  const blurHArr = new Float32Array(4);
  const blurVArr = new Float32Array(4);
  const blurHUBO = gpu.buffer(blurHArr, { uniform: true });
  const blurVUBO = gpu.buffer(blurVArr, { uniform: true });

  const rings = generateRings();
  const ringVB = gpu.buffer(rings.positions, { vertex: true });
  const ringIB = gpu.buffer(rings.indices, { index: true });
  const ringIdxCount = rings.indices.length;

  const gauges = generateGauges();
  const gaugeVB = gpu.buffer(gauges.positions, { vertex: true });
  const gaugeIB = gpu.buffer(gauges.indices, { index: true });
  const gaugeIdxCount = gauges.indices.length;

  const vertexLayout = [{
    arrayStride: 20,
    attributes: [
      { shaderLocation: 0, offset: 0, format: 'float32x3' },
      { shaderLocation: 1, offset: 12, format: 'float32' },
      { shaderLocation: 2, offset: 16, format: 'float32' },
    ],
  }];

  const initPipe = gpu.compute({ shader: initWGSL });
  const updatePipe = gpu.compute({ shader: updateWGSL });
  const densityClearPipe = gpu.compute({ shader: densityClearWGSL });
  const densityAccumPipe = gpu.compute({ shader: densityAccumWGSL });

  const ringPipe = gpu.pipeline({
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

  const particlePipe = gpu.pipeline({
    vertex: particleWGSL,
    fragment: particleWGSL,
    format: RENDER_FORMAT,
    topology: 'triangle-strip',
    depthTest: true,
    depthWrite: false,
    cullMode: 'none',
    samples: MSAA,
    blend: {
      color: { srcFactor: 'src-alpha', dstFactor: 'one', operation: 'add' },
      alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
    },
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

  const compositePipe = gpu.pipeline({
    vertex: gpu.FULLSCREEN_VERT,
    fragment: compositeWGSL,
  });

  const initBG_posA = gpu.device.createBindGroup({
    layout: initPipe.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: posA.buffer } },
      { binding: 1, resource: { buffer: initUBO.buffer } },
    ],
  });

  const initBG_default = gpu.device.createBindGroup({
    layout: initPipe.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: defaultPosBuffer.buffer } },
      { binding: 1, resource: { buffer: initUBO.buffer } },
    ],
  });

  const updateBG0 = gpu.device.createBindGroup({
    layout: updatePipe.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: posA.buffer } },
      { binding: 1, resource: { buffer: posB.buffer } },
      { binding: 2, resource: { buffer: defaultPosBuffer.buffer } },
      { binding: 3, resource: { buffer: updateUBO.buffer } },
    ],
  });

  const updateBG1 = gpu.device.createBindGroup({
    layout: updatePipe.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: posB.buffer } },
      { binding: 1, resource: { buffer: posA.buffer } },
      { binding: 2, resource: { buffer: defaultPosBuffer.buffer } },
      { binding: 3, resource: { buffer: updateUBO.buffer } },
    ],
  });

  const densityClearBG = gpu.device.createBindGroup({
    layout: densityClearPipe.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: densityGPUBuf } },
    ],
  });

  const densityAccumBG0 = gpu.device.createBindGroup({
    layout: densityAccumPipe.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: posB.buffer } },
      { binding: 1, resource: { buffer: densityGPUBuf } },
      { binding: 2, resource: { buffer: densityAccumUBO.buffer } },
    ],
  });

  const densityAccumBG1 = gpu.device.createBindGroup({
    layout: densityAccumPipe.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: posA.buffer } },
      { binding: 1, resource: { buffer: densityGPUBuf } },
      { binding: 2, resource: { buffer: densityAccumUBO.buffer } },
    ],
  });

  const ringBG = gpu.device.createBindGroup({
    layout: ringPipe.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: sceneUBO.buffer } },
      { binding: 1, resource: { buffer: densityGPUBuf } },
    ],
  });

  const gaugeBG = gpu.device.createBindGroup({
    layout: gaugePipe.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: sceneUBO.buffer } },
      { binding: 1, resource: { buffer: densityGPUBuf } },
    ],
  });

  const particleBG0 = gpu.device.createBindGroup({
    layout: particlePipe.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: sceneUBO.buffer } },
      { binding: 1, resource: { buffer: posB.buffer } },
    ],
  });

  const particleBG1 = gpu.device.createBindGroup({
    layout: particlePipe.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: sceneUBO.buffer } },
      { binding: 1, resource: { buffer: posA.buffer } },
    ],
  });

  const compositeSampler = gpu.device.createSampler({
    magFilter: 'linear', minFilter: 'linear',
    addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge',
  });

  let extractBG, blurHBG, blurVBG, compositeBG;

  gpu.frame(() => {
    gpu.dispatch((p) => {
      p.setPipeline(initPipe);
      p.setBindGroup(0, initBG_posA);
      p.dispatchWorkgroups(Math.ceil(PARTICLE_COUNT / 64));
    });
    gpu.dispatch((p) => {
      p.setPipeline(initPipe);
      p.setBindGroup(0, initBG_default);
      p.dispatchWorkgroups(Math.ceil(PARTICLE_COUNT / 64));
    });
  });

  const timer = new Timer();
  timer.start();
  let pingpong = 0;
  let prevTime = 0;

  function updateUniforms(w, h, time) {
    const dt = Math.min(time - prevTime, 0.1);
    prevTime = time;

    burstAge += dt;

    updateDV.setUint32(0, PARTICLE_COUNT, true);
    updateDV.setFloat32(4, time, true);
    updateDV.setFloat32(8, dt * 60, true);
    updateDV.setFloat32(12, NOISE_SCALE, true);
    updateDV.setFloat32(16, NOISE_STRENGTH, true);
    updateDV.setFloat32(20, PARTICLE_LIFETIME, true);
    updateDV.setFloat32(24, EXPAND_SPEED, true);
    updateDV.setFloat32(28, 0, true);
    updateDV.setFloat32(32, 0, true);
    updateDV.setFloat32(36, 0, true);
    updateDV.setFloat32(40, 0, true);
    updateDV.setFloat32(44, burstAge, true);
    updateDV.setFloat32(48, BURST_STRENGTH, true);
    updateDV.setFloat32(52, BURST_WAVE_SPEED, true);
    updateDV.setFloat32(56, BURST_SHELL_THICK, true);
    updateDV.setFloat32(60, BURST_DECAY, true);
    updateUBO.write(updateArr);

    const azimuth = time * CAM_AUTO_SPEED;
    const hDist = CAM_DISTANCE * Math.cos(CAM_ELEVATION);
    const eye = [
      Math.cos(azimuth) * hDist,
      CAM_DISTANCE * Math.sin(CAM_ELEVATION),
      Math.sin(azimuth) * hDist,
    ];

    const view = lookAt(eye, [0, 0, 0], [0, 1, 0]);
    const proj = perspectiveMat(FOV, w / h, NEAR, FAR);
    const vp = mat4Mul(proj, view);

    const camRight = [view[0], view[4], view[8]];
    const camUp = [view[1], view[5], view[9]];

    sceneArr.set(vp, 0);
    sceneArr[16] = camRight[0];
    sceneArr[17] = camRight[1];
    sceneArr[18] = camRight[2];
    sceneArr[19] = time;
    sceneArr[20] = camUp[0];
    sceneArr[21] = camUp[1];
    sceneArr[22] = camUp[2];
    sceneArr[23] = PARTICLE_SIZE;
    sceneArr[24] = DENSITY_SCALE;
    sceneUBO.write(sceneArr);

    compositeArr[0] = BLOOM_INTENSITY;
    compositeArr[1] = CA_STRENGTH;
    compositeUBO.write(compositeArr);

    const bw = Math.floor(w / 2);
    const bh = Math.floor(h / 2);
    blurHArr[0] = 1.0; blurHArr[1] = 0.0;
    blurHArr[2] = BLOOM_SPREAD / bw; blurHArr[3] = BLOOM_SPREAD / bh;
    blurHUBO.write(blurHArr);
    blurVArr[0] = 0.0; blurVArr[1] = 1.0;
    blurVArr[2] = BLOOM_SPREAD / bw; blurVArr[3] = BLOOM_SPREAD / bh;
    blurVUBO.write(blurVArr);

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
    const curUpdateBG = pingpong === 0 ? updateBG0 : updateBG1;
    const curAccumBG = pingpong === 0 ? densityAccumBG0 : densityAccumBG1;
    const curParticleBG = pingpong === 0 ? particleBG0 : particleBG1;

    gpu.frame(() => {
      gpu.dispatch((p) => {
        p.setPipeline(updatePipe);
        p.setBindGroup(0, curUpdateBG);
        p.dispatchWorkgroups(Math.ceil(PARTICLE_COUNT / 64));
      });

      gpu.dispatch((p) => {
        p.setPipeline(densityClearPipe);
        p.setBindGroup(0, densityClearBG);
        p.dispatchWorkgroups(Math.ceil((GRID_SIZE * GRID_SIZE) / 64));
      });

      gpu.dispatch((p) => {
        p.setPipeline(densityAccumPipe);
        p.setBindGroup(0, curAccumBG);
        p.dispatchWorkgroups(Math.ceil(PARTICLE_COUNT / 64));
      });

      gpu.pass({ target: colorFBO, clear: [0.015, 0.02, 0.045, 1] }, (p) => {
        p.setPipeline(ringPipe);
        p.setBindGroup(0, ringBG);
        p.setVertexBuffer(0, ringVB.buffer);
        p.setIndexBuffer(ringIB.buffer, 'uint16');
        p.drawIndexed(ringIdxCount);

        p.setPipeline(gaugePipe);
        p.setBindGroup(0, gaugeBG);
        p.setVertexBuffer(0, gaugeVB.buffer);
        p.setIndexBuffer(gaugeIB.buffer, 'uint16');
        p.drawIndexed(gaugeIdxCount);

        p.setPipeline(particlePipe);
        p.setBindGroup(0, curParticleBG);
        p.draw(4, PARTICLE_COUNT);
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

    pingpong = 1 - pingpong;
  }

  gpu.fitWindow((w, h) => {
    colorFBO.resize(w, h);
    bloomW = Math.floor(w / 2);
    bloomH = Math.floor(h / 2);
    bloomA.resize(bloomW, bloomH);
    bloomB.resize(bloomW, bloomH);
  });

  const loop = () => {
    const time = timer.getElapsedTime();
    updateUniforms(canvas.width, canvas.height, time);
    render();
    fpsGraph.update();
    pointer.update();
    requestAnimationFrame(loop);
  };
  loop();
};
