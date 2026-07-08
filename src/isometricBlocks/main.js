import { chottoGPU } from 'chottogpu';
import { Timer } from '../libs/Timer.js';
import cubeWGSL from './shaders/cube.wgsl?raw';
import shadowWGSL from './shaders/shadow.wgsl?raw';
import groundWGSL from './shaders/ground.wgsl?raw';
import borderWGSL from './shaders/border.wgsl?raw';
import screenWGSL from './shaders/screen.wgsl?raw';

const GRID_SIZES = [6, 9, 12];
const HOLD_DURATION = 1.8;
const RISE_DURATION = 0.5;
const COLLAPSE_DURATION = 0.5;
const MAX_CUBES = 288;
const SHADOW_MAP_SIZE = 1024;
const RENDER_FORMAT = 'rgba16float';
const MSAA = 4;
const MIN_HEIGHT = 0.3;
const MAX_HEIGHT = 3.0;
const CAMERA_PADDING = 2.0;
const FIXED_GRID_SIZE = 6;
const LIGHT_DIR = [1, 2, 1];
const BORDER_THICKNESS = 0.1;
const BORDER_HEIGHT = 0.15;

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

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

function ortho(left, right, bottom, top, near, far) {
  const out = new Float32Array(16);
  out.fill(0);
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

function buildCameraVP(extent, aspect) {
  const half = extent / 2 + CAMERA_PADDING;
  const eye = [10, 14, 10];
  const view = lookAt(eye, [0, 0, 0], [0, 1, 0]);
  const hx = half * aspect;
  const proj = ortho(-hx, hx, -half, half, 0.1, 40);
  return mat4Mul(proj, view);
}

function buildLightVP(extent) {
  const lx = LIGHT_DIR[0], ly = LIGHT_DIR[1], lz = LIGHT_DIR[2];
  const len = Math.sqrt(lx * lx + ly * ly + lz * lz);
  const nx = lx / len, ny = ly / len, nz = lz / len;
  const dist = extent * 3.0;
  const eye = [nx * dist, ny * dist, nz * dist];
  const upCandidate = Math.abs(ny) < 0.99 ? [0, 1, 0] : [1, 0, 0];
  const view = lookAt(eye, [0, 0, 0], upCandidate);
  const proj = ortho(-extent, extent, -extent, extent, 0.01, dist * 2.0);
  return mat4Mul(proj, view);
}

function createCube() {
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];
  const faces = [
    { dir: [ 0,  0,  1], up: [0, 1, 0] },
    { dir: [ 0,  0, -1], up: [0, 1, 0] },
    { dir: [ 1,  0,  0], up: [0, 1, 0] },
    { dir: [-1,  0,  0], up: [0, 1, 0] },
    { dir: [ 0,  1,  0], up: [0, 0,-1] },
    { dir: [ 0, -1,  0], up: [0, 0, 1] },
  ];
  const cornerUVs = [[0, 0], [1, 0], [1, 1], [0, 1]];
  for (const face of faces) {
    const [dx, dy, dz] = face.dir;
    const [ux, uy, uz] = face.up;
    const rx = uy * dz - uz * dy, ry = uz * dx - ux * dz, rz = ux * dy - uy * dx;
    const baseIndex = positions.length / 3;
    for (let i = 0; i < 4; i++) {
      const [su, sv] = [[-1, -1], [1, -1], [1, 1], [-1, 1]][i];
      positions.push(
        dx * 0.5 + rx * su * 0.5 + ux * sv * 0.5,
        dy * 0.5 + ry * su * 0.5 + uy * sv * 0.5 + 0.5,
        dz * 0.5 + rz * su * 0.5 + uz * sv * 0.5
      );
      normals.push(dx, dy, dz);
      uvs.push(cornerUVs[i][0], cornerUVs[i][1]);
    }
    indices.push(baseIndex, baseIndex + 1, baseIndex + 2, baseIndex, baseIndex + 2, baseIndex + 3);
  }
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    uvs: new Float32Array(uvs),
    indices: new Uint16Array(indices),
  };
}

function generateGrid(size) {
  const cubes = [];
  const half = (size - 1) / 2;
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      const r = Math.random();
      let color;
      if (r < 0.50) color = 0;
      else if (r < 0.67) color = 1;
      else if (r < 0.84) color = 2;
      else color = 3;
      cubes.push({
        x: col - half,
        z: row - half,
        height: MIN_HEIGHT + Math.random() * (MAX_HEIGHT - MIN_HEIGHT),
        color,
      });
    }
  }
  return cubes;
}

const borderShadowWGSL = `
struct ShadowUniforms { lightViewProj: mat4x4f, gridScale: f32, colorMix: f32 };
@group(0) @binding(0) var<uniform> u: ShadowUniforms;
struct VOut { @builtin(position) position: vec4f, @location(0) depth: f32 };
@vertex fn vs(@location(0) pos: vec3f, @location(1) norm: vec3f) -> VOut {
  let clip = u.lightViewProj * vec4f(pos, 1.0);
  var out: VOut; out.position = clip; out.depth = clip.z / clip.w; return out;
}
@fragment fn fs(v: VOut) -> @location(0) vec4f { return vec4f(v.depth, 0.0, 0.0, 1.0); }
`;

function createBorderGeometry() {
  const half = FIXED_GRID_SIZE / 2;
  const t = BORDER_THICKNESS;
  const h = BORDER_HEIGHT;
  const verts = [];
  const indices = [];

  function vert(px, py, pz, nx, ny, nz) {
    verts.push(px, py, pz, nx, ny, nz);
  }

  function box(x0, z0, x1, z1) {
    const base = verts.length / 6;
    vert(x0,h,z1, 0,1,0); vert(x1,h,z1, 0,1,0);
    vert(x1,h,z0, 0,1,0); vert(x0,h,z0, 0,1,0);
    vert(x0,0,z1, 0,0,1); vert(x1,0,z1, 0,0,1);
    vert(x1,h,z1, 0,0,1); vert(x0,h,z1, 0,0,1);
    vert(x1,0,z0, 0,0,-1); vert(x0,0,z0, 0,0,-1);
    vert(x0,h,z0, 0,0,-1); vert(x1,h,z0, 0,0,-1);
    vert(x1,0,z1, 1,0,0); vert(x1,0,z0, 1,0,0);
    vert(x1,h,z0, 1,0,0); vert(x1,h,z1, 1,0,0);
    vert(x0,0,z0, -1,0,0); vert(x0,0,z1, -1,0,0);
    vert(x0,h,z1, -1,0,0); vert(x0,h,z0, -1,0,0);
    for (let f = 0; f < 5; f++) {
      const i = base + f * 4;
      indices.push(i, i + 1, i + 2, i, i + 2, i + 3);
    }
  }

  box(-(half + t), half, half + t, half + t);
  box(-(half + t), -(half + t), half + t, -half);
  box(half, -half, half + t, half);
  box(-(half + t), -half, -half, half);

  return {
    vertices: new Float32Array(verts),
    indices: new Uint16Array(indices),
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
  const gpu = await chottoGPU(canvas);

  let renderFBO = gpu.framebuffer(canvas.width, canvas.height, {
    format: RENDER_FORMAT, depth: true, samples: MSAA,
  });
  const shadowFBO = gpu.framebuffer(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE, {
    format: RENDER_FORMAT, depth: true,
  });

  gpu.fitWindow((w, h) => { renderFBO.resize(w, h); });

  const cube = createCube();
  const vertexCount = cube.positions.length / 3;
  const interleaved = new Float32Array(vertexCount * 8);
  for (let i = 0; i < vertexCount; i++) {
    interleaved[i * 8 + 0] = cube.positions[i * 3 + 0];
    interleaved[i * 8 + 1] = cube.positions[i * 3 + 1];
    interleaved[i * 8 + 2] = cube.positions[i * 3 + 2];
    interleaved[i * 8 + 3] = cube.normals[i * 3 + 0];
    interleaved[i * 8 + 4] = cube.normals[i * 3 + 1];
    interleaved[i * 8 + 5] = cube.normals[i * 3 + 2];
    interleaved[i * 8 + 6] = cube.uvs[i * 2 + 0];
    interleaved[i * 8 + 7] = cube.uvs[i * 2 + 1];
  }
  const vertexBuffer = gpu.buffer(interleaved, { vertex: true });
  const indexBuffer = gpu.buffer(cube.indices, { index: true });

  const groundVerts = new Float32Array([
    -1, 0, -1,   1, 0, -1,   1, 0, 1,
    -1, 0, -1,   1, 0, 1,  -1, 0, 1,
  ]);
  const groundBuffer = gpu.buffer(groundVerts, { vertex: true });

  const border = createBorderGeometry();
  const borderVertexBuffer = gpu.buffer(border.vertices, { vertex: true });
  const borderIndexBuffer = gpu.buffer(border.indices, { index: true });

  const instanceData = new Float32Array(MAX_CUBES * 5);
  const instanceBuffer = gpu.buffer(instanceData, { storage: true });

  const sceneData = new Float32Array(44);
  const sceneUBO = gpu.buffer(sceneData, { uniform: true });

  const shadowData = new Float32Array(20);
  const shadowUBO = gpu.buffer(shadowData, { uniform: true });

  const cubeVertexBuffers = [{
    arrayStride: 32,
    attributes: [
      { shaderLocation: 0, offset: 0, format: 'float32x3' },
      { shaderLocation: 1, offset: 12, format: 'float32x3' },
      { shaderLocation: 2, offset: 24, format: 'float32x2' },
    ],
  }];

  const borderVertexBuffers = [{
    arrayStride: 24,
    attributes: [
      { shaderLocation: 0, offset: 0, format: 'float32x3' },
      { shaderLocation: 1, offset: 12, format: 'float32x3' },
    ],
  }];

  const shadowPipe = gpu.pipeline({
    vertex: shadowWGSL,
    fragment: shadowWGSL,
    format: RENDER_FORMAT,
    vertexBuffers: cubeVertexBuffers,
    depthTest: true,
    cullMode: 'back',
  });

  const cubePipe = gpu.pipeline({
    vertex: cubeWGSL,
    fragment: cubeWGSL,
    format: RENDER_FORMAT,
    vertexBuffers: cubeVertexBuffers,
    depthTest: true,
    cullMode: 'back',
    samples: MSAA,
  });

  const groundPipe = gpu.pipeline({
    vertex: groundWGSL,
    fragment: groundWGSL,
    format: RENDER_FORMAT,
    vertexBuffers: [{
      arrayStride: 12,
      attributes: [
        { shaderLocation: 0, offset: 0, format: 'float32x3' },
      ],
    }],
    depthTest: true,
    cullMode: 'none',
    samples: MSAA,
    depthCompare: 'less-equal',
  });

  const borderPipe = gpu.pipeline({
    vertex: borderWGSL,
    fragment: borderWGSL,
    format: RENDER_FORMAT,
    vertexBuffers: borderVertexBuffers,
    depthTest: true,
    cullMode: 'back',
    samples: MSAA,
    depthCompare: 'less-equal',
  });

  const borderShadowPipe = gpu.pipeline({
    vertex: borderShadowWGSL,
    fragment: borderShadowWGSL,
    format: RENDER_FORMAT,
    vertexBuffers: borderVertexBuffers,
    depthTest: true,
    cullMode: 'back',
  });

  const screenPipe = gpu.pipeline({ vertex: gpu.FULLSCREEN_VERT, fragment: screenWGSL });

  const shadowBG = gpu.device.createBindGroup({
    layout: shadowPipe.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: shadowUBO.buffer } },
      { binding: 1, resource: { buffer: instanceBuffer.buffer } },
    ],
  });

  const shadowSampler = gpu.device.createSampler({
    magFilter: 'linear',
    minFilter: 'linear',
    addressModeU: 'clamp-to-edge',
    addressModeV: 'clamp-to-edge',
  });

  const cubeBG = gpu.device.createBindGroup({
    layout: cubePipe.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: sceneUBO.buffer } },
      { binding: 1, resource: { buffer: instanceBuffer.buffer } },
      { binding: 2, resource: shadowSampler },
      { binding: 3, resource: shadowFBO.view },
    ],
  });

  const groundBG = gpu.device.createBindGroup({
    layout: groundPipe.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: sceneUBO.buffer } },
      { binding: 1, resource: shadowSampler },
      { binding: 2, resource: shadowFBO.view },
    ],
  });

  const borderBG = gpu.device.createBindGroup({
    layout: borderPipe.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: sceneUBO.buffer } },
      { binding: 1, resource: shadowSampler },
      { binding: 2, resource: shadowFBO.view },
    ],
  });

  const borderShadowBG = gpu.device.createBindGroup({
    layout: borderShadowPipe.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: shadowUBO.buffer } },
    ],
  });

  const blitLayout = screenPipe.getBindGroupLayout(0);

  let gridIndex = 0;
  let grid = generateGrid(GRID_SIZES[gridIndex]);
  let phase = 'rise';
  let phaseTimer = 0;
  let activeCount = grid.length;

  const timer = new Timer();
  timer.start();
  let lastTime = 0;

  const render = () => {
    const elapsed = timer.getElapsedTime();
    const dt = Math.min(elapsed - lastTime, 0.05);
    lastTime = elapsed;

    phaseTimer += dt;

    if (phase === 'rise' && phaseTimer >= RISE_DURATION) {
      phase = 'hold';
      phaseTimer = 0;
    } else if (phase === 'hold' && phaseTimer >= HOLD_DURATION) {
      phase = 'collapse';
      phaseTimer = 0;
    } else if (phase === 'collapse' && phaseTimer >= COLLAPSE_DURATION) {
      gridIndex = (gridIndex + 1) % GRID_SIZES.length;
      grid = generateGrid(GRID_SIZES[gridIndex]);
      phase = 'rise';
      phaseTimer = 0;
    }

    const cellScale = FIXED_GRID_SIZE / GRID_SIZES[gridIndex];
    let heightMul;
    if (phase === 'rise') {
      heightMul = easeInOutCubic(Math.min(phaseTimer / RISE_DURATION, 1));
    } else if (phase === 'hold') {
      heightMul = 1;
    } else {
      heightMul = 1 - easeInOutCubic(Math.min(phaseTimer / COLLAPSE_DURATION, 1));
    }

    let idx = 0;
    for (const c of grid) {
      instanceData[idx++] = c.x;
      instanceData[idx++] = c.z;
      instanceData[idx++] = c.height * heightMul;
      instanceData[idx++] = c.color;
      instanceData[idx++] = cellScale;
    }
    activeCount = grid.length;
    instanceBuffer.write(instanceData);

    const aspect = canvas.width / canvas.height;
    const cameraVP = buildCameraVP(FIXED_GRID_SIZE, aspect);
    const lightVP = buildLightVP(FIXED_GRID_SIZE + 4);

    const lLen = Math.sqrt(LIGHT_DIR[0] ** 2 + LIGHT_DIR[1] ** 2 + LIGHT_DIR[2] ** 2);

    sceneData.set(cameraVP, 0);
    sceneData.set(lightVP, 16);
    sceneData[32] = LIGHT_DIR[0] / lLen;
    sceneData[33] = LIGHT_DIR[1] / lLen;
    sceneData[34] = LIGHT_DIR[2] / lLen;
    sceneData[35] = 0.35;
    sceneData[36] = SHADOW_MAP_SIZE;
    sceneData[37] = 2.5;
    sceneData[38] = elapsed;
    sceneData[39] = FIXED_GRID_SIZE / 2 + CAMERA_PADDING + 2;
    sceneData[40] = cellScale;
    sceneData[41] = 1 - heightMul;
    sceneUBO.write(sceneData);

    shadowData.set(lightVP, 0);
    shadowData[16] = cellScale;
    shadowData[17] = 1 - heightMul;
    shadowUBO.write(shadowData);

    gpu.frame(() => {
      gpu.pass({ target: shadowFBO, clear: [1, 1, 1, 1] }, (p) => {
        p.setPipeline(shadowPipe);
        p.setBindGroup(0, shadowBG);
        p.setVertexBuffer(0, vertexBuffer.buffer);
        p.setIndexBuffer(indexBuffer.buffer, 'uint16');
        p.drawIndexed(cube.indices.length, activeCount);

        p.setPipeline(borderShadowPipe);
        p.setBindGroup(0, borderShadowBG);
        p.setVertexBuffer(0, borderVertexBuffer.buffer);
        p.setIndexBuffer(borderIndexBuffer.buffer, 'uint16');
        p.drawIndexed(border.indices.length);
      });

      gpu.pass({ target: renderFBO, clear: [0.82, 0.80, 0.76, 1] }, (p) => {
        p.setPipeline(groundPipe);
        p.setBindGroup(0, groundBG);
        p.setVertexBuffer(0, groundBuffer.buffer);
        p.draw(6);

        p.setPipeline(borderPipe);
        p.setBindGroup(0, borderBG);
        p.setVertexBuffer(0, borderVertexBuffer.buffer);
        p.setIndexBuffer(borderIndexBuffer.buffer, 'uint16');
        p.drawIndexed(border.indices.length);

        p.setPipeline(cubePipe);
        p.setBindGroup(0, cubeBG);
        p.setVertexBuffer(0, vertexBuffer.buffer);
        p.setIndexBuffer(indexBuffer.buffer, 'uint16');
        p.drawIndexed(cube.indices.length, activeCount);
      });

      gpu.pass((p) => {
        p.setPipeline(screenPipe);
        p.setBindGroup(0, gpu.device.createBindGroup({
          layout: blitLayout,
          entries: [
            { binding: 0, resource: gpu.sampler },
            { binding: 1, resource: renderFBO.view },
          ],
        }));
        p.draw(3);
      });
    });

    requestAnimationFrame(render);
  };

  render();
};
