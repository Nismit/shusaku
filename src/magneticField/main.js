import { chottoGPU } from 'chottogpu';
import { Timer } from '../libs/Timer.js';
import { FPSGraph } from '../libs/FPSGraph.js';
import { PointerInput } from '../libs/PointerInput.js';
import GUI from '../libs/gui.js';

import initWGSL from './shaders/init.wgsl?raw';
import updateWGSL from './shaders/update.wgsl?raw';
import particleWGSL from './shaders/particle.wgsl?raw';
import fadeWGSL from './shaders/fade.wgsl?raw';
import compositeWGSL from './shaders/composite.wgsl?raw';
import thresholdWGSL from './shaders/threshold.wgsl?raw';
import blurWGSL from './shaders/blur.wgsl?raw';
import bloomComposeWGSL from './shaders/bloomcompose.wgsl?raw';

const PARTICLE_COUNT = 256 * 256;
const WORKGROUP_SIZE = 64;
const RENDER_FORMAT = 'rgba16float';
const MAX_BLOOM_ITERATIONS = 8;

const ua = navigator.userAgent;
const IS_MOBILE = /Android|iPhone|iPod/i.test(ua) || (/iPad|Macintosh/.test(ua) && navigator.maxTouchPoints > 1);

const hexToRGB = (hex) => [
  parseInt(hex.slice(1, 3), 16) / 255,
  parseInt(hex.slice(3, 5), 16) / 255,
  parseInt(hex.slice(5, 7), 16) / 255,
];

const hslToHex = (h, s, l) => {
  s /= 100; l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(255 * c).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
};

const PALETTES = {
  Plasma: {
    particleColorA: '#1a2a8c', particleColorB: '#40e0ff', particleColorC: '#9040ff',
    particleColorA2: '#8a4010', particleColorB2: '#ffaa30', particleColorC2: '#ff5030',
    bgTop: '#020412', bgBottom: '#080218',
  },
  Aurora: {
    particleColorA: '#0a4a3c', particleColorB: '#30ffb0', particleColorC: '#6020c0',
    particleColorA2: '#6a3a0a', particleColorB2: '#f0c040', particleColorC2: '#e05020',
    bgTop: '#020a08', bgBottom: '#040818',
  },
  Solar: {
    particleColorA: '#8a3010', particleColorB: '#ffb040', particleColorC: '#ff3060',
    particleColorA2: '#102a8a', particleColorB2: '#40b0ff', particleColorC2: '#3060ff',
    bgTop: '#0a0404', bgBottom: '#120808',
  },
  Nebula: {
    particleColorA: '#3a1060', particleColorB: '#ff60c0', particleColorC: '#2040ff',
    particleColorA2: '#104030', particleColorB2: '#40ffa0', particleColorC2: '#20c060',
    bgTop: '#0a0414', bgBottom: '#060210',
  },
  Frost: {
    particleColorA: '#0a3060', particleColorB: '#a0e8ff', particleColorC: '#2060a0',
    particleColorA2: '#603020', particleColorB2: '#ffa070', particleColorC2: '#c04030',
    bgTop: '#020810', bgBottom: '#040614',
  },
};

const makeRandomPalette = () => {
  const baseHue = Math.random() * 360;
  const peakHue = (baseHue + 120 + Math.random() * 60) % 360;
  const deathHue = (baseHue + 200 + Math.random() * 80) % 360;
  const bgHue = (baseHue + 180 + Math.random() * 60) % 360;
  const base2Hue = (baseHue + 150 + Math.random() * 60) % 360;
  const peak2Hue = (base2Hue + 100 + Math.random() * 60) % 360;
  const death2Hue = (base2Hue + 180 + Math.random() * 80) % 360;
  return {
    particleColorA: hslToHex(baseHue, 70, 30),
    particleColorB: hslToHex(peakHue, 80, 60),
    particleColorC: hslToHex(deathHue, 65, 35),
    particleColorA2: hslToHex(base2Hue, 70, 30),
    particleColorB2: hslToHex(peak2Hue, 80, 60),
    particleColorC2: hslToHex(death2Hue, 65, 35),
    bgTop: hslToHex(bgHue, 50, 3),
    bgBottom: hslToHex((bgHue + 30) % 360, 40, 5),
  };
};

export const main = async () => {
  const canvas = document.createElement('canvas');
  canvas.style.width = '100vw';
  canvas.style.height = '100vh';
  document.body.appendChild(canvas);

  const initialPixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.floor(window.innerWidth * initialPixelRatio);
  canvas.height = Math.floor(window.innerHeight * initialPixelRatio);

  const chotto = await chottoGPU(canvas);
  const { device } = chotto;

  const getBasePointSize = (w, h) => {
    const aspect = w / h;
    const targetAspect = 16 / 9;
    const rawBase = aspect >= targetAspect ? 2000 : 2000 * Math.max(aspect / targetAspect, 0.75);
    return rawBase / 287.5;
  };
  let basePointSize = getBasePointSize(canvas.width, canvas.height);

  // --- Poles ---
  const poles = [
    { x: 0.32, y: 0.12, z: 0.0, charge: 1.0 },
    { x: -0.32, y: -0.12, z: 0.0, charge: -1.0 },
    { x: -0.1, y: 0.32, z: 0.15, charge: 1.0 },
    { x: 0.1, y: -0.32, z: -0.15, charge: -1.0 },
  ];

  const params = {
    speed: 0.004,
    maxSpeed: 0.012,
    lifetime: 2.5,
    spawnRadius: 0.5,
    particleAmount: IS_MOBILE ? 0.5 : 1.0,
    particleSize: 0.4,
    trailDecay: 0.96,
    exposure: 1.5,
    saturation: 1.2,
    toneMapping: 1.0,
    rotationX: 0.3,
    rotationY: 0.0,
    zoom: 2.8,
    autoRotate: true,
    autoRotateSpeed: 0.08,
    particleColorA: '#1a2a8c',
    particleColorB: '#40e0ff',
    particleColorC: '#9040ff',
    particleColorA2: '#8a4010',
    particleColorB2: '#ffaa30',
    particleColorC2: '#ff5030',
    bgTop: '#020412',
    bgBottom: '#080218',
    bloomEnabled: true,
    bloomThreshold: 0.4,
    bloomStrength: 0.8,
    bloomIterations: 5,
    seed: Math.floor(Math.random() * 10000),
    reset: () => initGPGPU(),
  };

  // --- Storage buffers (ping-pong) ---
  const initData = new Float32Array(PARTICLE_COUNT * 4);
  let positionsA = chotto.buffer(initData, { storage: true });
  let positionsB = chotto.buffer(initData, { storage: true });
  const defaultPositions = chotto.buffer(initData, { storage: true });
  const auxBuffer = chotto.buffer(initData, { storage: true });

  // --- Uniform buffers ---
  // Init: { count: u32, seed: f32, spawnRadius: f32, _pad: f32 } = 16 bytes
  const initUBO = chotto.buffer(16, { uniform: true });
  const initAB = new ArrayBuffer(16);
  const initF32 = new Float32Array(initAB);
  const initU32 = new Uint32Array(initAB);

  // Update: 8 scalars (32B) + 8 poles * vec4f (128B) = 160 bytes
  const updateUBO = chotto.buffer(160, { uniform: true });
  const updateAB = new ArrayBuffer(160);
  const updateF32 = new Float32Array(updateAB);
  const updateU32 = new Uint32Array(updateAB);

  // VParams: resolution(8) + rotation(8) + zoom(4) + size(4) + pad(8) + 6 colors * 16 = 128 bytes
  const vParamsUBO = chotto.buffer(128, { uniform: true });
  const vData = new Float32Array(32);

  // Fade: { decay: f32 } = 16 bytes
  const fadeUBO = chotto.buffer(16, { uniform: true });
  const fadeData = new Float32Array(4);

  // Composite: bgTop(16) + bgBottom+toneMapping(16) + exposure+saturation+bloomStrength+pad(16) = 48 bytes
  const compUBO = chotto.buffer(48, { uniform: true });
  const compData = new Float32Array(12);

  // Threshold: 16 bytes
  const thresholdUBO = chotto.buffer(16, { uniform: true });
  const threshData = new Float32Array(4);

  // Blur: 16 bytes per iteration
  const blurUBOs = Array.from({ length: MAX_BLOOM_ITERATIONS }, () => chotto.buffer(16, { uniform: true }));
  const blurData = new Float32Array(4);

  // --- FBOs ---
  let accumA = chotto.framebuffer(canvas.width, canvas.height, { format: RENDER_FORMAT });
  let accumB = chotto.framebuffer(canvas.width, canvas.height, { format: RENDER_FORMAT });
  let accumRead = accumA;
  let accumWrite = accumB;

  const brightFBO = chotto.framebuffer(canvas.width >> 1, canvas.height >> 1, { format: RENDER_FORMAT });
  const blurPing = chotto.framebuffer(canvas.width >> 1, canvas.height >> 1, { format: RENDER_FORMAT });
  const blurPong = chotto.framebuffer(canvas.width >> 1, canvas.height >> 1, { format: RENDER_FORMAT });

  // --- Pipelines ---
  const initPipeline = chotto.compute({ shader: initWGSL });
  const updatePipeline = chotto.compute({ shader: updateWGSL });

  const fadePipeline = chotto.pipeline({ fragment: fadeWGSL, format: RENDER_FORMAT });

  const particlePipeline = chotto.pipeline({
    vertex: particleWGSL, fragment: particleWGSL,
    format: RENDER_FORMAT, topology: 'triangle-strip',
    blend: {
      color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
      alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
    },
  });

  const thresholdPipeline = chotto.pipeline({ fragment: thresholdWGSL, format: RENDER_FORMAT });
  const blurPipeline = chotto.pipeline({ fragment: blurWGSL, format: RENDER_FORMAT });
  const screenPipeline = chotto.pipeline({ fragment: compositeWGSL });
  const bloomComposePipeline = chotto.pipeline({ fragment: bloomComposeWGSL });

  const workgroupCount = Math.ceil(PARTICLE_COUNT / WORKGROUP_SIZE);

  // --- Bind group helpers ---
  const bg = (layout, entries) => device.createBindGroup({ layout, entries });
  const buf = (binding, b) => ({ binding, resource: { buffer: b.buffer } });
  const tex = (binding, view) => ({ binding, resource: view });
  const smp = (binding) => ({ binding, resource: chotto.sampler });

  // --- Init ---
  const initGPGPU = () => {
    initU32[0] = PARTICLE_COUNT;
    initF32[1] = params.seed;
    initF32[2] = params.spawnRadius;
    initUBO.write(initF32);

    [defaultPositions, positionsA, positionsB].forEach((posBuf) => {
      chotto.dispatch((p) => {
        p.setPipeline(initPipeline);
        p.setBindGroup(0, bg(initPipeline.getBindGroupLayout(0), [
          buf(0, posBuf), buf(1, initUBO),
        ]));
        p.dispatchWorkgroups(workgroupCount);
      });
    });
  };
  initGPGPU();

  chotto.fitWindow((w, h) => {
    basePointSize = getBasePointSize(w, h);
    accumA.resize(w, h);
    accumB.resize(w, h);
    brightFBO.resize(w >> 1, h >> 1);
    blurPing.resize(w >> 1, h >> 1);
    blurPong.resize(w >> 1, h >> 1);
  });

  buildGUI();

  const fpsGraph = new FPSGraph();
  const timer = new Timer();
  timer.start();
  let lastRawTime = 0;
  let scaledTime = 0;

  // --- Pointer: drag nearest pole ---
  const rotX = (v, a) => { const c = Math.cos(a), s = Math.sin(a); return [v[0], c * v[1] + s * v[2], -s * v[1] + c * v[2]]; };
  const rotY = (v, a) => { const c = Math.cos(a), s = Math.sin(a); return [c * v[0] - s * v[2], v[1], s * v[0] + c * v[2]]; };
  const screenToWorld = (n) => {
    const aspect = canvas.width / canvas.height;
    const scale = 2.0 / params.zoom;
    const view = [n.x * aspect * scale, n.y * scale, 0];
    return rotY(rotX(view, -params.rotationX), -params.rotationY);
  };

  let activePole = -1;
  const pointer = new PointerInput(canvas);

  pointer.onPress((p) => {
    const worldPos = screenToWorld(p.normalized);
    let minDist = Infinity;
    for (let i = 0; i < poles.length; i++) {
      const dx = poles[i].x - worldPos[0];
      const dy = poles[i].y - worldPos[1];
      const dz = poles[i].z - worldPos[2];
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist < minDist) {
        minDist = dist;
        activePole = i;
      }
    }
  });

  pointer.onMove((p) => {
    if (pointer.isPressed() && activePole >= 0) {
      const worldPos = screenToWorld(p.normalized);
      poles[activePole].x = worldPos[0];
      poles[activePole].y = worldPos[1];
      poles[activePole].z = worldPos[2];
    }
  });

  pointer.onRelease(() => {
    activePole = -1;
  });

  // --- Render loop ---
  const render = () => {
    const rawTime = timer.getElapsedTime();
    const rawDt = rawTime - lastRawTime;
    lastRawTime = rawTime;
    scaledTime += rawDt;
    const deltaFrames = Math.min(rawDt * 60.0, 4.0);

    if (params.autoRotate) params.rotationY = scaledTime * params.autoRotateSpeed;

    const drawCount = Math.max(1, Math.floor(PARTICLE_COUNT * params.particleAmount));
    const decay = Math.pow(params.trailDecay, deltaFrames);

    chotto.frame(() => {
      // === Compute: update particles (A → B, swap) ===
      updateU32[0] = PARTICLE_COUNT;
      updateF32[1] = scaledTime;
      updateF32[2] = deltaFrames;
      updateU32[3] = poles.length;
      updateF32[4] = params.speed;
      updateF32[5] = params.maxSpeed;
      updateF32[6] = params.lifetime;
      updateF32[7] = params.spawnRadius;
      for (let i = 0; i < poles.length; i++) {
        updateF32[8 + i * 4] = poles[i].x;
        updateF32[8 + i * 4 + 1] = poles[i].y;
        updateF32[8 + i * 4 + 2] = poles[i].z;
        updateF32[8 + i * 4 + 3] = poles[i].charge;
      }
      updateUBO.write(updateF32);

      chotto.dispatch((p) => {
        p.setPipeline(updatePipeline);
        p.setBindGroup(0, bg(updatePipeline.getBindGroupLayout(0), [
          buf(0, positionsA), buf(1, positionsB),
          buf(2, defaultPositions), buf(3, updateUBO),
          buf(4, auxBuffer),
        ]));
        p.dispatchWorkgroups(workgroupCount);
      });
      [positionsA, positionsB] = [positionsB, positionsA];

      // === Accumulation: fade previous + draw particles (additive) ===
      fadeData[0] = decay;
      fadeUBO.write(fadeData);

      vData[0] = canvas.width; vData[1] = canvas.height;
      vData[2] = params.rotationX; vData[3] = params.rotationY;
      vData[4] = params.zoom; vData[5] = params.particleSize * basePointSize;
      vData.set(hexToRGB(params.particleColorA), 8);
      vData.set(hexToRGB(params.particleColorB), 12);
      vData.set(hexToRGB(params.particleColorC), 16);
      vData.set(hexToRGB(params.particleColorA2), 20);
      vData.set(hexToRGB(params.particleColorB2), 24);
      vData.set(hexToRGB(params.particleColorC2), 28);
      vParamsUBO.write(vData);

      const fadeBindGroup = bg(fadePipeline.getBindGroupLayout(0), [
        smp(0), tex(1, accumRead.view), buf(2, fadeUBO),
      ]);
      const particleBindGroup = bg(particlePipeline.getBindGroupLayout(0), [
        buf(0, positionsA), buf(1, vParamsUBO), buf(2, auxBuffer),
      ]);

      chotto.pass({ target: accumWrite, clear: { r: 0, g: 0, b: 0, a: 1 } }, (p) => {
        p.setPipeline(fadePipeline);
        p.setBindGroup(0, fadeBindGroup);
        p.draw(3);

        p.setPipeline(particlePipeline);
        p.setBindGroup(0, particleBindGroup);
        p.draw(4, drawCount);
      });

      [accumRead, accumWrite] = [accumWrite, accumRead];

      // === Composite UBO ===
      compData.set(hexToRGB(params.bgTop), 0);
      compData.set(hexToRGB(params.bgBottom), 4);
      compData[7] = params.toneMapping;
      compData[8] = params.exposure;
      compData[9] = params.saturation;
      compData[10] = params.bloomStrength;
      compUBO.write(compData);

      // === Bloom or direct screen ===
      if (params.bloomEnabled) {
        const bw = canvas.width >> 1;
        const bh = canvas.height >> 1;

        threshData[0] = params.bloomThreshold;
        thresholdUBO.write(threshData);

        chotto.pass({ target: brightFBO }, (p) => {
          p.setPipeline(thresholdPipeline);
          p.setBindGroup(0, bg(thresholdPipeline.getBindGroupLayout(0), [
            smp(0), tex(1, accumRead.view), buf(2, thresholdUBO),
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

        chotto.pass((p) => {
          p.setPipeline(bloomComposePipeline);
          p.setBindGroup(0, bg(bloomComposePipeline.getBindGroupLayout(0), [
            smp(0), tex(1, accumRead.view), tex(2, readFBO.view), buf(3, compUBO),
          ]));
          p.draw(3);
        });
      } else {
        chotto.pass((p) => {
          p.setPipeline(screenPipeline);
          p.setBindGroup(0, bg(screenPipeline.getBindGroupLayout(0), [
            smp(0), tex(1, accumRead.view), buf(2, compUBO),
          ]));
          p.draw(3);
        });
      }
    });

    fpsGraph.update();
    requestAnimationFrame(render);
  };

  render();

  // --- GUI ---
  function buildGUI() {
    const gui = new GUI({ title: 'Magnetic Field (WebGPU)' });

    const simFolder = gui.addFolder('Simulation');
    simFolder.add(params, 'speed', 0.001, 0.02).name('Speed');
    simFolder.add(params, 'maxSpeed', 0.005, 0.05).name('Max Speed');
    simFolder.add(params, 'lifetime', 0.5, 5.0).name('Lifetime');
    simFolder.add(params, 'spawnRadius', 0.1, 1.0).name('Spawn Radius').onChange(() => initGPGPU());
    simFolder.add(params, 'particleAmount', 0.05, 1.0, 0.01).name('Amount');

    const visualFolder = gui.addFolder('Visual');
    visualFolder.add(params, 'particleSize', 0.1, 2.0, 0.05).name('Particle Size');
    visualFolder.add(params, 'trailDecay', 0.9, 0.995, 0.001).name('Trail Decay');
    visualFolder.add(params, 'exposure', 0.5, 4.0, 0.05).name('Exposure');
    visualFolder.add(params, 'saturation', 0.0, 2.5, 0.05).name('Saturation');
    visualFolder.add(params, 'toneMapping', 0.0, 1.0, 0.05).name('Tone Mapping');

    const cameraFolder = gui.addFolder('Camera');
    cameraFolder.add(params, 'rotationX', -1.57, 1.57).name('Vertical');
    cameraFolder.add(params, 'rotationY', -3.14, 3.14).name('Horizontal').listen();
    cameraFolder.add(params, 'zoom', 1.5, 5.0).name('Zoom');
    cameraFolder.add(params, 'autoRotate').name('Auto Rotate');
    cameraFolder.add(params, 'autoRotateSpeed', 0.0, 0.3).name('Rotate Speed');

    const colorFolder = gui.addFolder('Colors');
    const colorCtrls = [];
    const applyPalette = (palette) => {
      Object.assign(params, palette);
      colorCtrls.forEach((c) => c.updateDisplay());
    };
    const paletteHelper = {
      preset: 'Plasma',
      randomize: () => applyPalette(makeRandomPalette()),
    };
    colorFolder.add(paletteHelper, 'preset', Object.keys(PALETTES)).name('Preset')
      .onChange((name) => applyPalette(PALETTES[name]));
    colorFolder.add(paletteHelper, 'randomize').name('Randomize');
    colorCtrls.push(
      colorFolder.addColor(params, 'particleColorA').name('Primary Birth'),
      colorFolder.addColor(params, 'particleColorB').name('Primary Peak'),
      colorFolder.addColor(params, 'particleColorC').name('Primary Death'),
      colorFolder.addColor(params, 'particleColorA2').name('Secondary Birth'),
      colorFolder.addColor(params, 'particleColorB2').name('Secondary Peak'),
      colorFolder.addColor(params, 'particleColorC2').name('Secondary Death'),
      colorFolder.addColor(params, 'bgTop').name('BG Top'),
      colorFolder.addColor(params, 'bgBottom').name('BG Bottom'),
    );

    const bloomFolder = gui.addFolder('Bloom');
    bloomFolder.add(params, 'bloomEnabled').name('Enabled');
    bloomFolder.add(params, 'bloomThreshold', 0.0, 1.5).name('Threshold');
    bloomFolder.add(params, 'bloomStrength', 0.0, 2.0).name('Strength');
    bloomFolder.add(params, 'bloomIterations', 1, 8).step(1).name('Iterations');

    gui.add(params, 'seed', 0, 9999).step(1).name('Seed').onChange(() => initGPGPU());
    gui.add(params, 'reset').name('Reset');
    gui.close();
    gui.hide();
  }
};
