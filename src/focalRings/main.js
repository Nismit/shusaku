import { chottoGPU } from 'chottogpu';
import { FPSGraph } from '../libs/FPSGraph.js';
import ringWGSL from './shaders/ring.wgsl?raw';
import ringDepthWGSL from './shaders/ringDepth.wgsl?raw';
import gridWGSL from './shaders/grid.wgsl?raw';
import dofWGSL from './shaders/dof.wgsl?raw';

const SEGMENTS = 128;
const LAYER_THICKNESS = [0.05, 0.14];
const NUM_LAYERS = 2;
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

const SHAPE_SEED = 42;
const SHAPE_LINE_W = 0.025;
const SHAPE_PTS_PER_Q = 3;
const SHAPE_NUM_RINGS = 3;

const GRID_EXTENT = 12;

const CAM_EYE = [10, 14, 10];
const CAM_TARGET = [0, 0, 0];
const FOV = 50 * Math.PI / 180;
const NEAR = 0.1;
const FAR = 50.0;
const MSAA = 4;
const RENDER_FORMAT = 'rgba16float';
const DEPTH_TEX_FORMAT = 'r16float';
const DOF_APERTURE = 8.0;
const DOF_MAX_BLUR = 16.0;

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

  for (let li = 0; li < NUM_LAYERS; li++) {
    const y = (li - half) * LAYER_SPACING;
    const radii = LAYER_RADII[li];
    const thick = LAYER_THICKNESS[li];
    const arcSpec = LAYER_RING_ARCS[li];
    for (let ri = 0; ri < radii.length; ri++) {
      const r = radii[ri];
      const alpha = LAYER_ALPHAS[li];
      const innerR = r - thick / 2;
      const outerR = r + thick / 2;

      const arcs = arcSpec ? arcSpec[ri] : [{ start: 0, arc: Math.PI * 2 }];
      for (const arc of arcs) {
        const segs = Math.max(16, Math.ceil((arc.arc / (Math.PI * 2)) * SEGMENTS));
        const base = verts.length / 4;

        for (let s = 0; s <= segs; s++) {
          const angle = arc.start + (s / segs) * arc.arc;
          const c = Math.cos(angle);
          const sn = Math.sin(angle);
          verts.push(c * innerR, y, sn * innerR, alpha);
          verts.push(c * outerR, y, sn * outerR, alpha);
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
    const decs = LAYER_DECORATIONS[li] || [];

    for (const d of decs) {
      const r = radii[d.ri];
      const alpha = layerAlpha;
      const innerR = r + thick / 2;
      const outerR = r + thick / 2 + d.width;
      const segs = Math.max(8, Math.ceil(d.arc * ARC_SEGS_PER_RAD));
      const base = verts.length / 4;

      for (let s = 0; s <= segs; s++) {
        const t = s / segs;
        const inA = d.start + t * d.arc;
        const outA = d.start + d.skew + t * d.arc;
        verts.push(Math.cos(inA) * innerR, y, Math.sin(inA) * innerR, alpha);
        verts.push(Math.cos(outA) * outerR, y, Math.sin(outA) * outerR, alpha);
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
      const innerR = r + thick / 2 + ARC_GAP;
      const outerR = innerR + thick;
      const startA = oa.start;
      const segs = Math.max(8, Math.ceil(oa.span * ARC_SEGS_PER_RAD));
      const base = verts.length / 4;

      for (let s = 0; s <= segs; s++) {
        const t = s / segs;
        const a = startA + t * oa.span;
        verts.push(Math.cos(a) * innerR, y, Math.sin(a) * innerR, layerAlpha);
        verts.push(Math.cos(a) * outerR, y, Math.sin(a) * outerR, layerAlpha);
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

  return {
    positions: new Float32Array(verts),
    indices: new Uint16Array(idxs),
  };
}

function generateGrid() {
  const e = GRID_EXTENT;
  const verts = [
    -e, 0,  e, 1.0,
     e, 0,  e, 1.0,
     e, 0, -e, 1.0,
    -e, 0, -e, 1.0,
  ];
  const idxs = [0, 1, 2, 0, 2, 3];
  return {
    positions: new Float32Array(verts),
    indices: new Uint16Array(idxs),
  };
}


function generateCenterShape(seed) {
  const verts = [];
  const idxs = [];
  let s = seed;
  const rand = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };

  const camLen = Math.sqrt(CAM_EYE[0] ** 2 + CAM_EYE[1] ** 2 + CAM_EYE[2] ** 2);
  const camDir = [CAM_EYE[0] / camLen, CAM_EYE[1] / camLen, CAM_EYE[2] / camLen];

  function cross(a, b) {
    return [a[1]*b[2] - a[2]*b[1], a[2]*b[0] - a[0]*b[2], a[0]*b[1] - a[1]*b[0]];
  }
  function vecNorm(v) {
    const l = Math.sqrt(v[0] ** 2 + v[1] ** 2 + v[2] ** 2);
    return l < 1e-6 ? [0, 1, 0] : [v[0] / l, v[1] / l, v[2] / l];
  }

  function addLine3D(ax, ay, az, bx, by, bz) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (len < 0.001) return;
    const dir = [dx / len, dy / len, dz / len];
    const perp = vecNorm(cross(dir, camDir));
    const hw = SHAPE_LINE_W / 2;
    const px = perp[0] * hw, py = perp[1] * hw, pz = perp[2] * hw;
    const base = verts.length / 4;
    verts.push(ax + px, ay + py, az + pz, 1.0);
    verts.push(ax - px, ay - py, az - pz, 1.0);
    verts.push(bx + px, by + py, bz + pz, 1.0);
    verts.push(bx - px, by - py, bz - pz, 1.0);
    idxs.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
  }

  const apexY = 3.0 + rand() * 1.0;
  const nadirY = -(0.3 + rand() * 0.5);

  const allRings = [];
  for (let ri = 0; ri < SHAPE_NUM_RINGS; ri++) {
    const t = (ri + 1) / (SHAPE_NUM_RINGS + 1);
    const y = nadirY + t * (apexY - nadirY);
    const taper = 1.0 - 2.0 * Math.abs(t - 0.5);
    const baseR = (0.5 + rand() * 0.5) * (0.5 + taper * 0.5);

    const q1 = [];
    for (let i = 0; i < SHAPE_PTS_PER_Q; i++) {
      const angle = ((i + 0.5) / SHAPE_PTS_PER_Q) * Math.PI / 2;
      const r = baseR * (0.6 + rand() * 0.8);
      q1.push([Math.cos(angle) * r, Math.sin(angle) * r]);
    }

    const ring = [];
    for (const [x, z] of q1) ring.push([x, y, z]);
    for (const [x, z] of [...q1].reverse()) ring.push([-x, y, z]);
    for (const [x, z] of q1) ring.push([-x, y, -z]);
    for (const [x, z] of [...q1].reverse()) ring.push([x, y, -z]);
    allRings.push(ring);
  }

  for (const ring of allRings) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      addLine3D(a[0], a[1], a[2], b[0], b[1], b[2]);
    }
  }

  for (let ri = 0; ri < allRings.length - 1; ri++) {
    const r0 = allRings[ri], r1 = allRings[ri + 1];
    for (let i = 0; i < r0.length; i++) {
      addLine3D(r0[i][0], r0[i][1], r0[i][2], r1[i][0], r1[i][1], r1[i][2]);
    }
  }

  const top = allRings[allRings.length - 1];
  const bot = allRings[0];
  for (const p of top) addLine3D(p[0], p[1], p[2], 0, apexY, 0);
  for (const p of bot) addLine3D(p[0], p[1], p[2], 0, nadirY, 0);

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

  let colorFBO = gpu.framebuffer(canvas.width, canvas.height, {
    format: RENDER_FORMAT, depth: true, samples: MSAA,
  });
  let depthFBO = gpu.framebuffer(canvas.width, canvas.height, {
    format: DEPTH_TEX_FORMAT, depth: true,
  });

  const rings = generateRings();
  const vertexBuffer = gpu.buffer(rings.positions, { vertex: true });
  const indexBuffer = gpu.buffer(rings.indices, { index: true });
  const indexCount = rings.indices.length;

  const grid = generateGrid();
  const gridVB = gpu.buffer(grid.positions, { vertex: true });
  const gridIB = gpu.buffer(grid.indices, { index: true });
  const gridIdxCount = grid.indices.length;

  const shape = generateCenterShape(SHAPE_SEED);
  const shapeVB = gpu.buffer(shape.positions, { vertex: true });
  const shapeIB = gpu.buffer(shape.indices, { index: true });
  const shapeIdxCount = shape.indices.length;

  const vertexLayout = [{
    arrayStride: 16,
    attributes: [
      { shaderLocation: 0, offset: 0, format: 'float32x3' },
      { shaderLocation: 1, offset: 12, format: 'float32' },
    ],
  }];

  const sceneData = new Float32Array(20);
  const sceneUBO = gpu.buffer(sceneData, { uniform: true });

  const dofData = new Float32Array(8);
  const dofUBO = gpu.buffer(dofData, { uniform: true });

  const focalDist = Math.sqrt(
    (CAM_EYE[0] - CAM_TARGET[0]) ** 2 +
    (CAM_EYE[1] - CAM_TARGET[1]) ** 2 +
    (CAM_EYE[2] - CAM_TARGET[2]) ** 2
  );

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

  const ringDepthPipe = gpu.pipeline({
    vertex: ringDepthWGSL,
    fragment: ringDepthWGSL,
    format: DEPTH_TEX_FORMAT,
    vertexBuffers: vertexLayout,
    depthTest: true,
    cullMode: 'none',
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

  const dofPipe = gpu.pipeline({
    vertex: gpu.FULLSCREEN_VERT,
    fragment: dofWGSL,
  });

  const colorBG = gpu.device.createBindGroup({
    layout: ringColorPipe.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: sceneUBO.buffer } }],
  });

  const depthBG = gpu.device.createBindGroup({
    layout: ringDepthPipe.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: sceneUBO.buffer } }],
  });

  const gridBG = gpu.device.createBindGroup({
    layout: gridColorPipe.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: sceneUBO.buffer } }],
  });

  const dofSampler = gpu.device.createSampler({
    magFilter: 'linear', minFilter: 'linear',
    addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge',
  });

  let dofBG;

  function updateUniforms(w, h) {
    const vp = buildViewProj(w / h);
    sceneData.set(vp, 0);
    sceneData[16] = CAM_EYE[0];
    sceneData[17] = CAM_EYE[1];
    sceneData[18] = CAM_EYE[2];
    sceneData[19] = FAR;
    sceneUBO.write(sceneData);

    dofData[0] = w;
    dofData[1] = h;
    dofData[2] = focalDist / FAR;
    dofData[3] = DOF_APERTURE;
    dofData[4] = DOF_MAX_BLUR;
    dofUBO.write(dofData);

    dofBG = gpu.device.createBindGroup({
      layout: dofPipe.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: dofSampler },
        { binding: 1, resource: colorFBO.view },
        { binding: 2, resource: depthFBO.view },
        { binding: 3, resource: { buffer: dofUBO.buffer } },
      ],
    });
  }

  function render() {
    gpu.frame(() => {
      gpu.pass({ target: depthFBO, clear: [1, 0, 0, 1] }, (p) => {
        p.setPipeline(ringDepthPipe);
        p.setBindGroup(0, depthBG);
        p.setVertexBuffer(0, gridVB.buffer);
        p.setIndexBuffer(gridIB.buffer, 'uint16');
        p.drawIndexed(gridIdxCount);
        p.setVertexBuffer(0, shapeVB.buffer);
        p.setIndexBuffer(shapeIB.buffer, 'uint16');
        p.drawIndexed(shapeIdxCount);
        p.setVertexBuffer(0, vertexBuffer.buffer);
        p.setIndexBuffer(indexBuffer.buffer, 'uint16');
        p.drawIndexed(indexCount);
      });

      gpu.pass({ target: colorFBO, clear: [0, 0, 0, 1] }, (p) => {
        p.setPipeline(gridColorPipe);
        p.setBindGroup(0, gridBG);
        p.setVertexBuffer(0, gridVB.buffer);
        p.setIndexBuffer(gridIB.buffer, 'uint16');
        p.drawIndexed(gridIdxCount);

        p.setPipeline(ringColorPipe);
        p.setBindGroup(0, colorBG);
        p.setVertexBuffer(0, shapeVB.buffer);
        p.setIndexBuffer(shapeIB.buffer, 'uint16');
        p.drawIndexed(shapeIdxCount);
        p.setVertexBuffer(0, vertexBuffer.buffer);
        p.setIndexBuffer(indexBuffer.buffer, 'uint16');
        p.drawIndexed(indexCount);
      });

      gpu.pass((p) => {
        p.setPipeline(dofPipe);
        p.setBindGroup(0, dofBG);
        p.draw(3);
      });
    });
  }

  let dirty = true;

  gpu.fitWindow((w, h) => {
    colorFBO.resize(w, h);
    depthFBO.resize(w, h);
    dirty = true;
  });

  const loop = () => {
    if (dirty) {
      updateUniforms(canvas.width, canvas.height);
      render();
      dirty = false;
    }
    fpsGraph.update();
    requestAnimationFrame(loop);
  };
  dirty = true;
  loop();
};
