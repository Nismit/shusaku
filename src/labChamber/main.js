import { chottoGPU } from 'chottogpu';
import { FPSGraph } from '../libs/FPSGraph.js';
import meshWGSL from './shaders/mesh.wgsl?raw';
import glassWGSL from './shaders/glass.wgsl?raw';
import interiorWGSL from './shaders/interior.wgsl?raw';
import blitWGSL from './shaders/blit.wgsl?raw';

const MSAA = 4;
const FRAME_SIZE = 2.3;
const FRAME_RADIUS = 0.055;
const CHAMBER_BASE_Y = 0.24;
const CHAMBER_HEIGHT = FRAME_SIZE;
const GLASS_THICKNESS = 0.018;
const GLASS_INSET = 0.012;
const WALL_POS = -3.0;
const CAMERA_POSITION = [6.0, 4.6, 6.0];
const CAMERA_TARGET = [0.0, CHAMBER_BASE_Y + CHAMBER_HEIGHT * 0.4, 0.0];
const INTERIOR_ENABLED = false;

const MATERIAL = {
  floor: 0,
  metal: 1,
  box: 2,
  wall: 3,
  trim: 4,
  light: 5,
  cable: 6,
};

function createCube() {
  const vertices = [];
  const indices = [];
  const faces = [
    { dir: [0, 0, 1], up: [0, 1, 0] },
    { dir: [0, 0, -1], up: [0, 1, 0] },
    { dir: [1, 0, 0], up: [0, 1, 0] },
    { dir: [-1, 0, 0], up: [0, 1, 0] },
    { dir: [0, 1, 0], up: [0, 0, -1] },
    { dir: [0, -1, 0], up: [0, 0, 1] },
  ];

  for (const { dir, up } of faces) {
    const [dx, dy, dz] = dir;
    const [ux, uy, uz] = up;
    const right = [uy * dz - uz * dy, uz * dx - ux * dz, ux * dy - uy * dx];
    const base = vertices.length / 6;
    for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      vertices.push(
        dx * 0.5 + right[0] * su * 0.5 + ux * sv * 0.5,
        dy * 0.5 + right[1] * su * 0.5 + uy * sv * 0.5,
        dz * 0.5 + right[2] * su * 0.5 + uz * sv * 0.5,
        dx, dy, dz,
      );
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  return { vertices: new Float32Array(vertices), indices: new Uint16Array(indices) };
}

function perspective(fov, aspect, near, far) {
  const f = 1 / Math.tan(fov * 0.5);
  const nf = 1 / (near - far);
  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, far * nf, -1,
    0, 0, near * far * nf, 0,
  ]);
}

function lookAt(eye, target, up) {
  let zx = eye[0] - target[0];
  let zy = eye[1] - target[1];
  let zz = eye[2] - target[2];
  let length = Math.hypot(zx, zy, zz);
  zx /= length; zy /= length; zz /= length;

  let xx = up[1] * zz - up[2] * zy;
  let xy = up[2] * zx - up[0] * zz;
  let xz = up[0] * zy - up[1] * zx;
  length = Math.hypot(xx, xy, xz);
  xx /= length; xy /= length; xz /= length;

  const yx = zy * xz - zz * xy;
  const yy = zz * xx - zx * xz;
  const yz = zx * xy - zy * xx;
  return new Float32Array([
    xx, yx, zx, 0,
    xy, yy, zy, 0,
    xz, yz, zz, 0,
    -(xx * eye[0] + xy * eye[1] + xz * eye[2]),
    -(yx * eye[0] + yy * eye[1] + yz * eye[2]),
    -(zx * eye[0] + zy * eye[1] + zz * eye[2]),
    1,
  ]);
}

function multiply(a, b) {
  const out = new Float32Array(16);
  for (let row = 0; row < 4; row++) {
    for (let column = 0; column < 4; column++) {
      out[column * 4 + row] =
        a[row] * b[column * 4] +
        a[4 + row] * b[column * 4 + 1] +
        a[8 + row] * b[column * 4 + 2] +
        a[12 + row] * b[column * 4 + 3];
    }
  }
  return out;
}

function quatFromY(direction) {
  const length = Math.hypot(...direction);
  const x = direction[0] / length;
  const y = direction[1] / length;
  const z = direction[2] / length;
  if (y < -0.9999) return [1, 0, 0, 0];
  const q = [z, 0, -x, 1 + y];
  const qLength = Math.hypot(...q);
  return q.map((value) => value / qLength);
}

function pushBox(target, center, halfSize, material, rotation = [0, 0, 0, 1]) {
  target.push(
    center[0], center[1], center[2], material,
    halfSize[0], halfSize[1], halfSize[2], 0,
    rotation[0], rotation[1], rotation[2], rotation[3],
  );
}

function pushSegment(target, start, end, radius, material) {
  const direction = [end[0] - start[0], end[1] - start[1], end[2] - start[2]];
  const center = [(start[0] + end[0]) * 0.5, (start[1] + end[1]) * 0.5, (start[2] + end[2]) * 0.5];
  pushBox(target, center, [radius, Math.hypot(...direction) * 0.5, radius], material, quatFromY(direction));
}

function createOpaqueInstances() {
  const data = [];
  const h = FRAME_SIZE * 0.5;
  const off = h - FRAME_RADIUS;
  const centerY = CHAMBER_BASE_Y + CHAMBER_HEIGHT * 0.5;
  const bottomY = CHAMBER_BASE_Y + FRAME_RADIUS;
  const topY = CHAMBER_BASE_Y + CHAMBER_HEIGHT - FRAME_RADIUS;

  pushBox(data, [0, -0.025, 0], [1.8, 0.025, 1.8], MATERIAL.floor);
  pushBox(data, [0, 0.06, 0], [1.45, 0.06, 1.45], MATERIAL.metal);
  pushBox(data, [0, 0.18, 0], [1.3, 0.06, 1.3], MATERIAL.metal);

  for (const x of [-off, off]) {
    for (const z of [-off, off]) {
      pushBox(data, [x, centerY, z], [FRAME_RADIUS, CHAMBER_HEIGHT * 0.5, FRAME_RADIUS], MATERIAL.metal);
    }
  }
  for (const y of [bottomY, topY]) {
    for (const z of [-off, off]) pushBox(data, [0, y, z], [h, FRAME_RADIUS, FRAME_RADIUS], MATERIAL.metal);
    for (const x of [-off, off]) pushBox(data, [x, y, 0], [FRAME_RADIUS, FRAME_RADIUS, h], MATERIAL.metal);
  }

  const ceilingY = CHAMBER_BASE_Y + CHAMBER_HEIGHT + 0.06;
  pushBox(data, [0, ceilingY, 0], [h, 0.06, h], MATERIAL.metal);
  for (const x of [-0.5, 0.5]) {
    for (const z of [-0.5, 0.5]) {
      pushBox(data, [x, ceilingY - 0.065, z], [0.35, 0.02, 0.35], MATERIAL.light);
    }
  }

  pushBox(data, [0, 1.8, WALL_POS], [4.5, 1.8, 0.06], MATERIAL.wall);
  pushBox(data, [WALL_POS, 1.8, 0], [0.06, 1.8, 4.5], MATERIAL.wall);
  const backZ = WALL_POS + 0.075;
  const sideX = WALL_POS + 0.075;
  for (const x of [-1.5, 0, 1.5]) pushBox(data, [x, 1.8, backZ], [0.012, 1.8, 0.015], MATERIAL.trim);
  for (const z of [-1.5, 0, 1.5]) pushBox(data, [sideX, 1.8, z], [0.015, 1.8, 0.012], MATERIAL.trim);
  for (const y of [1.2, 2.4]) {
    pushBox(data, [0, y, backZ], [4.5, 0.012, 0.015], MATERIAL.trim);
    pushBox(data, [sideX, y, 0], [0.015, 0.012, 4.5], MATERIAL.trim);
  }
  for (const x of [-1.25, 1.25]) pushBox(data, [x, 3.0, WALL_POS + 0.09], [0.72, 0.045, 0.02], MATERIAL.light);
  for (const z of [-1.25, 1.25]) pushBox(data, [WALL_POS + 0.09, 3.0, z], [0.02, 0.045, 0.72], MATERIAL.light);

  pushBox(data, [1.375, 0.32, 0.6], [0.25, 0.2, 0.15], MATERIAL.box);
  const bx = 1.375;
  const cableY = 0.025;
  pushSegment(data, [bx, 0.16, 0.52], [bx + 0.3, cableY, 0.4], 0.025, MATERIAL.cable);
  pushSegment(data, [bx + 0.3, cableY, 0.4], [bx + 1.2, cableY, 0.0], 0.025, MATERIAL.cable);
  pushSegment(data, [bx, 0.16, 0.6], [bx + 0.4, cableY, 0.7], 0.025, MATERIAL.cable);
  pushSegment(data, [bx + 0.4, cableY, 0.7], [bx + 1.5, cableY, 0.9], 0.025, MATERIAL.cable);
  pushSegment(data, [bx, 0.16, 0.68], [bx + 0.2, cableY, 1.0], 0.025, MATERIAL.cable);
  pushSegment(data, [bx + 0.2, cableY, 1.0], [bx + 1.0, cableY, 1.6], 0.025, MATERIAL.cable);

  return new Float32Array(data);
}

function createGlassInstances() {
  const data = [];
  const h = FRAME_SIZE * 0.5;
  const opening = h - FRAME_RADIUS * 2.0;
  const paneCenter = opening - GLASS_INSET - GLASS_THICKNESS;
  const paneHalf = h - FRAME_RADIUS;
  const centerY = CHAMBER_BASE_Y + CHAMBER_HEIGHT * 0.5;

  // Far panes first, then near panes, for stable alpha blending.
  pushBox(data, [0, centerY, -paneCenter], [paneHalf, paneHalf, GLASS_THICKNESS], 0);
  pushBox(data, [-paneCenter, centerY, 0], [GLASS_THICKNESS, paneHalf, paneHalf], 0);
  pushBox(data, [0, centerY, paneCenter], [paneHalf, paneHalf, GLASS_THICKNESS], 1);
  pushBox(data, [paneCenter, centerY, 0], [GLASS_THICKNESS, paneHalf, paneHalf], 1);
  return new Float32Array(data);
}

function createInteriorInstance() {
  const half = FRAME_SIZE * 0.5 - FRAME_RADIUS * 2.0;
  const centerY = CHAMBER_BASE_Y + CHAMBER_HEIGHT * 0.5;
  const data = [];
  pushBox(data, [0, centerY, 0], [half, half, half], 0);
  return new Float32Array(data);
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
  const cube = createCube();
  const vertexBuffer = gpu.buffer(cube.vertices, { vertex: true });
  const indexBuffer = gpu.buffer(cube.indices, { index: true });
  const opaqueInstances = createOpaqueInstances();
  const glassInstances = createGlassInstances();
  const interiorInstances = createInteriorInstance();
  const opaqueBuffer = gpu.buffer(opaqueInstances, { storage: true });
  const glassBuffer = gpu.buffer(glassInstances, { storage: true });
  const interiorBuffer = gpu.buffer(interiorInstances, { storage: true });
  const sceneData = new Float32Array(24);
  const sceneBuffer = gpu.buffer(sceneData, { uniform: true });

  const vertexBuffers = [{
    arrayStride: 24,
    attributes: [
      { shaderLocation: 0, offset: 0, format: 'float32x3' },
      { shaderLocation: 1, offset: 12, format: 'float32x3' },
    ],
  }];
  const blend = {
    color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
    alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
  };

  const meshPipe = gpu.pipeline({
    vertex: meshWGSL,
    fragment: meshWGSL,
    vertexBuffers,
    depthTest: true,
    cullMode: 'back',
    samples: MSAA,
  });
  const glassPipe = gpu.pipeline({
    vertex: glassWGSL,
    fragment: glassWGSL,
    vertexBuffers,
    depthTest: true,
    depthWrite: false,
    cullMode: 'back',
    samples: MSAA,
    blend,
  });
  const interiorPipe = gpu.pipeline({
    vertex: interiorWGSL,
    fragment: interiorWGSL,
    vertexBuffers,
    depthTest: true,
    depthWrite: false,
    cullMode: 'front',
    samples: MSAA,
    blend,
  });
  const blitPipe = gpu.pipeline({ vertex: gpu.FULLSCREEN_VERT, fragment: blitWGSL });

  const makeSceneBindGroup = (pipeline, instanceBuffer) => gpu.device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: sceneBuffer.buffer } },
      { binding: 1, resource: { buffer: instanceBuffer.buffer } },
    ],
  });
  const meshBG = makeSceneBindGroup(meshPipe, opaqueBuffer);
  const glassBG = makeSceneBindGroup(glassPipe, glassBuffer);
  const interiorBG = makeSceneBindGroup(interiorPipe, interiorBuffer);

  let sceneTarget = gpu.framebuffer(canvas.width, canvas.height, { depth: true, samples: MSAA });
  let blitBG;
  const rebuildBlitBindGroup = () => {
    blitBG = gpu.device.createBindGroup({
      layout: blitPipe.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: gpu.sampler },
        { binding: 1, resource: sceneTarget.view },
      ],
    });
  };
  rebuildBlitBindGroup();
  gpu.fitWindow((width, height) => {
    sceneTarget.resize(width, height);
    rebuildBlitBindGroup();
  });

  const render = () => {
    const aspect = canvas.width / canvas.height;
    const fov = 2 * Math.atan(0.5 / 1.8);
    const viewProj = multiply(
      perspective(fov, aspect, 0.1, 40),
      lookAt(CAMERA_POSITION, CAMERA_TARGET, [0, 1, 0]),
    );
    sceneData.set(viewProj, 0);
    sceneData.set(CAMERA_POSITION, 16);
    sceneData[19] = 0.42;
    sceneData.set([0.38, 0.86, 0.42], 20);
    sceneData[23] = 0;
    sceneBuffer.write(sceneData);

    gpu.frame(() => {
      gpu.pass({ target: sceneTarget, clear: [0.65, 0.68, 0.71, 1] }, (pass) => {
        pass.setPipeline(meshPipe);
        pass.setBindGroup(0, meshBG);
        pass.setVertexBuffer(0, vertexBuffer.buffer);
        pass.setIndexBuffer(indexBuffer.buffer, 'uint16');
        pass.drawIndexed(cube.indices.length, opaqueInstances.length / 12);

        if (INTERIOR_ENABLED) {
          pass.setPipeline(interiorPipe);
          pass.setBindGroup(0, interiorBG);
          pass.drawIndexed(cube.indices.length, 1);
        }

        pass.setPipeline(glassPipe);
        pass.setBindGroup(0, glassBG);
        pass.drawIndexed(cube.indices.length, glassInstances.length / 12);
      });

      gpu.pass((pass) => {
        pass.setPipeline(blitPipe);
        pass.setBindGroup(0, blitBG);
        pass.draw(3);
      });
    });

    fpsGraph.update();
    requestAnimationFrame(render);
  };

  render();
};
