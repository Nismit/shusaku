import { chottoGPU } from 'chottogpu';
import { Timer } from '../libs/Timer.js';
import { FPSGraph } from '../libs/FPSGraph.js';
import GUI from '../libs/gui.js';

import { EDGE_TABLE, TRI_TABLE } from './tables.js';

import fieldWGSL from './shaders/field.wgsl?raw';
import marchWGSL from './shaders/march.wgsl?raw';
import meshWGSL from './shaders/mesh.wgsl?raw';
import bgWGSL from './shaders/bg.wgsl?raw';
import screenWGSL from './shaders/screen.wgsl?raw';
import thresholdWGSL from './shaders/threshold.wgsl?raw';
import blurWGSL from './shaders/blur.wgsl?raw';
import composeWGSL from './shaders/compose.wgsl?raw';

const GRID_SIZE = 64;
const GRID_VERTS = GRID_SIZE + 1;
const FIELD_COUNT = GRID_VERTS * GRID_VERTS * GRID_VERTS;
const CELL_COUNT = GRID_SIZE * GRID_SIZE * GRID_SIZE;
const MAX_VERTICES = 400000;
const WORKGROUP_SIZE = 64;
const NUM_BALLS = 12;
const MAX_BALLS = 16;
const RENDER_FORMAT = 'rgba16float';
const MAX_BLOOM_ITERATIONS = 8;

const ua = navigator.userAgent;
const IS_MOBILE = /Android|iPhone|iPod/i.test(ua) || (/iPad|Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
const MSAA = IS_MOBILE ? 1 : 4;

const hexToRGB = (hex) => [
  parseInt(hex.slice(1, 3), 16) / 255,
  parseInt(hex.slice(3, 5), 16) / 255,
  parseInt(hex.slice(5, 7), 16) / 255,
];

export const main = async () => {
  const canvas = document.createElement('canvas');
  canvas.style.width = '100vw';
  canvas.style.height = '100vh';
  document.body.appendChild(canvas);

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.floor(window.innerWidth * dpr);
  canvas.height = Math.floor(window.innerHeight * dpr);

  const chotto = await chottoGPU(canvas);
  const { device } = chotto;

  const params = {
    threshold: 1.0,
    rotationX: 0.3,
    rotationY: 0.0,
    zoom: 5.5,
    autoRotate: true,
    autoRotateSpeed: 0.15,
    lightVertical: 0.8,
    lightHorizontal: -1.2,
    baseColor: '#c87830',
    specColor: '#ffffff',
    fresnelColor: '#5080d0',
    lightColor: '#ffffff',
    ambient: 0.12,
    shininess: 80.0,
    fresnelPower: 3.0,
    exposure: 1.2,
    bgTop: '#0a0e1a',
    bgBottom: '#06080f',
    orbitSpeed: 1.4,
    ballRadius: 0.35,
    bloomEnabled: true,
    bloomThreshold: 0.5,
    bloomStrength: 0.6,
    bloomIterations: 5,
    toneMapping: 1.0,
  };

  // --- Compute buffers ---
  const fieldBuffer = chotto.buffer(FIELD_COUNT * 4, { storage: true });
  const edgeTableBuffer = chotto.buffer(EDGE_TABLE, { storage: true });
  const triTableBuffer = chotto.buffer(TRI_TABLE, { storage: true });
  const vertexBuffer = chotto.buffer(MAX_VERTICES * 6 * 4, { storage: true });
  const indirectBuffer = chotto.buffer(16, { storage: true, usage: GPUBufferUsage.INDIRECT });
  const ballBuffer = chotto.buffer(MAX_BALLS * 16, { storage: true });

  // --- Uniform buffers ---
  // field params: { gridSize: u32, numBalls: u32, _pad x2 } = 16 bytes
  const fieldUBO = chotto.buffer(16, { uniform: true });
  const fieldAB = new ArrayBuffer(16);
  const fieldU32 = new Uint32Array(fieldAB);
  const fieldF32 = new Float32Array(fieldAB);

  // march params: { gridSize: u32, numBalls: u32, maxVertices: u32, threshold: f32 } = 16 bytes
  const marchUBO = chotto.buffer(16, { uniform: true });
  const marchAB = new ArrayBuffer(16);
  const marchU32 = new Uint32Array(marchAB);
  const marchF32 = new Float32Array(marchAB);

  // camera: { resolution: vec2f, rotation: vec2f, zoom: f32, _pad x3, lightDir: vec3f, _pad } = 48 bytes
  const cameraUBO = chotto.buffer(48, { uniform: true });
  const cameraData = new Float32Array(12);

  // material: { baseColor: vec3f, ambient, specColor: vec3f, shininess, fresnelColor: vec3f, fresnelPower, lightColor: vec3f, exposure } = 64 bytes
  const materialUBO = chotto.buffer(64, { uniform: true });
  const matData = new Float32Array(16);

  // bg: { top: vec3f, _pad, bottom: vec3f, _pad } = 32 bytes
  const bgUBO = chotto.buffer(32, { uniform: true });
  const bgData = new Float32Array(8);

  // screen: { toneMapping: f32 } = 16 bytes
  const screenUBO = chotto.buffer(16, { uniform: true });
  const screenData = new Float32Array(4);

  // threshold: { threshold: f32 } = 16 bytes
  const thresholdUBO = chotto.buffer(16, { uniform: true });
  const threshData = new Float32Array(4);

  // blur: { texelSize: vec2f, iteration: f32, _pad } = 16 bytes
  const blurUBOs = Array.from({ length: MAX_BLOOM_ITERATIONS }, () => chotto.buffer(16, { uniform: true }));
  const blurData = new Float32Array(4);

  // compose: { strength: f32, toneMapping: f32 } = 16 bytes
  const composeUBO = chotto.buffer(16, { uniform: true });
  const composeData = new Float32Array(4);

  // --- Render targets ---
  const renderFBO = chotto.framebuffer(canvas.width, canvas.height, { format: RENDER_FORMAT, depth: true, samples: MSAA });
  const brightFBO = chotto.framebuffer(canvas.width >> 1, canvas.height >> 1, { format: RENDER_FORMAT });
  const blurPing = chotto.framebuffer(canvas.width >> 1, canvas.height >> 1, { format: RENDER_FORMAT });
  const blurPong = chotto.framebuffer(canvas.width >> 1, canvas.height >> 1, { format: RENDER_FORMAT });

  // --- Pipelines ---
  const fieldPipeline = chotto.compute({ shader: fieldWGSL });
  const marchPipeline = chotto.compute({ shader: marchWGSL });

  const bgPipeline = chotto.pipeline({
    vertex: bgWGSL, fragment: bgWGSL,
    format: RENDER_FORMAT, samples: MSAA,
    depthTest: true, depthWrite: false, depthCompare: 'always',
  });

  const meshPipeline = chotto.pipeline({
    vertex: meshWGSL, fragment: meshWGSL,
    format: RENDER_FORMAT, topology: 'triangle-list',
    depthTest: true, samples: MSAA,
  });

  const thresholdPipeline = chotto.pipeline({ vertex: thresholdWGSL, fragment: thresholdWGSL, format: RENDER_FORMAT });
  const blurPipeline = chotto.pipeline({ vertex: blurWGSL, fragment: blurWGSL, format: RENDER_FORMAT });
  const composePipeline = chotto.pipeline({ vertex: composeWGSL, fragment: composeWGSL });
  const screenPipeline = chotto.pipeline({ vertex: screenWGSL, fragment: screenWGSL });

  const fieldWorkgroups = Math.ceil(FIELD_COUNT / WORKGROUP_SIZE);
  const marchWorkgroups = Math.ceil(CELL_COUNT / WORKGROUP_SIZE);

  // --- Bind group helpers ---
  const bg = (layout, entries) => device.createBindGroup({ layout, entries });
  const buf = (binding, b) => ({ binding, resource: { buffer: b.buffer } });
  const tex = (binding, view) => ({ binding, resource: view });
  const smp = (binding) => ({ binding, resource: chotto.sampler });

  // --- Ball configs ---
  // 3 groups of 4: balls within a group share similar Lissajous frequencies
  // so they periodically converge (merge) and diverge (separate).
  // The last two balls in each group are "wanderers" — their amplitude slowly
  // swells so they drift far from the cluster, then shrink back to rejoin.
  const WANDERER_LOCALS = new Set([2, 3]);
  const ballConfigs = Array.from({ length: NUM_BALLS }, (_, i) => {
    const group = Math.floor(i / 4);
    const local = i % 4;
    const groupFreqs = [
      { fx: 0.31, fy: 0.23, fz: 0.37 },
      { fx: 0.19, fy: 0.29, fz: 0.17 },
      { fx: 0.27, fy: 0.13, fz: 0.23 },
    ];
    const f = groupFreqs[group];
    const isWanderer = WANDERER_LOCALS.has(local);
    return {
      fx: f.fx + local * 0.008,
      fy: f.fy + local * 0.006,
      fz: f.fz + local * 0.007,
      phaseX: local * Math.PI * 0.5 + group * 1.2,
      phaseY: local * Math.PI * 0.4 + group * 2.1,
      phaseZ: local * Math.PI * 0.6 + group * 0.7,
      ampX: 0.4 + group * 0.15 + local * 0.04,
      ampY: 0.3 + Math.sin(i * 1.9) * 0.12,
      ampZ: 0.4 + group * 0.12 + local * 0.04,
      radiusFactor: 0.9 + Math.sin(i * 1.7) * 0.2,
      pulseSpeed: 0.25 + i * 0.03,
      pulsePhase: i * 1.1,
      wanderSpeed: isWanderer ? 0.06 + group * 0.02 + local * 0.015 : 0,
      wanderAmount: isWanderer ? 1.2 + group * 0.2 : 0,
      wanderPhase: group * 2.5 + local * 1.7,
    };
  });

  const ballData = new Float32Array(MAX_BALLS * 4);

  const clearIndirectData = new Uint32Array([0, 1, 0, 0]);

  chotto.fitWindow((w, h) => {
    renderFBO.resize(w, h);
    brightFBO.resize(w >> 1, h >> 1);
    blurPing.resize(w >> 1, h >> 1);
    blurPong.resize(w >> 1, h >> 1);
  });

  // --- Pointer drag for orbit ---
  let dragging = false;
  let lastPointer = { x: 0, y: 0 };

  canvas.addEventListener('pointerdown', (e) => {
    dragging = true;
    lastPointer = { x: e.clientX, y: e.clientY };
    canvas.setPointerCapture(e.pointerId);
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - lastPointer.x;
    const dy = e.clientY - lastPointer.y;
    params.rotationY += dx * 0.005;
    params.rotationX = Math.max(-1.5, Math.min(1.5, params.rotationX + dy * 0.005));
    lastPointer = { x: e.clientX, y: e.clientY };
    params.autoRotate = false;
  });

  canvas.addEventListener('pointerup', () => { dragging = false; });

  buildGUI();

  const fpsGraph = new FPSGraph();
  const timer = new Timer();
  timer.start();

  const render = () => {
    const time = timer.getElapsedTime();

    if (params.autoRotate) {
      params.rotationY = time * params.autoRotateSpeed;
    }

    // Update ball positions — Lissajous curves with shared group frequencies
    // Wanderer balls have a slow amplitude swell that carries them far out and back
    const t = time * params.orbitSpeed;
    for (let i = 0; i < NUM_BALLS; i++) {
      const c = ballConfigs[i];
      const base = i * 4;
      // wanderScale: 1.0 for normal balls; oscillates 1.0 → (1+wanderAmount) for wanderers
      const wander = c.wanderAmount > 0
        ? 1.0 + c.wanderAmount * Math.max(0, Math.sin(t * c.wanderSpeed + c.wanderPhase))
        : 1.0;
      ballData[base]     = Math.sin(t * c.fx + c.phaseX) * c.ampX * wander;
      ballData[base + 1] = Math.sin(t * c.fy + c.phaseY) * c.ampY * wander;
      ballData[base + 2] = Math.sin(t * c.fz + c.phaseZ) * c.ampZ * wander;
      ballData[base + 3] = params.ballRadius * c.radiusFactor
        * (1.0 + Math.sin(t * c.pulseSpeed + c.pulsePhase) * 0.08);
    }
    ballBuffer.write(ballData);

    // Clear indirect buffer
    indirectBuffer.write(clearIndirectData);

    // Compute params
    fieldU32[0] = GRID_SIZE;
    fieldU32[1] = NUM_BALLS;
    fieldUBO.write(fieldF32);

    marchU32[0] = GRID_SIZE;
    marchU32[1] = NUM_BALLS;
    marchU32[2] = MAX_VERTICES;
    marchF32[3] = params.threshold;
    marchUBO.write(marchF32);

    // Camera
    const cosV = Math.cos(params.lightVertical);
    cameraData[0] = canvas.width;
    cameraData[1] = canvas.height;
    cameraData[2] = params.rotationX;
    cameraData[3] = params.rotationY;
    cameraData[4] = params.zoom;
    cameraData[8] = cosV * Math.sin(params.lightHorizontal);
    cameraData[9] = Math.sin(params.lightVertical);
    cameraData[10] = cosV * Math.cos(params.lightHorizontal);
    cameraUBO.write(cameraData);

    // Material
    const bc = hexToRGB(params.baseColor);
    const sc = hexToRGB(params.specColor);
    const fc = hexToRGB(params.fresnelColor);
    const lc = hexToRGB(params.lightColor);
    matData.set(bc, 0); matData[3] = params.ambient;
    matData.set(sc, 4); matData[7] = params.shininess;
    matData.set(fc, 8); matData[11] = params.fresnelPower;
    matData.set(lc, 12); matData[15] = params.exposure;
    materialUBO.write(matData);

    // Background
    bgData.set(hexToRGB(params.bgTop), 0);
    bgData.set(hexToRGB(params.bgBottom), 4);
    bgUBO.write(bgData);

    chotto.frame(() => {
      // === Compute: evaluate field ===
      chotto.dispatch((p) => {
        p.setPipeline(fieldPipeline);
        p.setBindGroup(0, bg(fieldPipeline.getBindGroupLayout(0), [
          buf(0, fieldBuffer), buf(1, fieldUBO), buf(2, ballBuffer),
        ]));
        p.dispatchWorkgroups(fieldWorkgroups);
      });

      // === Compute: marching cubes ===
      chotto.dispatch((p) => {
        p.setPipeline(marchPipeline);
        p.setBindGroup(0, bg(marchPipeline.getBindGroupLayout(0), [
          buf(0, fieldBuffer), buf(1, marchUBO),
          buf(2, edgeTableBuffer), buf(3, triTableBuffer),
          buf(4, vertexBuffer), buf(5, indirectBuffer),
          buf(6, ballBuffer),
        ]));
        p.dispatchWorkgroups(marchWorkgroups);
      });

      // === Render: bg + mesh ===
      const bgBindGroup = bg(bgPipeline.getBindGroupLayout(0), [buf(0, bgUBO)]);
      const meshBindGroup = bg(meshPipeline.getBindGroupLayout(0), [
        buf(0, vertexBuffer), buf(1, cameraUBO), buf(2, materialUBO),
      ]);

      chotto.pass({ target: renderFBO, clear: { r: 0, g: 0, b: 0, a: 1 } }, (p) => {
        p.setPipeline(bgPipeline);
        p.setBindGroup(0, bgBindGroup);
        p.draw(3);

        p.setPipeline(meshPipeline);
        p.setBindGroup(0, meshBindGroup);
        p.drawIndirect(indirectBuffer.buffer, 0);
      });

      // === Post-processing ===
      if (params.bloomEnabled) {
        const bw = canvas.width >> 1;
        const bh = canvas.height >> 1;

        threshData[0] = params.bloomThreshold;
        thresholdUBO.write(threshData);

        chotto.pass({ target: brightFBO }, (p) => {
          p.setPipeline(thresholdPipeline);
          p.setBindGroup(0, bg(thresholdPipeline.getBindGroupLayout(0), [
            smp(0), tex(1, renderFBO.view), buf(2, thresholdUBO),
          ]));
          p.draw(3);
        });

        let readFBO = brightFBO;
        for (let i = 0; i < params.bloomIterations; i++) {
          const writeFBO = (i % 2 === 0) ? blurPing : blurPong;
          blurData[0] = 1.0 / bw;
          blurData[1] = 1.0 / bh;
          blurData[2] = i;
          blurUBOs[i].write(blurData);

          const readView = readFBO.view;
          const ubo = blurUBOs[i];
          chotto.pass({ target: writeFBO }, (p) => {
            p.setPipeline(blurPipeline);
            p.setBindGroup(0, bg(blurPipeline.getBindGroupLayout(0), [
              smp(0), tex(1, readView), buf(2, ubo),
            ]));
            p.draw(3);
          });
          readFBO = writeFBO;
        }

        composeData[0] = params.bloomStrength;
        composeData[1] = params.toneMapping;
        composeUBO.write(composeData);

        chotto.pass((p) => {
          p.setPipeline(composePipeline);
          p.setBindGroup(0, bg(composePipeline.getBindGroupLayout(0), [
            smp(0), tex(1, renderFBO.view), tex(2, readFBO.view), buf(3, composeUBO),
          ]));
          p.draw(3);
        });
      } else {
        screenData[0] = params.toneMapping;
        screenUBO.write(screenData);

        chotto.pass((p) => {
          p.setPipeline(screenPipeline);
          p.setBindGroup(0, bg(screenPipeline.getBindGroupLayout(0), [
            smp(0), tex(1, renderFBO.view), buf(2, screenUBO),
          ]));
          p.draw(3);
        });
      }
    });

    fpsGraph.update();
    requestAnimationFrame(render);
  };

  render();

  function buildGUI() {
    const gui = new GUI({ title: 'Metaball (WebGPU)' });

    const simFolder = gui.addFolder('Simulation');
    simFolder.add(params, 'threshold', 0.3, 3.0, 0.01).name('Surface Threshold');
    simFolder.add(params, 'orbitSpeed', 0.1, 3.0, 0.05).name('Orbit Speed');
    simFolder.add(params, 'ballRadius', 0.2, 0.8, 0.01).name('Ball Radius');

    const cameraFolder = gui.addFolder('Camera');
    cameraFolder.add(params, 'rotationX', -1.5, 1.5).name('Vertical').listen();
    cameraFolder.add(params, 'rotationY', -6.28, 6.28).name('Horizontal').listen();
    cameraFolder.add(params, 'zoom', 3.0, 10.0).name('Zoom');
    cameraFolder.add(params, 'autoRotate').name('Auto Rotate').listen();
    cameraFolder.add(params, 'autoRotateSpeed', 0.0, 0.5).name('Rotate Speed');

    const lightFolder = gui.addFolder('Lighting');
    lightFolder.add(params, 'lightVertical', -1.57, 1.57).name('Light Vertical');
    lightFolder.add(params, 'lightHorizontal', -3.14, 3.14).name('Light Horizontal');
    lightFolder.addColor(params, 'lightColor').name('Light Color');
    lightFolder.add(params, 'ambient', 0.0, 0.5, 0.01).name('Ambient');
    lightFolder.add(params, 'shininess', 8.0, 200.0).name('Shininess');
    lightFolder.add(params, 'fresnelPower', 1.0, 8.0, 0.1).name('Fresnel Power');
    lightFolder.add(params, 'exposure', 0.2, 3.0, 0.05).name('Exposure');
    lightFolder.add(params, 'toneMapping', 0.0, 1.0, 0.05).name('Tone Mapping');

    const colorFolder = gui.addFolder('Colors');
    colorFolder.addColor(params, 'baseColor').name('Base Color');
    colorFolder.addColor(params, 'specColor').name('Specular');
    colorFolder.addColor(params, 'fresnelColor').name('Fresnel');
    colorFolder.addColor(params, 'bgTop').name('BG Top');
    colorFolder.addColor(params, 'bgBottom').name('BG Bottom');

    const bloomFolder = gui.addFolder('Bloom');
    bloomFolder.add(params, 'bloomEnabled').name('Enabled');
    bloomFolder.add(params, 'bloomThreshold', 0.0, 2.0, 0.05).name('Threshold');
    bloomFolder.add(params, 'bloomStrength', 0.0, 2.0, 0.05).name('Strength');
    bloomFolder.add(params, 'bloomIterations', 1, 8).step(1).name('Iterations');

    gui.close();
    gui.hide();
  }
};
